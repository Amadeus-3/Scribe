import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from './encryption';

const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 9);

describe('encryptSecret / decryptSecret (AES-256-GCM, Spec §10.3)', () => {
  it('round-trips a secret', () => {
    const plaintext = 'wp-app-password: abcd efgh ijkl mnop';
    const enc = encryptSecret(plaintext, key);
    expect(decryptSecret(enc, key)).toBe(plaintext);
  });

  it('never stores the plaintext in the ciphertext blob', () => {
    const enc = encryptSecret('super-secret-value', key);
    expect(enc).not.toContain('super-secret-value');
  });

  it('produces a different blob each time (random IV) for the same input', () => {
    const a = encryptSecret('same', key);
    const b = encryptSecret('same', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('same');
    expect(decryptSecret(b, key)).toBe('same');
  });

  it('fails to decrypt with the wrong key (auth tag mismatch)', () => {
    const enc = encryptSecret('secret', key);
    expect(() => decryptSecret(enc, otherKey)).toThrow();
  });

  it('fails to decrypt tampered ciphertext', () => {
    const enc = encryptSecret('secret', key);
    const parts = enc.split(':');
    // flip a character in the ciphertext segment
    const data = parts[3] ?? '';
    parts[3] = (data[0] === 'A' ? 'B' : 'A') + data.slice(1);
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
  });

  it('rejects malformed input', () => {
    expect(() => decryptSecret('not-a-valid-blob', key)).toThrow(/malformed/i);
    expect(() => decryptSecret('v1:only:three', key)).toThrow(/malformed/i);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => encryptSecret('x', Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});
