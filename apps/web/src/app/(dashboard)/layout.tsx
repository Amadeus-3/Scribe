import type { ReactNode } from 'react';
import { prisma } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { can } from '@scribe/core';
import { signOutAction } from '@/server/auth-actions';
import { NavLink } from '@/components/nav-link';
import { Badge, buttonClass } from '@/components/ui';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { email: true },
  });

  return (
    <div className="min-h-dvh bg-bg text-fg lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-border bg-panel/95 p-4 lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-center justify-between gap-3 lg:block">
          <div>
            <div className="text-base font-semibold tracking-tight">Scribe</div>
            <div className="mt-0.5 text-xs text-muted">AI article operations</div>
          </div>
          <Badge tone={actor.role === 'ADMIN' ? 'ok' : 'muted'}>{actor.role}</Badge>
        </div>
        <nav className="grid gap-1 sm:grid-cols-6 lg:grid-cols-1">
          <NavLink href="/" description="Pipeline status">
            Dashboard
          </NavLink>
          <NavLink href="/sites" description="Context and CMS">
            Sites
          </NavLink>
          <NavLink href="/articles" description="Review and publish">
            Articles
          </NavLink>
          <NavLink href="/settings" description="Models and keys">
            Settings
          </NavLink>
          <NavLink href="/audit" description="Activity history">
            Audit log
          </NavLink>
          {can(actor.role, 'user.manage') ? (
            <NavLink href="/team" description="Accounts and roles">
              Team
            </NavLink>
          ) : null}
        </nav>
        <div className="mt-4 hidden rounded-lg border border-border bg-panel-2 p-3 text-xs leading-5 text-muted lg:block">
          <div className="font-medium text-fg">Main flow</div>
          <div className="mt-1">
            Configure site, save style guide, generate draft, review, publish.
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-bg/80 px-4 py-2.5 sm:px-6">
          <span className="min-w-0 truncate text-xs text-muted">{user?.email}</span>
          <form action={signOutAction}>
            <button className={buttonClass({ variant: 'secondary', size: 'sm' })}>Sign out</button>
          </form>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
