import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '../config/env';
import { logger } from '../observability/logger';

/**
 * SMTP delivery for operational notifications.
 *
 * Reuses the EMAIL_SERVER / EMAIL_FROM already configured for magic-link
 * sign-in, so the digest needs no new credential. `EMAIL_SERVER` is already in
 * the logger's REDACT_PATHS, and nothing here logs the URL.
 *
 * This lives in packages/core (not apps/web) because the digest is sent by the
 * worker; nodemailer is a client library like the CMS and LLM clients that are
 * already here, and it imports no framework code.
 */

let transport: Transporter | undefined;

function getTransport(): Transporter | null {
  const { EMAIL_SERVER } = getEnv();
  if (!EMAIL_SERVER) return null;
  // Created lazily so importing this module never opens a connection, which
  // matters for tests and for the web app that never sends.
  transport ??= nodemailer.createTransport(EMAIL_SERVER);
  return transport;
}

export interface OutboundEmail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/** Returns false when email is not configured, rather than throwing. */
export async function sendEmail(email: OutboundEmail): Promise<boolean> {
  const mailer = getTransport();
  const { EMAIL_FROM } = getEnv();
  if (!mailer || !EMAIL_FROM) {
    logger.warn(
      { subject: email.subject },
      'email not configured (EMAIL_SERVER/EMAIL_FROM); skipping send',
    );
    return false;
  }
  if (email.to.length === 0) {
    logger.warn({ subject: email.subject }, 'no recipients; skipping send');
    return false;
  }

  await mailer.sendMail({
    from: EMAIL_FROM,
    to: email.to.join(', '),
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  return true;
}
