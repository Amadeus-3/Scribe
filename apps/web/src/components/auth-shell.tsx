import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

/** Frame for the signed-out pages: one card, centred, same look as the dashboard. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-4 text-fg">
      <div className="w-full max-w-sm">
        <div className="mb-4 text-center">
          <div className="text-base font-semibold tracking-tight">Scribe</div>
          <div className="mt-0.5 text-xs text-muted">AI article operations</div>
        </div>
        <Card title={title} description={description}>
          {children}
        </Card>
        {footer ? (
          <div className="mt-4 text-center text-xs leading-5 text-muted">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}
