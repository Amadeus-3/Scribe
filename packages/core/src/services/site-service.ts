import type { CmsType, PrismaClient, Site, SiteStatus } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { encryptSecret, decryptSecret } from '../crypto/encryption';
import {
  CmsCredentialsSchema,
  LegacyWordPressCredentialsSchema,
  SiteInputSchema,
  type CmsCredentials,
  type SiteCredentialsSummary,
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
  cmsType: CmsType;
  defaultAuthor: string | null;
  status: SiteStatus;
  briefAutoApprove: boolean;
  /** Google Search Console property id (non-secret) for trending-topic discovery. */
  gscPropertyUrl: string | null;
  /** Whether the weekly discovery cron should run for this site. */
  discoveryEnabled: boolean;
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
    gscPropertyUrl: site.gscPropertyUrl,
    discoveryEnabled: site.discoveryEnabled,
    hasCredentials: Boolean(site.cmsCredentialsEnc),
    createdAt: site.createdAt,
  };
}

function parseCmsCredentials(cmsType: CmsType, raw: unknown): CmsCredentials {
  const base = raw && typeof raw === 'object' ? raw : {};
  const candidate = 'cmsType' in base ? base : { cmsType, ...base };

  if (cmsType === 'WORDPRESS') {
    const legacy = LegacyWordPressCredentialsSchema.safeParse(raw);
    if (legacy.success) return legacy.data;
  }

  return CmsCredentialsSchema.parse(candidate);
}

function toCredentialsSummary(
  cmsType: CmsType,
  credentials: CmsCredentials | null,
): SiteCredentialsSummary {
  if (cmsType === 'STRAPI') {
    const strapi = credentials?.cmsType === 'STRAPI' ? credentials : null;
    return {
      cmsType: 'STRAPI',
      apiBaseUrl: strapi?.apiBaseUrl ?? null,
      collectionApiId: strapi?.collectionApiId ?? 'articles',
      fieldMap: strapi?.fieldMap ?? {
        title: 'title',
        slug: 'slug',
        content: 'content',
        metaDescription: 'description',
        image: 'image',
        readTime: 'readTime',
        author: 'author',
        date: 'date',
        featured: 'featured',
        category: 'category',
        tags: 'tags',
      },
      contentFormat: strapi?.contentFormat ?? 'HTML',
      publicationStatus: strapi?.publicationStatus ?? 'PUBLISHED',
      locale: strapi?.locale ?? null,
      hasSecret: credentials?.cmsType === 'STRAPI' && credentials.apiToken.length > 0,
    };
  }

  return {
    cmsType: 'WORDPRESS',
    username: credentials?.cmsType === 'WORDPRESS' ? credentials.username : null,
    hasSecret: credentials?.cmsType === 'WORDPRESS' && credentials.applicationPassword.length > 0,
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
        cmsType: data.cmsType,
        defaultAuthor: data.defaultAuthor ?? null,
        briefAutoApprove: data.briefAutoApprove,
        gscPropertyUrl: data.gscPropertyUrl ?? null,
        discoveryEnabled: data.discoveryEnabled,
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
    const current = await tx.site.findUniqueOrThrow({ where: { id } });
    const cmsTypeChanged = current.cmsType !== data.cmsType;
    const site = await tx.site.update({
      where: { id },
      data: {
        name: data.name,
        baseUrl: data.baseUrl,
        cmsType: data.cmsType,
        ...(cmsTypeChanged ? { cmsCredentialsEnc: null } : {}),
        defaultAuthor: data.defaultAuthor ?? null,
        briefAutoApprove: data.briefAutoApprove,
        gscPropertyUrl: data.gscPropertyUrl ?? null,
        discoveryEnabled: data.discoveryEnabled,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'site.updated',
      entityType: 'Site',
      entityId: site.id,
      metadata: { cmsType: site.cmsType, credentialsCleared: cmsTypeChanged },
    });
    return toSiteDTO(site);
  });
}

export async function deleteSite(db: PrismaClient, actor: Actor, id: string): Promise<SiteDTO> {
  authorize(actor, 'site.delete');
  return db.$transaction(async (tx) => {
    const site = await tx.site.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'site.deleted',
      entityType: 'Site',
      entityId: site.id,
      metadata: { name: site.name, baseUrl: site.baseUrl, cmsType: site.cmsType },
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
  const base = credentials && typeof credentials === 'object' ? credentials : {};
  const parsed = CmsCredentialsSchema.parse(
    'cmsType' in base ? base : { cmsType: 'WORDPRESS', ...base },
  );
  const ciphertext = encryptSecret(JSON.stringify(parsed));
  await db.$transaction(async (tx) => {
    await tx.site.update({
      where: { id },
      data: { cmsType: parsed.cmsType, cmsCredentialsEnc: ciphertext },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'site.credentials.updated',
      entityType: 'Site',
      entityId: id,
      // Never record the secret itself.
      metadata:
        parsed.cmsType === 'WORDPRESS'
          ? { cmsType: parsed.cmsType, username: parsed.username }
          : {
              cmsType: parsed.cmsType,
              apiBaseUrl: parsed.apiBaseUrl,
              collectionApiId: parsed.collectionApiId,
              contentFormat: parsed.contentFormat,
              publicationStatus: parsed.publicationStatus,
            },
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
): Promise<CmsCredentials | null> {
  authorize(actor, 'site.credentials.manage');
  const site = await db.site.findUnique({ where: { id } });
  if (!site?.cmsCredentialsEnc) return null;
  return parseCmsCredentials(site.cmsType, JSON.parse(decryptSecret(site.cmsCredentialsEnc)));
}

/**
 * Admin-only, client-safe metadata for credential forms. Secret values are
 * deliberately omitted while non-secret Strapi mapping can be edited.
 */
export async function getSiteCredentialsSummary(
  db: PrismaClient,
  actor: Actor,
  id: string,
): Promise<SiteCredentialsSummary> {
  authorize(actor, 'site.credentials.manage');
  const site = await db.site.findUnique({ where: { id } });
  if (!site) {
    throw new Error('Site not found');
  }
  let credentials: CmsCredentials | null = null;
  if (site.cmsCredentialsEnc) {
    try {
      credentials = parseCmsCredentials(
        site.cmsType,
        JSON.parse(decryptSecret(site.cmsCredentialsEnc)),
      );
    } catch {
      credentials = null;
    }
  }
  return toCredentialsSummary(site.cmsType, credentials);
}
