import nodemailer, { type Transporter } from 'nodemailer';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger';
import { resolveEmailConfig, type EmailConfig } from './email-config';

/**
 * SMTP delivery for operational notifications and sign-in links.
 *
 * Config comes from `resolveEmailConfig` (dashboard first, env second), so the
 * digest, invitations and reset links share one setting. `serverUrl` is in the logger's
 * REDACT_PATHS and nothing here logs it.
 *
 * This lives in packages/core (not apps/web) because the digest is sent by the
 * worker; nodemailer is a client library like the CMS and LLM clients that are
 * already here, and it imports no framework code.
 */

export interface OutboundEmail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/** The slice of nodemailer this module needs; tests inject a fake. */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ rejected?: unknown[]; pending?: unknown[] } | void>;
}

export type TransportFactory = (serverUrl: string) => MailTransport;

// One transport per distinct URL, created lazily so importing this module never
// opens a connection and a config change in Settings picks up a new transport.
const transports = new Map<string, Transporter>();
const defaultFactory: TransportFactory = (serverUrl) => {
  let transport = transports.get(serverUrl);
  if (!transport) {
    transport = nodemailer.createTransport(serverUrl);
    transports.set(serverUrl, transport);
  }
  return transport;
};

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/** Send with an explicit config. Throws EmailSendError when the server rejects a recipient. */
export async function sendEmailWith(
  config: EmailConfig,
  email: OutboundEmail,
  createTransport: TransportFactory = defaultFactory,
): Promise<void> {
  if (email.to.length === 0) throw new EmailSendError('No recipients.');
  const result = await createTransport(config.serverUrl).sendMail({
    from: config.from,
    to: email.to.join(', '),
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  const failed = [...(result?.rejected ?? []), ...(result?.pending ?? [])].filter(Boolean);
  if (failed.length > 0) {
    throw new EmailSendError(`The mail server did not accept ${failed.length} recipient(s).`);
  }
}

/** Returns false when email is not configured, rather than throwing. */
export async function sendEmail(
  db: PrismaClient,
  email: OutboundEmail,
  createTransport: TransportFactory = defaultFactory,
): Promise<boolean> {
  const resolved = await resolveEmailConfig(db);
  if (!resolved) {
    logger.warn(
      { subject: email.subject },
      'email not configured (Settings > Email or EMAIL_SERVER/EMAIL_FROM); skipping send',
    );
    return false;
  }
  if (email.to.length === 0) {
    logger.warn({ subject: email.subject }, 'no recipients; skipping send');
    return false;
  }
  await sendEmailWith(resolved.config, email, createTransport);
  return true;
}
