import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from '../test/db';
import { AuthorizationError, type Actor } from '../auth/authorize';
import {
  createSite,
  updateSite,
  listSites,
  getSite,
  setSiteCredentials,
  getSiteCredentials,
  setSiteStatus,
} from './site-service';
import { upsertStyleGuide } from './style-guide-service';
import { addKeywords, deleteKeyword, listKeywords } from './keyword-service';
import { getSettingsForActor, updateSetting } from './settings-service';

const db = getTestPrisma();

let admin: Actor;
let editor: Actor;
let viewer: Actor;

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await truncateAll(db);
  const a = await db.user.create({ data: { email: 'admin@test.local', role: 'ADMIN' } });
  const e = await db.user.create({ data: { email: 'editor@test.local', role: 'EDITOR' } });
  const v = await db.user.create({ data: { email: 'viewer@test.local', role: 'VIEWER' } });
  admin = { id: a.id, role: 'ADMIN' };
  editor = { id: e.id, role: 'EDITOR' };
  viewer = { id: v.id, role: 'VIEWER' };
});

const siteInput = { name: 'My Blog', baseUrl: 'https://blog.example.com' };

async function auditCount(action: string): Promise<number> {
  return db.auditLog.count({ where: { action } });
}

describe('RBAC matrix on services (Spec §1.4, Phase 1 acceptance)', () => {
  it('only ADMIN can create a site; EDITOR and VIEWER are denied', async () => {
    await expect(createSite(db, editor, siteInput)).rejects.toThrow(AuthorizationError);
    await expect(createSite(db, viewer, siteInput)).rejects.toThrow(AuthorizationError);
    const site = await createSite(db, admin, siteInput);
    expect(site.name).toBe('My Blog');
  });

  it('all roles can read sites; none below ADMIN can manage credentials', async () => {
    const site = await createSite(db, admin, siteInput);
    await expect(listSites(db, viewer)).resolves.toHaveLength(1);
    await expect(listSites(db, editor)).resolves.toHaveLength(1);
    await expect(
      setSiteCredentials(db, editor, site.id, { username: 'u', applicationPassword: 'p' }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      setSiteCredentials(db, viewer, site.id, { username: 'u', applicationPassword: 'p' }),
    ).rejects.toThrow(AuthorizationError);
  });

  it('keyword.create and styleGuide.update and settings.update are ADMIN-only', async () => {
    const site = await createSite(db, admin, siteInput);
    await expect(addKeywords(db, editor, { siteId: site.id, terms: ['x'] })).rejects.toThrow(
      AuthorizationError,
    );
    await expect(
      upsertStyleGuide(db, editor, site.id, { systemPrompt: 'Write.', bannedPhrases: [] }),
    ).rejects.toThrow(AuthorizationError);
    await expect(updateSetting(db, editor, 'monthly_budget_usd', 99)).rejects.toThrow(
      AuthorizationError,
    );
  });

  it('VIEWER can read settings but not change them', async () => {
    await expect(getSettingsForActor(db, viewer)).resolves.toMatchObject({ monthly_budget_usd: 50 });
    await expect(updateSetting(db, viewer, 'monthly_budget_usd', 99)).rejects.toThrow(
      AuthorizationError,
    );
  });
});

describe('CMS credentials (Spec §10.3): round-trip + never returned to client', () => {
  it('encrypts at rest, exposes only hasCredentials, round-trips for the worker', async () => {
    const site = await createSite(db, admin, siteInput);
    const creds = { username: 'wp-bot', applicationPassword: 'abcd efgh ijkl mnop' };
    await setSiteCredentials(db, admin, site.id, creds);

    // The client-facing DTO must never include the ciphertext or the secret.
    const dto = await getSite(db, admin, site.id);
    expect(dto?.hasCredentials).toBe(true);
    expect(dto).not.toHaveProperty('cmsCredentialsEnc');
    expect(JSON.stringify(dto)).not.toContain('abcd efgh ijkl mnop');

    const list = await listSites(db, admin);
    expect(JSON.stringify(list)).not.toContain('abcd efgh ijkl mnop');

    // Ciphertext in the row is not the plaintext.
    const row = await db.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(row.cmsCredentialsEnc).toBeTruthy();
    expect(row.cmsCredentialsEnc).not.toContain('abcd efgh ijkl mnop');

    // Worker-side decrypt round-trips back to the original.
    const decrypted = await getSiteCredentials(db, admin, site.id);
    expect(decrypted).toEqual(creds);
  });
});

describe('every mutation writes an AuditLog row (Spec §10.1.6)', () => {
  it('records site create/update/status, credentials, keywords, style guide, settings', async () => {
    const site = await createSite(db, admin, siteInput);
    expect(await auditCount('site.created')).toBe(1);

    await updateSite(db, admin, site.id, { ...siteInput, name: 'Renamed' });
    expect(await auditCount('site.updated')).toBe(1);

    await setSiteStatus(db, admin, site.id, 'PAUSED');
    expect(await auditCount('site.status.changed')).toBe(1);

    await setSiteCredentials(db, admin, site.id, { username: 'u', applicationPassword: 'p' });
    expect(await auditCount('site.credentials.updated')).toBe(1);

    const created = await addKeywords(db, admin, { siteId: site.id, terms: ['coffee', 'tea', 'coffee'] });
    expect(created).toBe(2); // duplicate skipped
    expect(await auditCount('keywords.added')).toBe(1);

    await upsertStyleGuide(db, admin, site.id, { systemPrompt: 'Write well.', bannedPhrases: ['delve'] });
    expect(await auditCount('styleGuide.upserted')).toBe(1);

    await updateSetting(db, admin, 'monthly_budget_usd', 120);
    expect(await auditCount('settings.updated')).toBe(1);

    // Audit rows attribute the human actor.
    const createdAudit = await db.auditLog.findFirstOrThrow({ where: { action: 'site.created' } });
    expect(createdAudit.actorId).toBe(admin.id);
    expect(createdAudit.actorType).toBe('human');
  });

  it('deleteKeyword records an audit row and removes the keyword', async () => {
    const site = await createSite(db, admin, siteInput);
    await addKeywords(db, admin, { siteId: site.id, terms: ['solo'] });
    const [kw] = await listKeywords(db, admin, site.id);
    await deleteKeyword(db, admin, kw!.id);
    expect(await listKeywords(db, admin, site.id)).toHaveLength(0);
    expect(await auditCount('keyword.deleted')).toBe(1);
  });
});
