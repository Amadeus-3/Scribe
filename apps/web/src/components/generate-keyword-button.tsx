'use client';

import { useActionState } from 'react';
import { buttonClass } from '@/components/ui';
import type { FormState } from '@/server/actions';

/**
 * Compact inline "Generate" button for a queued keyword row. Shows a pending
 * state while the draft runs (~20s) and surfaces failures inline (e.g. "An
 * article already exists for this keyword.") instead of silently redirecting.
 */
export function GenerateKeywordButton({
  action,
  siteId,
  keyword,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  siteId: string;
  keyword: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="keyword" value={keyword} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={buttonClass({ variant: 'secondary', size: 'sm' })}
      >
        {pending ? 'Generating…' : 'Generate'}
      </button>
      {!state.ok && state.error ? (
        <span className="max-w-[16rem] text-xs leading-4 text-danger">{state.error}</span>
      ) : null}
    </form>
  );
}
