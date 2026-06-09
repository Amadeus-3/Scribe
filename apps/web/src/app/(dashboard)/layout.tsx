import type { ReactNode } from 'react';
import { prisma } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { signOutAction } from '@/server/auth-actions';
import { NavLink } from '@/components/nav-link';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { email: true },
  });

  return (
    <div className="grid min-h-dvh grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-1 border-r border-border bg-panel p-3">
        <div className="mb-3 px-2.5 text-sm font-semibold">Scribe</div>
        <NavLink href="/">Dashboard</NavLink>
        <NavLink href="/sites">Sites</NavLink>
        <NavLink href="/settings">Settings</NavLink>
        <NavLink href="/audit">Audit log</NavLink>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between border-b border-border px-5 py-2.5">
          <span className="text-xs text-muted">
            {user?.email} · {actor.role}
          </span>
          <form action={signOutAction}>
            <button className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-fg">
              Sign out
            </button>
          </form>
        </header>
        <main className="min-w-0 flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
