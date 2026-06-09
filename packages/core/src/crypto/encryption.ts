import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '../config/env';

/**
 * AES-256-GCM encryption for per-site CMS credentials at rest (Spec §10.3).
 *
 * Serialized form: `v1:<iv>:<authTag>:<ciphertext>` (each segment base64).
 * The key comes from `ENCRYPTION_KEY` (base64, 32 bytes) and is decrypted only
 * in memory, never logged. Tests pass an explicit key.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const VERSION = 'v1';
const KEY_BYTES = 32;

function resolveKey(explicit?: Buffer): Buffer {
  const key = explicit ?? Buffer.from(getEnv().ENCRYPTION_KEY, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

export function encryptSecret(plaintext: string, key?: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, resolveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(serialized: string, key?: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = serialized.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed ciphertext blob');
  }
  const decipher = createDecipheriv(ALGORITHM, resolveKey(key), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
