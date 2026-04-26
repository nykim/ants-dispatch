import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  createUnsubscribeToken,
  renderFooterHtml,
  renderViewInBrowserBar,
  verifyViewToken,
  type OrgSettings,
} from '../../../packages/shared/src';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = mustEnv('TABLE_NAME');
const UNSUB_SECRET = mustEnv('UNSUB_SECRET');
const PUBLIC_BASE_URL = mustEnv('PUBLIC_BASE_URL');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SETTINGS_TTL_MS = 60_000;
let cachedSettings: { at: number; settings: OrgSettings } | null = null;

/**
 * Public, unauthenticated view-in-browser endpoint:
 *   GET /public/v?c=&e=&t=  — verifies HMAC, re-renders the email body + footer
 *
 * Re-render trade-off: org settings (footer/sender) are read at view time, so
 * footer edits made after the send will be reflected here. Acceptable for
 * keeping the data model lean (no per-campaign rendered-HTML snapshot).
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const { c, e, t } = (event.queryStringParameters ?? {}) as Record<string, string | undefined>;
  const campaignId = c ?? '';
  const email = (e ?? '').toLowerCase();
  const token = t ?? '';

  if (!campaignId || !EMAIL_RE.test(email) || !token) {
    return html(400, errorPage('Invalid view-in-browser link'));
  }
  if (!verifyViewToken(UNSUB_SECRET, campaignId, email, token)) {
    return html(403, errorPage('This link has expired or is invalid'));
  }

  const meta = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `CAMPAIGN#${campaignId}`, SK: 'META' } }),
  );
  if (!meta.Item) {
    return html(410, errorPage('This email is no longer available'));
  }
  const bodyHtml = typeof meta.Item.html === 'string' ? meta.Item.html : '';
  const subject = typeof meta.Item.subject === 'string' ? meta.Item.subject : '';
  if (!bodyHtml) {
    return html(410, errorPage('This email is no longer available'));
  }

  const settings = await loadSettings();
  const unsubToken = createUnsubscribeToken(UNSUB_SECRET, campaignId, email);
  const unsubUrl = `${PUBLIC_BASE_URL}/public/u?c=${encodeURIComponent(campaignId)}&e=${encodeURIComponent(
    email,
  )}&t=${unsubToken}`;
  const viewUrl = `${PUBLIC_BASE_URL}/public/v?c=${encodeURIComponent(campaignId)}&e=${encodeURIComponent(
    email,
  )}&t=${token}`;

  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(subject || 'Newsletter')}</title>
<style>
  body{margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
  .shell{max-width:640px;margin:0 auto;background:#fff;}
  .body{padding:24px;}
</style></head>
<body><div class="shell">${renderViewInBrowserBar(viewUrl)}<div class="body">${bodyHtml}${renderFooterHtml(
    settings,
    unsubUrl,
  )}</div></div></body></html>`;

  return html(200, page);
};

async function loadSettings(): Promise<OrgSettings> {
  const now = Date.now();
  if (cachedSettings && now - cachedSettings.at < SETTINGS_TTL_MS) return cachedSettings.settings;
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: 'ORG#default', SK: 'SETTINGS' } }),
  );
  const settings: OrgSettings = res.Item
    ? {
        footerHtml: typeof res.Item.footerHtml === 'string' ? res.Item.footerHtml : '',
        senderName: typeof res.Item.senderName === 'string' ? res.Item.senderName : undefined,
        senderAddress:
          typeof res.Item.senderAddress === 'string' ? res.Item.senderAddress : undefined,
      }
    : { footerHtml: '' };
  cachedSettings = { at: now, settings };
  return settings;
}

function errorPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
  <title>View in browser · NDA Dispatch</title>
  <style>
    body{font-family:'Source Serif 4',Georgia,serif;background:#faf7f1;color:#2a2420;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    .card{max-width:520px;width:100%;background:#fff;border:1px solid #e6decf;border-radius:8px;padding:36px 32px}
    h1{font-size:22px;margin:0 0 12px}
    p{font-size:15px;line-height:1.6;color:#554a40}
  </style></head>
  <body><div class="card"><h1>View in browser</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function html(status: number, body: string): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, max-age=0, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
    body,
  };
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
