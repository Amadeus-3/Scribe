import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { z } from 'zod';

/**
 * Password hashing for email + password sign-in.
 *
 * scrypt from node:crypto, so there is no native dependency to build in the
 * Docker image. Parameters follow the OWASP recommendation (N=2^15, r=8, p=1)
 * and are stored with each hash, so they can be raised later and old hashes
 * keep verifying.
 */
// Hand-rolled instead of util.promisify: the promisified overloads drop the
// options argument from the types.
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLength: 64 } as const;
// scrypt refuses to run when 128 * N * r exceeds maxmem; 2^15 * 8 * 128 is 32 MiB.
const MAX_MEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: MAX_MEM,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/** False for a missing, malformed or non-matching hash. Never throws. */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const [scheme, nStr, rStr, pStr, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !nStr || !rStr || !pStr || !saltB64 || !keyB64) return false;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  try {
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
