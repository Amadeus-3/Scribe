'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import type { ReactNode } from 'react';

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={clsx(
        'block rounded px-2.5 py-1.5 text-sm',
        active ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/50 hover:text-fg',
      )}
    >
      {children}
    </Link>
  );
}
