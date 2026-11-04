import type { UserStatus } from '@prisma/client';

/**
 * Who may complete a magic-link sign-in (Spec §10.2: no open sign-up).
 *
 * Pure so the rule is unit-testable without Auth.js or a database. The caller
 * (apps/web/src/auth.ts) supplies the three facts the rule needs and logs the
 * reason on denial.
 *
 * Access is by invitation: an ADMIN pre-creates a User row (status INVITED)
 * from the Team page, and the invitee's first sign-in activates it. Two
 * exceptions keep a fresh install usable and old installs working:
 *
 *  - bootstrap: an instance with zero users lets the first email in and the
 *    createUser event promotes it to ADMIN. If ALLOWED_SIGNIN_EMAILS is set it
 *    must contain that email, so an exposed fresh instance cannot be claimed
 *    by whoever finds it first.
 *  - env allowlist: an email in ALLOWED_SIGNIN_EMAILS is admitted even without
 *    an invitation. This is how pre-Team-page deployments admitted everyone,
 *    and dropping it would lock out an allowlisted operator who had never
 *    signed in. A DISABLED row always wins over the allowlist.
 */
export interface SignInPolicyInput {
  email: string | null | undefined;
  /** Total User rows, used only to detect a fresh instance. */
  userCount: number;
  /** The existing User row for this email, if any. */
  existing: { status: UserStatus } | null;
  /** Lower-cased ALLOWED_SIGNIN_EMAILS, possibly empty. */
  allowlist: ReadonlySet<string>;
}

export type SignInAllowReason = 'bootstrap' | 'existing_user' | 'env_allowlist';
export type SignInDenyReason =
  | 'invalid_email'
  | 'disabled'
  | 'not_invited'
  | 'bootstrap_not_allowlisted';

export type SignInDecision =
  | { allow: true; reason: SignInAllowReason }
  | { allow: false; reason: SignInDenyReason };

export function decideSignIn(input: SignInPolicyInput): SignInDecision {
  const email = input.email?.trim().toLowerCase();
  if (!email) return { allow: false, reason: 'invalid_email' };

  if (input.existing) {
    if (input.existing.status === 'DISABLED') return { allow: false, reason: 'disabled' };
    return { allow: true, reason: 'existing_user' };
  }

  if (input.userCount === 0) {
    if (input.allowlist.size === 0 || input.allowlist.has(email)) {
      return { allow: true, reason: 'bootstrap' };
    }
    return { allow: false, reason: 'bootstrap_not_allowlisted' };
  }

  if (input.allowlist.has(email)) return { allow: true, reason: 'env_allowlist' };
  return { allow: false, reason: 'not_invited' };
}
