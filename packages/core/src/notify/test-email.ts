import type { PrismaClient } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { EmailConfigError, resolveEmailConfig } from './email-config';
import { sendEmailWith, type TransportFactory } from './mailer';

/**
 * "Send test email" on Settings > Email: delivers to the acting admin's own
 * address so no arbitrary recipient can be entered, and reports which source
 * (dashboard or env) was used.
 */
export async function sendTestEmail(
  db: PrismaClient,
  actor: Actor,
  appBaseUrl: string,
  createTransport?: TransportFactory,
): Promise<{ to: string; source: 'stored' | 'env' }> {
  authorize(actor, 'settings.update');
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { email: true } });
  if (!user?.email) throw new EmailConfigError('Your account has no email address to send to.');
  const resolved = await resolveEmailConfig(db);
  if (!resolved) {
    throw new EmailConfigError(
      'Save an SMTP URL and From address first (or set EMAIL_SERVER / EMAIL_FROM).',
    );
  }
  await sendEmailWith(
    resolved.config,
    {
      to: [user.email],
      subject: 'Scribe test email',
      text: `Email delivery from ${appBaseUrl} works. Source: ${resolved.source}.`,
      html: `<p>Email delivery from <a href="${appBaseUrl}">${appBaseUrl}</a> works.</p><p>Source: ${resolved.source}.</p>`,
    },
    createTransport,
  );
  return { to: user.email, source: resolved.source };
}
