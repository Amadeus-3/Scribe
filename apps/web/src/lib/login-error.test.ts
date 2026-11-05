import { describe, expect, it } from 'vitest';
import { loginErrorKey, loginErrorText } from './login-error';

describe('loginErrorKey', () => {
  it('maps the Auth.js error types the login form can raise to page keys', () => {
    expect(loginErrorKey('AccessDenied')).toBe('AccessDenied');
    expect(loginErrorKey('EmailSignInError')).toBe('EmailSignin');
    expect(loginErrorKey('Verification')).toBe('Verification');
  });

  it('collapses anything else to a generic key instead of echoing it', () => {
    expect(loginErrorKey('UntrustedHost')).toBe('Configuration');
    expect(loginErrorKey('<script>')).toBe('Configuration');
  });
});

describe('loginErrorText', () => {
  it('returns nothing when there is no error', () => {
    expect(loginErrorText(undefined, { isFreshInstance: false })).toBeNull();
  });

  it('keeps the denial generic once accounts exist', () => {
    expect(loginErrorText('AccessDenied', { isFreshInstance: false })).toMatch(/not invited/);
  });

  it('explains the bootstrap allowlist on a fresh instance', () => {
    expect(loginErrorText('AccessDenied', { isFreshInstance: true })).toMatch(
      /ALLOWED_SIGNIN_EMAILS/,
    );
  });

  it('falls back to a generic message for unknown keys', () => {
    expect(loginErrorText('Nope', { isFreshInstance: false })).toBe(
      'Sign-in failed. Please try again.',
    );
  });
});
