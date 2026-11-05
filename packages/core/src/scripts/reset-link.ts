import { prisma } from '../db/client';
import { getEnv } from '../config/env';
import { issuePasswordResetCode } from '../services/auth-service';

/**
 * Operator recovery: print a one-time password reset link for an existing
 * account, for when nobody can sign in and email is not configured. Anyone
 * who can run this already controls the server, so it adds no new access.
 *
 *   docker compose exec web pnpm --filter @scribe/core auth:reset-link you@example.com
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('usage: auth:reset-link <email>');
    process.exit(2);
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });
  if (!user) {
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }
  const { code, expiresAt } = await issuePasswordResetCode(prisma, null, user.id);
  const base = getEnv().APP_BASE_URL.replace(/\/$/, '');
  // stdout on purpose: the link is the command's output, not a log line.
  process.stdout.write(`${base}/reset?code=${code}\n`);
  process.stdout.write(`Valid until ${expiresAt.toISOString()}, single use.\n`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
