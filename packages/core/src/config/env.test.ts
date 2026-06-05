import { describe, it, expect } from 'vitest';
import { loadEnv, getSigninAllowlist } from './env';

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  AUTH_SECRET: 'a-very-long-test-secret-value',
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv(valid);
    expect(env.APP_BASE_URL).toBe('http://localhost:3000');
    expect(env.ALLOWED_SIGNIN_EMAILS).toBe('');
    expect(env.NODE_ENV).toBe('test');
  });

  it('throws when a required variable is missing', () => {
    const { DATABASE_URL: _omit, ...partial } = valid;
    expect(() => loadEnv(partial)).toThrow(/DATABASE_URL/);
  });

  it('rejects an ENCRYPTION_KEY that is not 32 bytes', () => {
    expect(() => loadEnv({ ...valid, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  it('rejects an invalid APP_BASE_URL', () => {
    expect(() => loadEnv({ ...valid, APP_BASE_URL: 'not-a-url' })).toThrow(/APP_BASE_URL/);
  });

  it('rejects too-short AUTH_SECRET', () => {
    expect(() => loadEnv({ ...valid, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });
});

describe('getSigninAllowlist', () => {
  it('normalizes, lowercases, and de-duplicates the allowlist', () => {
    const env = loadEnv({ ...valid, ALLOWED_SIGNIN_EMAILS: 'A@x.com, b@Y.com , a@x.com ,' });
    const allow = getSigninAllowlist(env);
    expect(allow.has('a@x.com')).toBe(true);
    expect(allow.has('b@y.com')).toBe(true);
    expect(allow.size).toBe(2);
  });

  it('returns an empty set when unset', () => {
    const env = loadEnv(valid);
    expect(getSigninAllowlist(env).size).toBe(0);
  });
});
