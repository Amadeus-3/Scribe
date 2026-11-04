import type { PrismaClient } from '@prisma/client';
import { authorize, type Action, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { decryptSecret, encryptSecret } from '../crypto/encryption';
import { GscServiceAccountSchema, type GscServiceAccount } from '../keyword-sources/types';

const OPENROUTER_PROVIDER = 'openrouter';
const GEMINI_PROVIDER = 'gemini';
const GSC_PROVIDER = 'google_search_console';

type Provider = typeof OPENROUTER_PROVIDER | typeof GEMINI_PROVIDER;

export interface ProviderCredentialSummary {
  configured: boolean;
  hasStoredKey: boolean;
  hasEnvFallback: boolean;
  updatedAt: Date | null;
}

export type OpenRouterCredentialSummary = ProviderCredentialSummary;
export type GeminiCredentialSummary = ProviderCredentialSummary;

function envProviderKey(provider: Provider): string | undefined {
  const value =
    provider === OPENROUTER_PROVIDER
      ? process.env.OPENROUTER_API_KEY?.trim()
      : process.env.GEMINI_API_KEY?.trim();
  return value && value.length > 0 ? value : undefined;
}

async function getProviderCredentialSummary(
  db: PrismaClient,
  actor: Actor,
  provider: Provider,
): Promise<ProviderCredentialSummary> {
  authorize(actor, 'settings.read');
  const row = await db.providerCredential.findUnique({
    where: { provider },
    select: { updatedAt: true },
  });
  const hasEnvFallback = Boolean(envProviderKey(provider));
  return {
    configured: Boolean(row) || hasEnvFallback,
    hasStoredKey: Boolean(row),
    hasEnvFallback,
    updatedAt: row?.updatedAt ?? null,
  };
}

async function setProviderApiKey(
  db: PrismaClient,
  actor: Actor,
  provider: Provider,
  label: string,
  apiKey: string,
): Promise<void> {
  authorize(actor, 'settings.update');
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error(`${label} API key is required.`);
  }

  const ciphertext = encryptSecret(JSON.stringify({ apiKey: trimmed }));
  await db.$transaction(async (tx) => {
    await tx.providerCredential.upsert({
      where: { provider },
      create: { provider, credentialsEnc: ciphertext },
      update: { credentialsEnc: ciphertext },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'providerCredential.updated',
      entityType: 'ProviderCredential',
      entityId: provider,
      metadata: { provider },
    });
  });
}

async function getProviderApiKey(
  db: PrismaClient,
  actor: Actor,
  provider: Provider,
  action: Action = 'settings.update',
): Promise<string | undefined> {
  authorize(actor, action);
  const row = await db.providerCredential.findUnique({
    where: { provider },
  });
  if (!row) return envProviderKey(provider);

  const parsed = JSON.parse(decryptSecret(row.credentialsEnc)) as { apiKey?: unknown };
  return typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0
    ? parsed.apiKey
    : envProviderKey(provider);
}

export async function getOpenRouterCredentialSummary(
  db: PrismaClient,
  actor: Actor,
): Promise<OpenRouterCredentialSummary> {
  return getProviderCredentialSummary(db, actor, OPENROUTER_PROVIDER);
}

export async function setOpenRouterApiKey(
  db: PrismaClient,
  actor: Actor,
  apiKey: string,
): Promise<void> {
  return setProviderApiKey(db, actor, OPENROUTER_PROVIDER, 'OpenRouter', apiKey);
}

export async function getOpenRouterApiKey(
  db: PrismaClient,
  actor: Actor,
): Promise<string | undefined> {
  return getProviderApiKey(db, actor, OPENROUTER_PROVIDER);
}

export async function getGeminiCredentialSummary(
  db: PrismaClient,
  actor: Actor,
): Promise<GeminiCredentialSummary> {
  return getProviderCredentialSummary(db, actor, GEMINI_PROVIDER);
}

export async function setGeminiApiKey(
  db: PrismaClient,
  actor: Actor,
  apiKey: string,
): Promise<void> {
  return setProviderApiKey(db, actor, GEMINI_PROVIDER, 'Gemini', apiKey);
}

export async function getGeminiApiKey(db: PrismaClient, actor: Actor): Promise<string | undefined> {
  return getProviderApiKey(db, actor, GEMINI_PROVIDER);
}

export async function getGeminiApiKeyForImageGeneration(
  db: PrismaClient,
  actor: Actor,
): Promise<string | undefined> {
  return getProviderApiKey(db, actor, GEMINI_PROVIDER, 'article.edit');
}

// ── Google Search Console service-account credential (full JSON, not a key) ───
function envGscJson(): string | undefined {
  const value = process.env.GSC_SERVICE_ACCOUNT_JSON?.trim();
  return value && value.length > 0 ? value : undefined;
}

export async function getGscCredentialSummary(
  db: PrismaClient,
  actor: Actor,
): Promise<ProviderCredentialSummary> {
  authorize(actor, 'settings.read');
  const row = await db.providerCredential.findUnique({
    where: { provider: GSC_PROVIDER },
    select: { updatedAt: true },
  });
  const hasEnvFallback = Boolean(envGscJson());
  return {
    configured: Boolean(row) || hasEnvFallback,
    hasStoredKey: Boolean(row),
    hasEnvFallback,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function setGscServiceAccount(
  db: PrismaClient,
  actor: Actor,
  json: string,
): Promise<void> {
  authorize(actor, 'settings.update');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Paste the full service-account JSON key (it must be valid JSON).');
  }
  const sa = GscServiceAccountSchema.parse(raw);
  const ciphertext = encryptSecret(JSON.stringify(sa));
  await db.$transaction(async (tx) => {
    await tx.providerCredential.upsert({
      where: { provider: GSC_PROVIDER },
      create: { provider: GSC_PROVIDER, credentialsEnc: ciphertext },
      update: { credentialsEnc: ciphertext },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'providerCredential.updated',
      entityType: 'ProviderCredential',
      entityId: GSC_PROVIDER,
      metadata: { provider: GSC_PROVIDER },
    });
  });
}

/** Decrypt the GSC service account, or fall back to the env JSON. Read gated by `action`. */
export async function getGscServiceAccount(
  db: PrismaClient,
  actor: Actor,
  action: Action = 'keyword.create',
): Promise<GscServiceAccount | undefined> {
  authorize(actor, action);
  const row = await db.providerCredential.findUnique({ where: { provider: GSC_PROVIDER } });
  let raw: unknown;
  try {
    if (row) {
      raw = JSON.parse(decryptSecret(row.credentialsEnc));
    } else {
      const envJson = envGscJson();
      if (!envJson) return undefined;
      raw = JSON.parse(envJson);
    }
  } catch {
    return undefined;
  }
  const parsed = GscServiceAccountSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
