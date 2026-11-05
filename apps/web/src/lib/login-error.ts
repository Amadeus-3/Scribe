/**
 * Login-page error handling. Auth.js v5 throws an `AuthError` out of a
 * server-side `signIn()` when the sign-in callback refuses (or delivery
 * fails); uncaught, Next.js renders its generic error page. The form catches
 * it and redirects to `/login?error=<key>`, and these helpers turn the error
 * into a fixed key and fixed copy, so nothing user-controlled is ever echoed.
 */

const KEY_BY_AUTH_TYPE: Record<string, string> = {
  AccessDenied: 'AccessDenied',
  EmailSignInError: 'EmailSignin',
  Verification: 'Verification',
};

export function loginErrorKey(authErrorType: string): string {
  return KEY_BY_AUTH_TYPE[authErrorType] ?? 'Configuration';
}

// Generic on purpose: once accounts exist the copy must not reveal whether an
// address has one.
const ERROR_COPY: Record<string, string> = {
  AccessDenied: 'That email is not invited. Ask an admin to add you from the Team page.',
  EmailSignin:
    'The sign-in email could not be sent. Email delivery is not configured or failed; an admin can fix it under Settings > Email.',
  Verification: 'That link has expired or was already used. Request a new one.',
  Configuration: 'The server is misconfigured. Check the web container logs.',
};

// With zero accounts there is nothing to leak, and the only reason for a
// denial is the bootstrap allowlist, so say so.
const FRESH_INSTANCE_DENIED =
  'That email is not allowed to create the first admin account. It must be listed in ALLOWED_SIGNIN_EMAILS in the server .env (leave it empty to allow any address).';

export function loginErrorText(
  key: string | undefined,
  { isFreshInstance }: { isFreshInstance: boolean },
): string | null {
  if (!key) return null;
  if (key === 'AccessDenied' && isFreshInstance) return FRESH_INSTANCE_DENIED;
  return ERROR_COPY[key] ?? 'Sign-in failed. Please try again.';
}
