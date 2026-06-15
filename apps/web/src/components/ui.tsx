import type { ReactNode } from 'react';

export const inputClass =
  'w-full rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent';

export function PageHeader({ title, description, actions }: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, description, children }: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-panel p-4">
      {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
      {description ? <p className="mb-3 mt-0.5 text-xs text-muted">{description}</p> : null}
      <div className={title ? 'mt-3' : ''}>{children}</div>
    </section>
  );
}

export function Field({ label, name, hint, children }: {
  label: string;
  name?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm" htmlFor={name}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted/70">{hint}</span> : null}
    </label>
  );
}

export function Badge({ children, tone = 'default' }: {
  children: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'muted';
}) {
  const tones: Record<string, string> = {
    default: 'bg-accent/15 text-accent',
    ok: 'bg-ok/15 text-ok',
    warn: 'bg-warn/15 text-warn',
    danger: 'bg-danger/15 text-danger',
    muted: 'bg-panel-2 text-muted',
  };
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
