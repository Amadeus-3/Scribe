'use client';

import { useActionState, type ReactNode } from 'react';
import type { FormState } from '@/server/actions';
import { buttonClass } from '@/components/ui';

const initial: FormState = { ok: false };

/**
 * Compact sibling of ActionForm for table rows: controls and the submit button
 * sit on one line, feedback appears underneath. Same server-action contract.
 */
export function InlineActionForm({
  action,
  children,
  submitLabel,
  submitVariant = 'secondary',
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children?: ReactNode;
  submitLabel: string;
  submitVariant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="inline-grid gap-1">
      <div className="flex items-center gap-2">
        {children}
        <button
          type="submit"
          disabled={pending}
          className={buttonClass({ variant: submitVariant, size: 'sm' })}
        >
          {pending ? '...' : submitLabel}
        </button>
      </div>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      {state.ok && state.message ? <span className="text-xs text-ok">{state.message}</span> : null}
    </form>
  );
}
