import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe Auth.js config used by middleware (Spec §10.2). It must NOT import
 * Prisma or anything Node-only; those live in auth.ts. The `authorized`
 * callback gates every non-public route; UI hiding is never the gate (the
 * per-action `authorize()` helper enforces RBAC server-side).
 */

/** Routes a signed-out visitor may open: sign in, first-run setup, redeem codes. */
export const PUBLIC_PATHS = ['/login', '/setup', '/join', '/forgot', '/reset'] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const authConfig = {
  // Self-hosted behind a reverse proxy / Docker — trust the incoming host so
  // both the middleware instance and the full auth.ts instance accept it.
  trustHost: true,
  pages: { signIn: '/login', error: '/login' },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      if (isPublicPath(request.nextUrl.pathname)) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
