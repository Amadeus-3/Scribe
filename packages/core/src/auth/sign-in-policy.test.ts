import { describe, it, expect } from 'vitest';
import { decideSignIn } from './sign-in-policy';

const none = new Set<string>();
const list = new Set(['owner@example.com']);

describe('decideSignIn (Spec §10.2: invitation-only access)', () => {
  it('rejects a missing or blank email before anything else', () => {
    expect(decideSignIn({ email: null, userCount: 0, existing: null, allowlist: none })).toEqual({
      allow: false,
      reason: 'invalid_email',
    });
    expect(decideSignIn({ email: '  ', userCount: 0, existing: null, allowlist: none }).allow).toBe(
      false,
    );
  });

  it('lets the first email into a fresh instance (bootstrap)', () => {
    expect(
      decideSignIn({ email: 'Anyone@Example.com', userCount: 0, existing: null, allowlist: none }),
    ).toEqual({ allow: true, reason: 'bootstrap' });
  });

  it('on a fresh instance with an env allowlist, only a listed email may bootstrap', () => {
    expect(
      decideSignIn({ email: 'OWNER@example.com', userCount: 0, existing: null, allowlist: list }),
    ).toEqual({ allow: true, reason: 'bootstrap' });
    expect(
      decideSignIn({
        email: 'stranger@example.com',
        userCount: 0,
        existing: null,
        allowlist: list,
      }),
    ).toEqual({ allow: false, reason: 'bootstrap_not_allowlisted' });
  });

  it('admits INVITED and ACTIVE rows', () => {
    for (const status of ['INVITED', 'ACTIVE'] as const) {
      expect(
        decideSignIn({
          email: 'x@example.com',
          userCount: 3,
          existing: { status },
          allowlist: none,
        }),
      ).toEqual({ allow: true, reason: 'existing_user' });
    }
  });

  it('refuses a DISABLED row even when the env allowlist names it', () => {
    expect(
      decideSignIn({
        email: 'owner@example.com',
        userCount: 3,
        existing: { status: 'DISABLED' },
        allowlist: list,
      }),
    ).toEqual({ allow: false, reason: 'disabled' });
  });

  it('refuses an unknown email on a staffed instance unless the env allowlist names it', () => {
    expect(
      decideSignIn({ email: 'new@example.com', userCount: 1, existing: null, allowlist: none }),
    ).toEqual({ allow: false, reason: 'not_invited' });
    expect(
      decideSignIn({ email: 'owner@example.com', userCount: 1, existing: null, allowlist: list }),
    ).toEqual({ allow: true, reason: 'env_allowlist' });
  });
});
