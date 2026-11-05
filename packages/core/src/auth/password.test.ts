import { describe, expect, it } from 'vitest';
import { PasswordSchema, hashPassword, verifyPassword } from './password';

describe('hashPassword / verifyPassword', () => {
  it('round-trips and salts every hash', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    await expect(verifyPassword('correct horse battery', a)).resolves.toBe(true);
    await expect(verifyPassword('correct horse battery', b)).resolves.toBe(true);
  });

  it('rejects the wrong password, a missing hash and garbage', async () => {
    const hash = await hashPassword('correct horse battery');
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
    await expect(verifyPassword('correct horse battery', null)).resolves.toBe(false);
    await expect(verifyPassword('correct horse battery', '')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$nope')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$abc$8$1$salt$key')).resolves.toBe(false);
  });

  it('verifies hashes written with other cost parameters', async () => {
    const hash = await hashPassword('pw-with-ten-chars');
    const cheaper = hash.replace('scrypt$32768$', 'scrypt$1024$');
    // A different N yields a different key, so this must fail rather than throw.
    await expect(verifyPassword('pw-with-ten-chars', cheaper)).resolves.toBe(false);
  });
});

describe('PasswordSchema', () => {
  it('enforces the length policy', () => {
    expect(PasswordSchema.safeParse('short').success).toBe(false);
    expect(PasswordSchema.safeParse('long enough!').success).toBe(true);
    expect(PasswordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});
