'use client';

import { useActionState, type ReactNode } from 'react';
import type { FormState } from '@/server/actions';

const initial: FormState = { ok: false };

/**
 * Generic form bound to a server action via useActionState. Fields are passed
 * as (server-rendered) children; this renders the submit button + inline
 * error/success. Server-side authorize()/Zod errors surface as `state.error`.
 */
export function ActionForm({
  action,
  children,
  submitLabel = 'Save',
  className,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className={className}>
      <div className="grid gap-3">{children}</div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
        {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
        {state.ok && state.message ? (
          <span className="text-xs text-ok">{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}
