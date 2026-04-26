import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const sqs = new SQSClient({});
const scheduler = new SchedulerClient({});

const TABLE = mustEnv('TABLE_NAME');
const ENQUEUE_QUEUE_URL = mustEnv('ENQUEUE_QUEUE_URL');
const SCHEDULE_GROUP = process.env.SCHEDULE_GROUP_NAME;

interface DispatchEvent {
  campaignId: string;
}

/**
 * EventBridge Scheduler target for scheduled campaign sends.
 *
 * Now thin: claims the campaign as `queueing` and hands off to the
 * worker-enqueue queue. The actual materialize + per-recipient enqueue runs
 * in worker-enqueue (15-min timeout) so 50K-row campaigns don't bump up
 * against the 60s Lambda limit.
 *
 * One-time schedules don't auto-clean themselves — we delete it here too.
 */
export async function handler(event: DispatchEvent): Promise<void> {
  const id = event?.campaignId;
  if (!id) {
    console.error(JSON.stringify({ level: 'error', msg: 'missing-campaign-id', event }));
    return;
  }
  console.log(JSON.stringify({ level: 'info', msg: 'dispatch-start', campaignId: id }));

  const meta = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `CAMPAIGN#${id}`, SK: 'META' } }),
  );
  if (!meta.Item) {
    console.error(JSON.stringify({ level: 'error', msg: 'campaign-not-found', campaignId: id }));
    await deleteSchedule(id);
    return;
  }

  const status = meta.Item.status as string;
  if (status !== 'scheduled') {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'skipping-non-scheduled',
      campaignId: id,
      status,
    }));
    await deleteSchedule(id);
    return;
  }

  const claimedAt = new Date().toISOString();

  try {
    await claimScheduledForEnqueue(id);
  } catch (e) {
    if (isConditionalFailure(e)) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'dispatch-already-claimed', campaignId: id }));
      await deleteSchedule(id);
      return;
    }
    throw e;
  }

  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: ENQUEUE_QUEUE_URL,
        MessageBody: JSON.stringify({ campaignId: id }),
      }),
    );
    console.log(JSON.stringify({ level: 'info', msg: 'dispatch-handed-off', campaignId: id }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ level: 'error', msg: 'dispatch-failed', campaignId: id, err: msg }));
    await markFailed(id, claimedAt, msg);
    throw e;
  } finally {
    await deleteSchedule(id);
  }
}

async function claimScheduledForEnqueue(campaignId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `CAMPAIGN#${campaignId}`, SK: 'META' },
      UpdateExpression: 'SET #s = :s, GSI1PK = :gpk',
      ConditionExpression: '#s = :scheduled',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': 'queueing',
        ':gpk': 'STATUS#queueing',
        ':scheduled': 'scheduled',
      },
    }),
  );
}

async function markFailed(id: string, sentAt: string, error: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `CAMPAIGN#${id}`, SK: 'META' },
      UpdateExpression: 'SET #s = :s, GSI1PK = :gpk, sentAt = :sa, #e = :e',
      ExpressionAttributeNames: { '#s': 'status', '#e': 'error' },
      ExpressionAttributeValues: {
        ':s': 'failed',
        ':gpk': 'STATUS#failed',
        ':sa': sentAt,
        ':e': error,
      },
    }),
  );
}

async function deleteSchedule(campaignId: string): Promise<void> {
  if (!SCHEDULE_GROUP) return;
  try {
    await scheduler.send(
      new DeleteScheduleCommand({
        Name: scheduleName(campaignId),
        GroupName: SCHEDULE_GROUP,
      }),
    );
  } catch (e) {
    // ResourceNotFound is fine — already gone.
    console.warn(JSON.stringify({ level: 'warn', msg: 'schedule-delete-failed', campaignId, err: String(e) }));
  }
}

export function scheduleName(campaignId: string): string {
  return `dispatch-${campaignId}`;
}

function isConditionalFailure(err: unknown): boolean {
  return (err as { name?: string }).name === 'ConditionalCheckFailedException';
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
