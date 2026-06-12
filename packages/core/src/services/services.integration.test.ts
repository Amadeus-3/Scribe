import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from '../test/db';
import { AuthorizationError, type Actor } from '../auth/authorize';
import {
  approveArticle,
  generateArticleDraft,
  generateArticleImage,
  listArticlePublishRecords,
  listSiteArticles,
  publishArticleToCms,
  requestArticleChanges,
  updateArticleDraft,
  uploadArticleImage,
} from './article-service';
import {
  createSite,
  updateSite,
  deleteSite,
  listSites,
  getSite,
  setSiteCredentials,
  getSiteCredentials,
  setSiteStatus,
} from './site-service';
import { upsertStyleGuide } from './style-guide-service';
import { addKeywords, deleteKeyword, listKeywords } from './keyword-service';
import { getSettingsForActor, updateSetting } from './settings-service';
import {
  getGeminiApiKey,
  getGeminiApiKeyForImageGeneration,
  getGeminiCredentialSummary,
  getOpenRouterApiKey,
  getOpenRouterCredentialSummary,
  setGeminiApiKey,
  setOpenRouterApiKey,
} from './provider-credential-service';

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
    await expect(
      generateArticleDraft(
        db,
        editor,
        { siteId: site.id, keyword: 'x' },
        { apiKey: 'openrouter-key' },
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it('VIEWER can read settings but not change them', async () => {
    await expect(getSettingsForActor(db, viewer)).resolves.toMatchObject({
      monthly_budget_usd: 50,
    });
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
    expect(decrypted).toEqual({ cmsType: 'WORDPRESS', ...creds });
  });

  it('stores Strapi credentials and returns only non-secret metadata to the admin panel', async () => {
    const site = await createSite(db, admin, {
      ...siteInput,
      cmsType: 'STRAPI',
      baseUrl: 'https://strapi.example.com',
    });
    await setSiteCredentials(db, admin, site.id, {
      cmsType: 'STRAPI',
      apiToken: 'strapi-secret-token',
      apiBaseUrl: 'https://strapi.example.com',
      collectionApiId: 'articles',
      fieldMap: {
        title: 'title',
        slug: 'slug',
        content: 'body',
        metaDescription: 'seoDescription',
      },
      contentFormat: 'HTML',
      publicationStatus: 'DRAFT',
    });

    const row = await db.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(row.cmsType).toBe('STRAPI');
    expect(row.cmsCredentialsEnc).toBeTruthy();
    expect(row.cmsCredentialsEnc).not.toContain('strapi-secret-token');

    const decrypted = await getSiteCredentials(db, admin, site.id);
    expect(decrypted).toMatchObject({
      cmsType: 'STRAPI',
      apiToken: 'strapi-secret-token',
      apiBaseUrl: 'https://strapi.example.com',
      collectionApiId: 'articles',
    });
  });

  it('clears incompatible credentials when the CMS type changes', async () => {
    const site = await createSite(db, admin, siteInput);
    await setSiteCredentials(db, admin, site.id, {
      cmsType: 'WORDPRESS',
      username: 'wp-bot',
      applicationPassword: 'abcd efgh',
    });

    await updateSite(db, admin, site.id, {
      ...siteInput,
      cmsType: 'STRAPI',
    });

    const updated = await getSite(db, admin, site.id);
    expect(updated?.cmsType).toBe('STRAPI');
    expect(updated?.hasCredentials).toBe(false);
    await expect(getSiteCredentials(db, admin, site.id)).resolves.toBeNull();
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

    const created = await addKeywords(db, admin, {
      siteId: site.id,
      terms: ['coffee', 'tea', 'coffee'],
    });
    expect(created).toBe(2); // duplicate skipped
    expect(await auditCount('keywords.added')).toBe(1);

    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write well.',
      bannedPhrases: ['delve'],
    });
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

  it('deleteSite records an audit row and removes the site', async () => {
    const site = await createSite(db, admin, siteInput);
    await deleteSite(db, admin, site.id);
    expect(await getSite(db, admin, site.id)).toBeNull();
    expect(await auditCount('site.deleted')).toBe(1);
  });
});

describe('article draft generation', () => {
  it('creates a keyword, pending-review article, revision, and audit row', async () => {
    const site = await createSite(db, admin, {
      ...siteInput,
      cmsType: 'STRAPI',
    });
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      businessContext: 'A personal finance blog.',
      audienceNotes: 'Readers learning how to build wealth.',
      seoGuidance: 'Answer informational queries clearly.',
      imagePromptInstructions: 'Use clean editorial finance imagery.',
      bannedPhrases: [],
    });

    const contentMarkdown = `# How to Build Wealth\n\n${'Useful finance guidance. '.repeat(80)}`;
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build Wealth',
                slug: 'how-to-build-wealth',
                metaDescription: 'Learn practical steps to build wealth.',
                contentMarkdown,
                imagePrompt: 'Editorial personal finance planning scene.',
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const article = await generateArticleDraft(
      db,
      admin,
      {
        siteId: site.id,
        keyword: 'how to build wealth',
      },
      { apiKey: 'openrouter-key', fetchFn },
    );

    expect(article.status).toBe('PENDING_REVIEW');
    expect(article.title).toBe('How to Build Wealth');
    expect(article.imagePrompt).toContain('personal finance');
    expect(await listSiteArticles(db, admin, site.id)).toHaveLength(1);
    expect(await db.articleRevision.count({ where: { articleId: article.id } })).toBe(1);
    expect(await auditCount('article.drafted')).toBe(1);
  });

  it('supports human edits, review decisions, and manual/generated images', async () => {
    const site = await createSite(db, admin, {
      ...siteInput,
      cmsType: 'STRAPI',
    });
    await setSiteCredentials(db, admin, site.id, {
      cmsType: 'STRAPI',
      apiToken: 'strapi-secret-token',
      apiBaseUrl: 'https://strapi.example.com',
      collectionApiId: 'articles',
      fieldMap: {
        title: 'title',
        slug: 'slug',
        content: 'body',
        metaDescription: 'seoDescription',
      },
      contentFormat: 'HTML',
      publicationStatus: 'DRAFT',
    });
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      imagePromptInstructions: 'Use clean editorial finance imagery.',
      bannedPhrases: [],
    });

    const contentMarkdown = `# How to Build Wealth\n\n${'Useful finance guidance. '.repeat(80)}`;
    const fetchDraft = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build Wealth',
                slug: 'how-to-build-wealth',
                metaDescription: 'Learn practical steps to build wealth.',
                contentMarkdown,
                imagePrompt: 'Editorial personal finance planning scene.',
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const article = await generateArticleDraft(
      db,
      admin,
      {
        siteId: site.id,
        keyword: 'how to build wealth',
      },
      { apiKey: 'openrouter-key', fetchFn: fetchDraft },
    );

    const edited = await updateArticleDraft(db, admin, article.id, {
      title: 'How to Build Wealth Safely',
      slug: 'how-to-build-wealth-safely',
      metaDescription: 'Updated meta.',
      imagePrompt: 'Updated image prompt.',
      contentMarkdown: '# Updated\n\nClear guidance.',
    });
    expect(edited.title).toBe('How to Build Wealth Safely');
    expect(await db.articleRevision.count({ where: { articleId: article.id } })).toBe(2);

    const imageFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }],
            },
          },
        ],
      }),
      text: async () => '',
    });
    const withImage = await generateArticleImage(db, admin, article.id, {
      apiKey: 'gemini-key',
      fetchFn: imageFetch,
    });
    expect(withImage.imageMimeType).toBe('image/png');
    expect(withImage.imageDataBase64).toBe('aW1hZ2U=');

    const uploadedImage = await uploadArticleImage(db, admin, article.id, {
      mimeType: 'image/webp',
      dataBase64: 'dXBsb2FkZWQ=',
    });
    expect(uploadedImage.imageMimeType).toBe('image/webp');
    expect(uploadedImage.imageDataBase64).toBe('dXBsb2FkZWQ=');

    const changes = await requestArticleChanges(db, admin, article.id, 'Needs more examples.');
    expect(changes.status).toBe('CHANGES_REQUESTED');
    const approved = await approveArticle(db, admin, article.id);
    expect(approved.status).toBe('APPROVED');

    const publishFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          id: 7,
          documentId: 'doc_123',
          slug: 'how-to-build-wealth-safely',
        },
      }),
      text: async () => '',
    });
    const published = await publishArticleToCms(db, admin, article.id, {
      fetchFn: publishFetch,
    });
    expect(published.status).toBe('PUBLISHED');
    const [publishRecord] = await listArticlePublishRecords(db, admin, article.id);
    expect(publishRecord).toMatchObject({
      status: 'success',
      cmsPostId: 'doc_123',
      url: 'https://blog.example.com/how-to-build-wealth-safely',
    });

    expect(await auditCount('article.updated')).toBe(1);
    expect(await auditCount('article.imageGenerated')).toBe(1);
    expect(await auditCount('article.imageUploaded')).toBe(1);
    expect(await auditCount('article.changesRequested')).toBe(1);
    expect(await auditCount('article.approved')).toBe(1);
    expect(await auditCount('article.published')).toBe(1);
  });
});

describe('provider credentials', () => {
  it('stores provider keys encrypted and exposes only status metadata', async () => {
    await setOpenRouterApiKey(db, admin, 'sk-or-secret');
    await setGeminiApiKey(db, admin, 'gemini-secret');

    const openRouterRow = await db.providerCredential.findUniqueOrThrow({
      where: { provider: 'openrouter' },
    });
    expect(openRouterRow.credentialsEnc).toBeTruthy();
    expect(openRouterRow.credentialsEnc).not.toContain('sk-or-secret');

    const geminiRow = await db.providerCredential.findUniqueOrThrow({
      where: { provider: 'gemini' },
    });
    expect(geminiRow.credentialsEnc).toBeTruthy();
    expect(geminiRow.credentialsEnc).not.toContain('gemini-secret');

    await expect(getOpenRouterApiKey(db, admin)).resolves.toBe('sk-or-secret');
    await expect(getOpenRouterCredentialSummary(db, admin)).resolves.toMatchObject({
      configured: true,
      hasStoredKey: true,
    });
    await expect(getGeminiApiKey(db, admin)).resolves.toBe('gemini-secret');
    await expect(getGeminiCredentialSummary(db, admin)).resolves.toMatchObject({
      configured: true,
      hasStoredKey: true,
    });
    await expect(getGeminiApiKeyForImageGeneration(db, editor)).resolves.toBe('gemini-secret');
    await expect(setOpenRouterApiKey(db, editor, 'x')).rejects.toThrow(AuthorizationError);
    await expect(setGeminiApiKey(db, editor, 'x')).rejects.toThrow(AuthorizationError);
  });
});
