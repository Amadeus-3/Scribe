import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma, getSigninAllowlist, logger } from '@scribe/core';
import type { Role } from '@scribe/core';
import { authConfig } from './auth.config';

/**
 * Full Auth.js config (Node runtime): email magic link + allowlist + Prisma
 * adapter (Spec §10.2, Decision §18.4). JWT sessions so middleware can authorize
 * at the edge without a DB hit. The role is read fresh from the DB on sign-in.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  trustHost: true,
  providers: [
    Nodemailer({
      // Real value injected at runtime (compose → Mailpit). The fallback keeps
      // provider init from throwing during `next build` page-data collection.
      server: process.env.EMAIL_SERVER || 'smtp://localhost:1025',
      from: process.env.EMAIL_FROM ?? 'Scribe <no-reply@example.com>',
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      // No open sign-up — only allowlisted emails may complete sign-in (§10.2).
      const email = user.email?.toLowerCase();
      const allow = getSigninAllowlist();
      if (!email || !allow.has(email)) {
        logger.warn({ email }, 'Blocked sign-in: email not on allowlist');
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      // `user` is only present on sign-in; read the authoritative role from DB
      // (the createUser event may have just promoted the first user to ADMIN).
      if (user?.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true },
        });
        token.id = user.id;
        token.role = dbUser?.role ?? 'VIEWER';
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.id === 'string') session.user.id = token.id;
      if (typeof token.role === 'string') session.user.role = token.role as Role;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      // The first user (the owner of this personal tool) becomes ADMIN.
      const count = await prisma.user.count();
      if (count === 1 && user.id) {
        await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      }
    },
  },
});
