import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
  StreamViewType,
  TableEncryption,
} from 'aws-cdk-lib/aws-dynamodb';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { DispatchConfig } from './config';

export interface DataStackProps extends StackProps {
  config: DispatchConfig;
}

/**
 * Single-table DynamoDB layout (see docs/data-model.md).
 * Only the persistent data primitives live here — table + send queue.
 * The import queue + bucket live in ProcessingStack to avoid a bucket ↔ queue
 * cross-stack dependency cycle with StorageStack.
 */
export class DataStack extends Stack {
  readonly table: Table;
  readonly sendQueue: Queue;
  readonly sendDlq: Queue;
  readonly enqueueQueue: Queue;
  readonly enqueueDlq: Queue;
  readonly unsubscribeSecret: Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;
    const removalPolicy = config.removalOnDestroy ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

    this.table = new Table(this, 'DispatchTable', {
      tableName: `nda-dispatch-${config.envName}`,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
      removalPolicy,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.unsubscribeSecret = new Secret(this, 'UnsubscribeSecret', {
      secretName: `nda-dispatch-${config.envName}-unsubscribe-secret`,
      generateSecretString: {
        excludePunctuation: true,
      },
    });
    this.unsubscribeSecret.applyRemovalPolicy(removalPolicy);

    this.sendDlq = new Queue(this, 'sendDlq', {
      queueName: `nda-dispatch-${config.envName}-send-dlq`,
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
    });

    this.sendQueue = new Queue(this, 'SendQueue', {
      queueName: `nda-dispatch-${config.envName}-send`,
      encryption: QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { maxReceiveCount: 5, queue: this.sendDlq },
    });

    // Queue feeding the worker-enqueue Lambda. One message = one campaign to
    // materialize + push into sendQueue. Lower receive count (2) than the
    // send queue because re-running the audience materialize after a partial
    // send risks duplicate sends. Visibility timeout matches worker-enqueue's
    // Lambda timeout (15 min) so a long-running campaign isn't redelivered
    // mid-flight.
    this.enqueueDlq = new Queue(this, 'EnqueueDlq', {
      queueName: `nda-dispatch-${config.envName}-enqueue-dlq`,
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
    });
    this.enqueueQueue = new Queue(this, 'EnqueueQueue', {
      queueName: `nda-dispatch-${config.envName}-enqueue`,
      encryption: QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.minutes(15),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { maxReceiveCount: 2, queue: this.enqueueDlq },
    });

    new CfnOutput(this, 'TableName', { value: this.table.tableName });
    new CfnOutput(this, 'TableStreamArn', { value: this.table.tableStreamArn ?? '' });
    new CfnOutput(this, 'SendQueueUrl', { value: this.sendQueue.queueUrl });
    new CfnOutput(this, 'EnqueueQueueUrl', { value: this.enqueueQueue.queueUrl });
    new CfnOutput(this, 'UnsubscribeSecretArn', { value: this.unsubscribeSecret.secretArn });
  }
}
