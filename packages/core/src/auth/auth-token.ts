import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secrets for the password-less steps of auth: invite codes and password
 * reset links. The secret travels once (in a link or pasted by hand); only its
 * SHA-256 is stored, so reading the database never yields a usable code.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** 256 bits of randomness, URL-safe, 43 characters. */
export function generateTokenSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashTokenSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Length-safe constant-time string comparison for short secrets. */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
