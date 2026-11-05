import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma, logger, authenticateWithPassword, getUserAccess } from '@scribe/core';
import type { Role } from '@scribe/core';
import { authConfig } from './auth.config';

/**
 * Full Auth.js config (Node runtime): email + password, JWT sessions
 * (Spec §10.2). The password check lives in @scribe/core
 * (authenticateWithPassword) so it is integration-tested without Auth.js.
 *
 * JWT sessions let middleware authorize at the edge without a DB hit; this
 * file re-reads role and status from the database at sign-in and again every
 * ACCESS_REFRESH_MS, so a demoted or disabled account loses its session
 * without waiting for the JWT to expire.
 */
const ACCESS_REFRESH_MS = 5 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: 'jwt' },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const result = await authenticateWithPassword(prisma, {
          email: credentials?.email,
          password: credentials?.password,
        });
        if (!result.ok) {
          // The reason stays server-side; the UI only ever says "invalid".
          logger.warn({ reason: result.reason }, 'Blocked sign-in');
          return null;
        }
        return { id: result.user.id, email: result.user.email, role: result.user.role };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      // `user` is only present on sign-in; read the authoritative role from DB.
      if (user?.id) {
        const access = await getUserAccess(prisma, user.id);
        token.id = user.id;
        token.role = access?.role ?? 'VIEWER';
        token.accessCheckedAt = Date.now();
        return token;
      }
      const checkedAt = typeof token.accessCheckedAt === 'number' ? token.accessCheckedAt : 0;
      if (typeof token.id === 'string' && checkedAt + ACCESS_REFRESH_MS < Date.now()) {
        const access = await getUserAccess(prisma, token.id);
        // Returning null makes Auth.js clear the session cookie.
        if (!access || access.status !== 'ACTIVE') return null;
        token.role = access.role;
        token.accessCheckedAt = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === 'string') session.user.id = token.id;
      if (typeof token.role === 'string') session.user.role = token.role as Role;
      return session;
    },
  },
});
