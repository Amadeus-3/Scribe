import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe Auth.js config used by middleware (Spec §10.2). It must NOT import
 * Prisma, the adapter, or Nodemailer (Node-only) — those live in auth.ts. The
 * `authorized` callback gates every non-public route; UI hiding is never the
 * gate (the per-action `authorize()` helper enforces RBAC server-side).
 */
export const authConfig = {
  // Self-hosted behind a reverse proxy / Docker — trust the incoming host so
  // both the middleware instance and the full auth.ts instance accept it.
  trustHost: true,
  pages: { signIn: '/login', verifyRequest: '/login/verify' },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;
      const isPublic = pathname === '/login' || pathname.startsWith('/login/');
      if (isPublic) return true;
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
