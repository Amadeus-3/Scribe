import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import { PrismaAdapter } from '@auth/prisma-adapter';
import {
  prisma,
  getSigninAllowlist,
  logger,
  decideSignIn,
  getUserAccess,
  recordSignIn,
  resolveEmailConfig,
  sendEmailWith,
  countUsers,
} from '@scribe/core';
import type { Role } from '@scribe/core';
import { authConfig } from './auth.config';
import { magicLinkHtml, magicLinkText } from '@/lib/magic-link-email';

/**
 * Full Auth.js config (Node runtime): email magic link + invitation-only access
 * + Prisma adapter (Spec §10.2, Decision §18.4). JWT sessions so middleware can
 * authorize at the edge without a DB hit; this file re-reads role and status
 * from the database at sign-in and again every ACCESS_REFRESH_MS, so a demoted
 * or disabled account loses its session without waiting for the JWT to expire.
 */
const ACCESS_REFRESH_MS = 5 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  trustHost: true,
  providers: [
    Nodemailer({
      // Placeholders: the provider insists on a server, but delivery below
      // resolves SMTP at request time (Settings > Email first, env second), so
      // a config saved in the dashboard takes effect without a restart.
      server: 'smtp://localhost:1025',
      from: 'Scribe <no-reply@example.com>',
      async sendVerificationRequest({ identifier, url }) {
        const { host } = new URL(url);
        const resolved = await resolveEmailConfig(prisma);
        if (resolved) {
          await sendEmailWith(resolved.config, {
            to: [identifier],
            subject: `Sign in to ${host}`,
            text: magicLinkText({ url, host }),
            html: magicLinkHtml({ url, host }),
          });
          return;
        }
        // Bootstrap: a fresh install has no SMTP and no admin to configure it.
        // Print the first link to the server log instead. This door closes the
        // moment the first user exists, so it can never admit anyone to a
        // staffed instance; the signIn callback has already applied the
        // bootstrap allowlist rule before we get here.
        if ((await countUsers(prisma)) === 0) {
          logger.warn(
            { signInUrl: url, email: identifier },
            'EMAIL NOT CONFIGURED: open this link to create the first admin account, then set SMTP in Settings > Email',
          );
          return;
        }
        throw new Error(
          'Email delivery is not configured; an admin must set SMTP in Settings > Email.',
        );
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      // Runs both when the link is requested and when it is clicked, so a
      // refused email never receives a link. The rule itself is pure and
      // unit-tested in @scribe/core (sign-in-policy.ts).
      const email = user.email?.toLowerCase();
      const [userCount, existing] = await Promise.all([
        prisma.user.count(),
        email
          ? prisma.user.findUnique({ where: { email }, select: { status: true } })
          : Promise.resolve(null),
      ]);
      const decision = decideSignIn({
        email,
        userCount,
        existing,
        allowlist: getSigninAllowlist(),
      });
      if (!decision.allow) {
        logger.warn({ reason: decision.reason }, 'Blocked sign-in');
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      // `user` is only present on sign-in; read the authoritative role from DB
      // (the createUser event may have just promoted the first user to ADMIN).
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
  events: {
    async createUser({ user }) {
      // The first user to sign in on a fresh instance becomes ADMIN.
      const count = await prisma.user.count();
      if (count === 1 && user.id) {
        await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      }
    },
    async signIn({ user }) {
      // Activates an INVITED row and stamps lastLoginAt.
      if (user.id) await recordSignIn(prisma, user.id);
    },
  },
});
