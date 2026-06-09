import type { PrismaClient, Site, SiteStatus } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { encryptSecret, decryptSecret } from '../crypto/encryption';
import {
  SiteInputSchema,
  WordPressCredentialsSchema,
  type WordPressCredentials,
} from '../domain/site';

/**
 * Site management service (Spec §6, §8, Phase 1). Every function authorizes the
 * actor, validates input with Zod, and writes an AuditLog row in the same
 * transaction as the mutation. Credentials are AES-256-GCM encrypted at rest and
 * NEVER returned to the client — the safe `SiteDTO` omits the ciphertext.
 */
export interface SiteDTO {
  id: string;
  name: string;
  baseUrl: string;
  cmsType: string;
  defaultAuthor: string | null;
  status: SiteStatus;
  briefAutoApprove: boolean;
  /** Whether credentials are stored — the ciphertext itself is never exposed. */
  hasCredentials: boolean;
  createdAt: Date;
}

function toSiteDTO(site: Site): SiteDTO {
  return {
    id: site.id,
    name: site.name,
    baseUrl: site.baseUrl,
    cmsType: site.cmsType,
    defaultAuthor: site.defaultAuthor,
    status: site.status,
    briefAutoApprove: site.briefAutoApprove,
    hasCredentials: Boolean(site.cmsCredentialsEnc),
    createdAt: site.createdAt,
  };
}

export async function listSites(db: PrismaClient, actor: Actor): Promise<SiteDTO[]> {
  authorize(actor, 'site.read');
  const sites = await db.site.findMany({ orderBy: { createdAt: 'desc' } });
  return sites.map(toSiteDTO);
}

export async function getSite(db: PrismaClient, actor: Actor, id: string): Promise<SiteDTO | null> {
  authorize(actor, 'site.read');
  const site = await db.site.findUnique({ where: { id } });
  return site ? toSiteDTO(site) : null;
}

export async function createSite(db: PrismaClient, actor: Actor, input: unknown): Promise<SiteDTO> {
  authorize(actor, 'site.create');
  const data = SiteInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    const site = await tx.site.create({
      data: {
        name: data.name,
        baseUrl: data.baseUrl,
        defaultAuthor: data.defaultAuthor ?? null,
        briefAutoApprove: data.briefAutoApprove,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'site.created',
      entityType: 'Site',
      entityId: site.id,
      metadata: { name: site.name, baseUrl: site.baseUrl },
    });
    return toSiteDTO(site);
  });
}

export async function updateSite(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<SiteDTO> {
  authorize(actor, 'site.update');
  const data = SiteInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    const site = await tx.site.update({
      where: { id },
      data: {
        name: data.name,
        baseUrl: data.baseUrl,
        defaultAuthor: data.defaultAuthor ?? null,
        briefAutoApprove: data.briefAutoApprove,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'site.updated',
      entityType: 'Site',
      entityId: site.id,
    });
    return toSiteDTO(site);
  });
}

export async function setSiteStatus(
  db: PrismaClient,
  actor: Actor,
  id: string,
  status: SiteStatus,
): Promise<SiteDTO> {
  authorize(actor, 'site.update');
  return db.$transaction(async (tx) => {
    const site = await tx.site.update({ where: { id }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'site.status.changed',
      entityType: 'Site',
      entityId: site.id,
      metadata: { status },
    });
    return toSiteDTO(site);
  });
}

/**
 * Store per-site CMS credentials, encrypted. Admin-only (credential management).
 * The plaintext is never logged or persisted; only the ciphertext is written.
 */
export async function setSiteCredentials(
  db: PrismaClient,
  actor: Actor,
  id: string,
  credentials: unknown,
): Promise<void> {
  authorize(actor, 'site.credentials.manage');
  const parsed = WordPressCredentialsSchema.parse(credentials);
  const ciphertext = encryptSecret(JSON.stringify(parsed));
  await db.$transaction(async (tx) => {
    await tx.site.update({ where: { id }, data: { cmsCredentialsEnc: ciphertext } });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'site.credentials.updated',
      entityType: 'Site',
      entityId: id,
      // Never record the secret itself.
      metadata: { username: parsed.username },
    });
  });
}

/**
 * Decrypt credentials for server/worker use (e.g. publishing, Phase 4). Admin
 * authorization required; the result must never be sent to the browser.
 */
export async function getSiteCredentials(
  db: PrismaClient,
  actor: Actor,
  id: string,
): Promise<WordPressCredentials | null> {
  authorize(actor, 'site.credentials.manage');
  const site = await db.site.findUnique({ where: { id } });
  if (!site?.cmsCredentialsEnc) return null;
  return WordPressCredentialsSchema.parse(JSON.parse(decryptSecret(site.cmsCredentialsEnc)));
}
