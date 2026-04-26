import { createHmac, timingSafeEqual } from 'node:crypto';

export function createViewToken(secret: string, campaignId: string, email: string): string {
  return createHmac('sha256', secret).update(`view|${campaignId}|${email}`).digest('base64url');
}

export function verifyViewToken(
  secret: string,
  campaignId: string,
  email: string,
  token: string,
): boolean {
  const expected = createViewToken(secret, campaignId, email);
  const actualBuf = Buffer.from(token, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (actualBuf.length !== expectedBuf.length) return false;
  try {
    return timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    return false;
  }
}
