'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import type { ReactNode } from 'react';

export function NavLink({
  href,
  children,
  description,
}: {
  href: string;
  children: ReactNode;
  description?: string;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={clsx(
        'block rounded-md border px-3 py-2 transition',
        active
          ? 'border-accent/25 bg-accent/10 text-fg'
          : 'border-transparent text-muted hover:border-border hover:bg-panel-2 hover:text-fg',
      )}
    >
      <span className="block text-sm font-medium">{children}</span>
      {description ? <span className="mt-0.5 block text-xs leading-5 opacity-75">{description}</span> : null}
    </Link>
  );
}
