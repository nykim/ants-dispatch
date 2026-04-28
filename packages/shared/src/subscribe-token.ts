import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC tokens for the public subscribe-confirmation flow.
 *
 *   payload = subscribe|<email>|<typeId or '*'>|<expiresAtMs>
 *
 * The expiry is part of the signed payload (not just compared at verify time)
 * so an attacker can't trivially extend a leaked token by URL-mangling. The
 * token format itself is: `<base64url(HMAC)>:<expiresAtMs>` — the verifier
 * splits, recomputes the HMAC over the same payload using the parsed
 * expiry, then constant-time compares.
 *
 * Domain-separated from the unsubscribe + view-in-browser tokens (`unsub|`
 * and `view|`) by the `subscribe|` prefix so a leaked token in one channel
 * can't be replayed in another.
 */

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

export function createConfirmToken(
  secret: string,
  email: string,
  typeId: string | undefined,
  now: number = Date.now(),
): string {
  const expiresAt = now + TOKEN_TTL_MS;
  const sig = sign(secret, email, typeId, expiresAt);
  return `${sig}:${expiresAt}`;
}

export function verifyConfirmToken(
  secret: string,
  email: string,
  typeId: string | undefined,
  token: string,
  now: number = Date.now(),
): boolean {
  const [sig, expiresAtRaw] = token.split(':');
  if (!sig || !expiresAtRaw) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expected = sign(secret, email, typeId, expiresAt);
  const actualBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (actualBuf.length !== expectedBuf.length) return false;
  try {
    return timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    return false;
  }
}

function sign(secret: string, email: string, typeId: string | undefined, expiresAt: number): string {
  return createHmac('sha256', secret)
    .update(`subscribe|${email}|${typeId ?? '*'}|${expiresAt}`)
    .digest('base64url');
}
