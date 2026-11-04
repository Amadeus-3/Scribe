import type { ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

export const inputClass =
  'w-full rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-fg shadow-sm outline-none transition placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60';

export function buttonClass({
  variant = 'primary',
  size = 'default',
  className,
}: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'default' | 'sm';
  className?: string;
} = {}) {
  const variants = {
    primary: 'border-accent bg-accent text-accent-fg hover:bg-accent/90',
    secondary: 'border-border bg-panel-2 text-fg hover:bg-panel-3',
    ghost: 'border-transparent bg-transparent text-muted hover:bg-panel-2 hover:text-fg',
    danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/15',
  };
  const sizes = {
    default: 'h-9 px-3 text-sm',
    sm: 'h-8 px-2.5 text-xs',
  };

  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-md border font-medium shadow-sm transition disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  );
}

export function PageHeader({ title, description, actions }: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, description, actions, className, children }: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx('min-w-0 rounded-lg border border-border bg-panel shadow-sm', className)}>
      {title || description || actions ? (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-fg">{title}</h2> : null}
            {description ? (
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className="min-w-0 p-4">{children}</div>
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
    <label className="grid gap-1.5 text-sm" htmlFor={name}>
      <span className="text-xs font-medium text-fg">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-muted">{hint}</span> : null}
    </label>
  );
}

export function Disclosure({
  summary,
  hint,
  defaultOpen = false,
  children,
}: {
  summary: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-md border border-border bg-panel-2/40">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
        <span>
          {summary}
          {hint ? <span className="ml-2 text-xs font-normal text-muted">{hint}</span> : null}
        </span>
        <span aria-hidden className="text-xs text-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="grid gap-3 border-t border-border p-3">{children}</div>
    </details>
  );
}

export function Badge({ children, tone = 'default' }: {
  children: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'muted';
}) {
  const tones: Record<string, string> = {
    default: 'border-accent/30 bg-accent/10 text-accent',
    ok: 'border-ok/30 bg-ok/10 text-ok',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    danger: 'border-danger/30 bg-danger/10 text-danger',
    muted: 'border-border bg-panel-2 text-muted',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'PUBLISHED' || status === 'APPROVED' || status === 'ACTIVE'
      ? 'ok'
      : status === 'PUBLISH_FAILED' || status === 'REJECTED'
        ? 'danger'
        : status === 'PENDING_REVIEW' || status === 'CHANGES_REQUESTED' || status === 'PAUSED'
          ? 'warn'
          : 'muted';

  return <Badge tone={tone}>{status.replaceAll('_', ' ').toLowerCase()}</Badge>;
}

export function Stat({
  label,
  value,
  description,
}: {
  label: string;
  value: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4 shadow-sm">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {description ? <div className="mt-1 text-xs leading-5 text-muted">{description}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-md border border-dashed border-border bg-panel-2/45 p-6 text-center">
      <div className="text-sm font-medium text-fg">{title}</div>
      {description ? <p className="mt-1 max-w-md text-sm leading-6 text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function StepList({
  steps,
}: {
  steps: Array<{ label: string; description?: string; href?: string; done?: boolean }>;
}) {
  return (
    <ol className="grid gap-2">
      {steps.map((step, index) => {
        const content = (
          <>
            <span
              className={clsx(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
                step.done
                  ? 'border-ok/30 bg-ok/10 text-ok'
                  : 'border-border bg-panel-2 text-muted',
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{step.label}</span>
              {step.description ? (
                <span className="mt-0.5 block text-xs leading-5 text-muted">{step.description}</span>
              ) : null}
            </span>
          </>
        );

        return (
          <li key={`${step.label}-${index}`}>
            {step.href ? (
              <Link
                href={step.href}
                className="flex gap-3 rounded-md border border-transparent p-2 transition hover:border-border hover:bg-panel-2"
              >
                {content}
              </Link>
            ) : (
              <div className="flex gap-3 p-2">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
