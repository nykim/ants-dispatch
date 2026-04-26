import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { OrgSettings } from '../../../packages/shared/src';

export { renderFooterHtml, renderFooterText, renderViewInBrowserBar } from '../../../packages/shared/src';
export type { OrgSettings } from '../../../packages/shared/src';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const SETTINGS_TTL_MS = 60_000;
let cached: { at: number; settings: OrgSettings } | null = null;

export async function loadSettings(tableName: string): Promise<OrgSettings> {
  const now = Date.now();
  if (cached && now - cached.at < SETTINGS_TTL_MS) return cached.settings;
  const res = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: 'ORG#default', SK: 'SETTINGS' } }),
  );
  const settings: OrgSettings = res.Item
    ? {
        footerHtml: typeof res.Item.footerHtml === 'string' ? res.Item.footerHtml : '',
        senderName: typeof res.Item.senderName === 'string' ? res.Item.senderName : undefined,
        senderAddress:
          typeof res.Item.senderAddress === 'string' ? res.Item.senderAddress : undefined,
      }
    : { footerHtml: '' };
  cached = { at: now, settings };
  return settings;
}
