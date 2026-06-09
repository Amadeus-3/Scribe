import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

// Edge middleware: the `authorized` callback in authConfig redirects
// unauthenticated requests to /login. Edge-safe (no Prisma/Nodemailer imports).
export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except Next internals, the auth API, and static assets.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
