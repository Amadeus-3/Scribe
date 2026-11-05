'use client';

import { useActionState, type ReactNode } from 'react';
import type { FormState } from '@/server/form-state';
import { buttonClass } from '@/components/ui';

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
  submitVariant = 'primary',
  className,
  encType,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel?: string;
  submitVariant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  encType?: 'multipart/form-data';
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className={className} encType={encType}>
      <div className="grid gap-3">{children}</div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass({ variant: submitVariant })}
        >
          {pending ? 'Working...' : submitLabel}
        </button>
        {state.error ? (
          <span className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs leading-5 text-danger">
            {state.error}
          </span>
        ) : null}
        {state.ok && state.message ? (
          <span className="rounded-md border border-ok/30 bg-ok/10 px-2.5 py-1.5 text-xs leading-5 text-ok">
            {state.message}
          </span>
        ) : null}
      </div>
      {state.ok && state.detail ? (
        <code className="mt-2 block select-all break-all rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-fg">
          {state.detail}
        </code>
      ) : null}
    </form>
  );
}
