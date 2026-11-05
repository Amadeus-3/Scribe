import {
  AuthorizationError,
  AuthFlowError,
  BudgetExceededError,
  EmailConfigError,
  EmailSendError,
  UserManagementError,
  logger,
} from '@scribe/core';

/** What every server action hands back to its form. */
export type FormState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** A value to hand over verbatim (an invite link, a reset link). Rendered selectable. */
  detail?: string;
};

/** Map a thrown error to form feedback; only operator-safe messages reach the UI. */
export function toState(action: string, e: unknown): FormState {
  if (e instanceof AuthorizationError) {
    logger.warn({ action, errorType: 'AuthorizationError' }, 'server action denied');
    return { ok: false, error: 'You are not permitted to perform this action.' };
  }
  if (
    e instanceof UserManagementError ||
    e instanceof EmailConfigError ||
    e instanceof AuthFlowError
  ) {
    return { ok: false, error: e.message };
  }
  if (e instanceof EmailSendError) {
    logger.warn({ action, errorType: e.name }, 'email send rejected');
    return { ok: false, error: e.message };
  }
  if (e instanceof BudgetExceededError) {
    logger.warn({ action, scope: e.scope, spentUsd: e.spentUsd }, 'AI budget reached');
    return { ok: false, error: e.message };
  }
  if (e && typeof e === 'object' && (e as { name?: string }).name === 'ZodError') {
    const issues = (e as { issues?: Array<{ message: string }> }).issues ?? [];
    logger.warn(
      { action, errorType: 'ZodError', issues: issues.map((i) => i.message) },
      'server action validation failed',
    );
    return { ok: false, error: issues.map((i) => i.message).join('; ') || 'Invalid input.' };
  }
  logger.error(
    {
      action,
      errorType: e instanceof Error ? e.name : typeof e,
      errorMessage: e instanceof Error ? e.message : 'Unknown server action failure',
    },
    'server action failed',
  );
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

export const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
