import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { decryptSecret, encryptSecret } from '../crypto/encryption';

/**
 * Outbound email (magic links + review digest) configured from the dashboard.
 *
 * The SMTP URL carries a password, so it is stored like every other provider
 * secret: AES-256-GCM in `ProviderCredential` (provider "smtp"), written only
 * behind `authorize(actor, 'settings.update')`, never returned to the client.
 * `EMAIL_SERVER` / `EMAIL_FROM` in the environment remain a fallback so
 * existing deployments and local dev (Mailpit) keep working unchanged.
 *
 * Why this matters for a fresh install: without SMTP nobody can receive the
 * first magic link. `resolveEmailConfig` is what Auth.js consults at request
 * time, so SMTP saved in Settings takes effect without a restart.
 */
export const EMAIL_PROVIDER = 'smtp';

export const EmailConfigSchema = z.object({
  serverUrl: z
    .string()
    .trim()
    .min(1, 'SMTP URL is required.')
    .refine((v) => /^smtps?:\/\//i.test(v), 'SMTP URL must start with smtp:// or smtps://.')
    .refine((v) => {
      try {
        return new URL(v).hostname.length > 0;
      } catch {
        return false;
      }
    }, 'SMTP URL must look like smtp://user:password@host:587.'),
  from: z
    .string()
    .trim()
    .min(3, 'From address is required.')
    .refine(
      (v) => /@/.test(v),
      'From must contain an email address, e.g. Scribe <no-reply@example.com>.',
    ),
});
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

export type EmailConfigSource = 'stored' | 'env';

export interface ResolvedEmailConfig {
  config: EmailConfig;
  source: EmailConfigSource;
}

export interface EmailConfigSummary {
  configured: boolean;
  /** Which source is live right now. */
  source: EmailConfigSource | 'none';
  /** The From header is not secret and helps the admin recognise the config. */
  from: string | null;
  hasStoredConfig: boolean;
  hasEnvFallback: boolean;
  updatedAt: Date | null;
}

/** Operator-facing failure; the message is safe to show in the UI. */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailConfigError';
  }
}

function envEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  const parsed = EmailConfigSchema.safeParse({
    serverUrl: env.EMAIL_SERVER ?? '',
    from: env.EMAIL_FROM ?? '',
  });
  return parsed.success ? parsed.data : null;
}

async function storedEmailConfig(
  db: PrismaClient,
): Promise<{ config: EmailConfig | null; updatedAt: Date } | null> {
  const row = await db.providerCredential.findUnique({ where: { provider: EMAIL_PROVIDER } });
  if (!row) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decryptSecret(row.credentialsEnc));
  } catch {
    return { config: null, updatedAt: row.updatedAt };
  }
  const parsed = EmailConfigSchema.safeParse(raw);
  return { config: parsed.success ? parsed.data : null, updatedAt: row.updatedAt };
}

/**
 * The config to send with, dashboard first, environment second, or null.
 * No actor: this is called by Auth.js and the worker, not on a user's behalf.
 */
export async function resolveEmailConfig(db: PrismaClient): Promise<ResolvedEmailConfig | null> {
  const stored = await storedEmailConfig(db);
  if (stored?.config) return { config: stored.config, source: 'stored' };
  const env = envEmailConfig();
  return env ? { config: env, source: 'env' } : null;
}

export async function getEmailConfigSummary(
  db: PrismaClient,
  actor: Actor,
): Promise<EmailConfigSummary> {
  authorize(actor, 'settings.read');
  const stored = await storedEmailConfig(db);
  const env = envEmailConfig();
  const live = stored?.config ? stored.config : env;
  return {
    configured: Boolean(live),
    source: stored?.config ? 'stored' : env ? 'env' : 'none',
    from: live?.from ?? null,
    hasStoredConfig: Boolean(stored?.config),
    hasEnvFallback: Boolean(env),
    updatedAt: stored?.updatedAt ?? null,
  };
}

export async function setEmailConfig(
  db: PrismaClient,
  actor: Actor,
  input: unknown,
): Promise<void> {
  authorize(actor, 'settings.update');
  const config = EmailConfigSchema.parse(input);
  const ciphertext = encryptSecret(JSON.stringify(config));
  await db.$transaction(async (tx) => {
    await tx.providerCredential.upsert({
      where: { provider: EMAIL_PROVIDER },
      create: { provider: EMAIL_PROVIDER, credentialsEnc: ciphertext },
      update: { credentialsEnc: ciphertext },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'providerCredential.updated',
      entityType: 'ProviderCredential',
      entityId: EMAIL_PROVIDER,
      metadata: { provider: EMAIL_PROVIDER },
    });
  });
}

/** Drop the stored config so the environment fallback (if any) applies again. */
export async function clearEmailConfig(db: PrismaClient, actor: Actor): Promise<void> {
  authorize(actor, 'settings.update');
  await db.$transaction(async (tx) => {
    const deleted = await tx.providerCredential.deleteMany({ where: { provider: EMAIL_PROVIDER } });
    if (deleted.count === 0) return;
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'providerCredential.cleared',
      entityType: 'ProviderCredential',
      entityId: EMAIL_PROVIDER,
      metadata: { provider: EMAIL_PROVIDER },
    });
  });
}
