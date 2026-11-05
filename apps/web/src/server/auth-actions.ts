'use server';

import { AuthError } from 'next-auth';
import {
  prisma,
  logger,
  getEnv,
  bootstrapAdmin,
  redeemAuthCode,
  requestPasswordReset,
  resolveEmailConfig,
  sendEmailWith,
  passwordResetEmail,
} from '@scribe/core';
import { signIn, signOut } from '@/auth';
import { absoluteUrl, appHost, safeRedirectPath } from '@/lib/app-url';
import { toState, str, type FormState } from './form-state';

/**
 * The public auth flows. Each one ends by establishing the session through
 * Auth.js with the password the person just typed, so no flow needs email.
 * Session-holding mutations (invite, reset links, change password) live in
 * actions.ts behind requireActor().
 */

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}

/**
 * Sign in via Auth.js. On success it throws Next's redirect, which must
 * propagate; only Auth.js's own failure is turned into form feedback.
 */
async function establishSession(
  email: string,
  password: string,
  redirectTo: string,
): Promise<FormState> {
  try {
    await signIn('credentials', { email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        error:
          error.type === 'CredentialsSignin'
            ? 'Invalid email or password.'
            : 'Sign-in failed. Please try again.',
      };
    }
    throw error;
  }
  return { ok: true };
}

function passwordsMatch(formData: FormData): FormState | null {
  if (str(formData.get('password')) !== str(formData.get('confirmPassword'))) {
    return { ok: false, error: 'The two passwords do not match.' };
  }
  return null;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return establishSession(
    str(formData.get('email')),
    str(formData.get('password')),
    safeRedirectPath(formData.get('callbackUrl')),
  );
}

export async function setupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const mismatch = passwordsMatch(formData);
  if (mismatch) return mismatch;
  const email = str(formData.get('email'));
  const password = str(formData.get('password'));
  try {
    await bootstrapAdmin(
      prisma,
      {
        email,
        name: str(formData.get('name')),
        password,
        setupToken: str(formData.get('setupToken')),
      },
      { requiredSetupToken: getEnv().SETUP_TOKEN },
    );
  } catch (e) {
    return toState('auth.setup', e);
  }
  return establishSession(email, password, '/settings?welcome=1');
}

export async function joinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const mismatch = passwordsMatch(formData);
  if (mismatch) return mismatch;
  const password = str(formData.get('password'));
  let email: string;
  try {
    ({ email } = await redeemAuthCode(prisma, 'INVITE', {
      code: str(formData.get('code')),
      password,
    }));
  } catch (e) {
    return toState('auth.join', e);
  }
  return establishSession(email, password, '/');
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const mismatch = passwordsMatch(formData);
  if (mismatch) return mismatch;
  const password = str(formData.get('password'));
  let email: string;
  try {
    ({ email } = await redeemAuthCode(prisma, 'PASSWORD_RESET', {
      code: str(formData.get('code')),
      password,
    }));
  } catch (e) {
    return toState('auth.reset', e);
  }
  return establishSession(email, password, '/');
}

const FORGOT_MESSAGE =
  'If that address has an account, a reset link is on its way. It is valid for one hour.';

/**
 * Same reply whether or not the address exists. Without SMTP there is nothing
 * to send, and saying so reveals nothing, so the page can point at the admin.
 */
export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const resolved = await resolveEmailConfig(prisma);
  if (!resolved) {
    return {
      ok: true,
      message:
        'This instance has no email delivery configured, so reset links cannot be emailed. Ask an admin to issue one from the Team page.',
    };
  }
  try {
    await requestPasswordReset(prisma, str(formData.get('email')), async (to, issued) => {
      const host = appHost();
      await sendEmailWith(resolved.config, {
        to: [to],
        ...passwordResetEmail({ resetUrl: absoluteUrl(`/reset?code=${issued.code}`), host }),
      });
    });
  } catch (e) {
    // Delivery failed for an address that exists; the reply must not say so.
    logger.warn({ errorType: e instanceof Error ? e.name : typeof e }, 'reset email failed');
  }
  return { ok: true, message: FORGOT_MESSAGE };
}
