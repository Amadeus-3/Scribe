import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestPrisma, truncateAll } from '../test/db';
import { AuthorizationError, type Actor } from '../auth/authorize';
import { BudgetExceededError } from '../cost/usage';
import {
  approveArticle,
  autoAssignArticleTaxonomy,
  generateArticleDraft,
  generateArticleImage,
  listArticleImages,
  listArticlePublishRecords,
  listSiteArticles,
  publishArticleToCms,
  regenerateArticleDraft,
  requestArticleChanges,
  suggestArticleInlineImages,
  updateArticleDraft,
  updateArticleKeyword,
  uploadArticleImage,
  uploadArticleInlineImage,
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
import { enqueueDiscoveredKeywords, runSiteDiscovery } from './keyword-discovery-service';
import type { KeywordSource } from '../keyword-sources/types';
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

  it('creates in-body image rows from the draft and accepts a per-image upload', async () => {
    const site = await createSite(db, admin, siteInput);
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });

    const contentMarkdown = `Intro paragraph.\n\n## Steps\n\n${'Useful guidance. '.repeat(80)}`;
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build an Emergency Fund',
                slug: 'how-to-build-an-emergency-fund',
                metaDescription: 'Practical steps to build an emergency fund on any income.',
                contentMarkdown,
                imagePrompt: 'Editorial hero image of calm financial planning.',
                inlineImages: [
                  {
                    placement: 'Steps',
                    alt: 'Flowchart of the three-step savings system',
                    aspectRatio: '16:9',
                    prompt: 'Flat-vector flowchart with three labeled stages, brand-safe, no text.',
                  },
                ],
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
      { siteId: site.id, keyword: 'how to build an emergency fund' },
      { apiKey: 'openrouter-key', fetchFn },
    );

    const images = await listArticleImages(db, admin, article.id);
    expect(images).toHaveLength(1);
    const [first] = images;
    if (!first) throw new Error('expected an in-body image');
    expect(first.placement).toBe('Steps');
    expect(first.alt).toBe('Flowchart of the three-step savings system');
    expect(first.dataBase64).toBeNull();

    // 1x1 transparent PNG.
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const uploaded = await uploadArticleInlineImage(db, admin, first.id, {
      mimeType: 'image/png',
      dataBase64: png,
    });
    expect(uploaded.mimeType).toBe('image/png');
    expect(uploaded.dataBase64).toBe(png);
    expect(await auditCount('article.inlineImageUploaded')).toBe(1);
  });

  it('publishes with category/tags connected by documentId and the in-body image embedded', async () => {
    const site = await createSite(db, admin, { ...siteInput, cmsType: 'STRAPI' });
    await setSiteCredentials(db, admin, site.id, {
      cmsType: 'STRAPI',
      apiToken: 'strapi-secret-token',
      apiBaseUrl: 'https://strapi.example.com',
      collectionApiId: 'articles',
      fieldMap: { title: 'title', slug: 'slug', content: 'content' },
      contentFormat: 'MARKDOWN',
      publicationStatus: 'DRAFT',
    });
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });

    const contentMarkdown = `Intro paragraph.\n\n## Steps\n\n${'Useful guidance. '.repeat(80)}`;
    const draftFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build an Emergency Fund',
                slug: 'how-to-build-an-emergency-fund',
                metaDescription: 'Practical steps to build an emergency fund on any income.',
                contentMarkdown,
                imagePrompt: 'Editorial hero image of calm financial planning.',
                inlineImages: [
                  {
                    placement: 'Steps',
                    alt: 'Three-step savings flowchart',
                    aspectRatio: '16:9',
                    prompt: 'Flat-vector flowchart with three labeled stages, brand-safe, no text.',
                  },
                ],
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
      { siteId: site.id, keyword: 'how to build an emergency fund' },
      { apiKey: 'openrouter-key', fetchFn: draftFetch },
    );

    const [image] = await listArticleImages(db, admin, article.id);
    if (!image) throw new Error('expected an in-body image');
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await uploadArticleInlineImage(db, admin, image.id, { mimeType: 'image/png', dataBase64: png });

    await updateArticleDraft(db, admin, article.id, {
      title: 'How to Build an Emergency Fund',
      contentMarkdown,
      categorySlug: 'how-to-guides',
      tagSlugs: ['investing'],
    });
    await approveArticle(db, admin, article.id);

    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const jsonOk = (value: unknown) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => value,
    });
    const publishFetch = async (url: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.includes('/api/categories')) {
        return jsonOk({ data: [{ id: 1, documentId: 'cat_doc', name: 'How to guides', slug: 'how-to-guides' }] });
      }
      if (url.includes('/api/tags')) {
        return jsonOk({ data: [{ id: 1, documentId: 'tag_doc', name: 'investing', slug: 'investing' }] });
      }
      if (url.includes('/api/upload')) {
        return jsonOk([{ id: 99, url: 'https://cdn.example.com/inline.png' }]);
      }
      return jsonOk({ data: { id: 7, documentId: 'art_doc', slug: 'how-to-build-an-emergency-fund' } });
    };

    const published = await publishArticleToCms(db, admin, article.id, { fetchFn: publishFetch });
    expect(published.status).toBe('PUBLISHED');

    const createCall = calls.find(
      (call) => call.url.includes('/api/articles') && typeof call.body === 'string',
    );
    if (!createCall || typeof createCall.body !== 'string') throw new Error('no create call');
    const payload = JSON.parse(createCall.body) as { data: Record<string, unknown> };
    expect(payload.data.category).toEqual({ connect: [{ documentId: 'cat_doc' }] });
    expect(payload.data.tags).toEqual({ connect: [{ documentId: 'tag_doc' }] });
    expect(String(payload.data.content)).toContain(
      '![Three-step savings flowchart](https://cdn.example.com/inline.png)',
    );
  });

  it('lets the model self-assign category/tags, keeping only existing slugs', async () => {
    const site = await createSite(db, admin, { ...siteInput, cmsType: 'STRAPI' });
    await setSiteCredentials(db, admin, site.id, {
      cmsType: 'STRAPI',
      apiToken: 'strapi-secret-token',
      apiBaseUrl: 'https://strapi.example.com',
      collectionApiId: 'articles',
      fieldMap: { title: 'title', slug: 'slug', content: 'content' },
      contentFormat: 'MARKDOWN',
      publicationStatus: 'DRAFT',
    });
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });

    const contentMarkdown = `# How to Build Wealth\n\n${'Useful guidance. '.repeat(80)}`;
    const jsonOk = (value: unknown) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => value,
    });
    const fetchFn = async (url: string) => {
      if (url.includes('/api/categories')) {
        return jsonOk({ data: [{ id: 1, documentId: 'c1', name: 'How to guides', slug: 'how-to-guides' }] });
      }
      if (url.includes('/api/tags')) {
        return jsonOk({
          data: [
            { id: 1, documentId: 't1', name: 'Investing', slug: 'investing' },
            { id: 2, documentId: 't2', name: 'ETFS', slug: 'etfs' },
          ],
        });
      }
      return jsonOk({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build Wealth',
                slug: 'how-to-build-wealth',
                metaDescription: 'Practical steps to build wealth.',
                contentMarkdown,
                imagePrompt: 'Editorial hero image of personal finance planning.',
                categorySlug: 'how-to-guides',
                tagSlugs: ['investing', 'made-up-tag'],
              }),
            },
          },
        ],
      });
    };

    const article = await generateArticleDraft(
      db,
      admin,
      { siteId: site.id, keyword: 'how to build wealth' },
      { apiKey: 'openrouter-key', fetchFn },
    );

    expect(article.categorySlug).toBe('how-to-guides');
    expect(article.tagSlugs).toEqual(['investing']);
  });

  it('classifies an existing article into the taxonomy on demand (existing slugs only)', async () => {
    const site = await createSite(db, admin, { ...siteInput, cmsType: 'STRAPI' });
    await setSiteCredentials(db, admin, site.id, {
      cmsType: 'STRAPI',
      apiToken: 'strapi-secret-token',
      apiBaseUrl: 'https://strapi.example.com',
      collectionApiId: 'articles',
      fieldMap: { title: 'title', slug: 'slug', content: 'content' },
      contentFormat: 'MARKDOWN',
      publicationStatus: 'DRAFT',
    });
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });

    const contentMarkdown = `# How to Build Wealth\n\n${'Useful guidance. '.repeat(80)}`;
    const jsonOk = (value: unknown) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => value,
    });

    // Draft phase: the model assigns nothing, simulating a pre-feature article.
    const draftFetch = async (url: string) => {
      if (url.includes('/api/categories')) {
        return jsonOk({ data: [{ id: 1, documentId: 'c1', name: 'How to guides', slug: 'how-to-guides' }] });
      }
      if (url.includes('/api/tags')) {
        return jsonOk({ data: [{ id: 1, documentId: 't1', name: 'Investing', slug: 'investing' }] });
      }
      return jsonOk({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build Wealth',
                slug: 'how-to-build-wealth',
                metaDescription: 'Practical steps to build wealth.',
                contentMarkdown,
                imagePrompt: 'Editorial hero image of personal finance planning.',
                categorySlug: null,
                tagSlugs: [],
              }),
            },
          },
        ],
      });
    };
    const article = await generateArticleDraft(
      db,
      admin,
      { siteId: site.id, keyword: 'how to build wealth' },
      { apiKey: 'openrouter-key', fetchFn: draftFetch },
    );
    expect(article.categorySlug).toBeNull();
    expect(article.tagSlugs).toEqual([]);

    // Classify phase: the model picks a real category + a real tag + a made-up tag (dropped).
    const assignFetch = async (url: string) => {
      if (url.includes('/api/categories')) {
        return jsonOk({ data: [{ id: 1, documentId: 'c1', name: 'How to guides', slug: 'how-to-guides' }] });
      }
      if (url.includes('/api/tags')) {
        return jsonOk({ data: [{ id: 1, documentId: 't1', name: 'Investing', slug: 'investing' }] });
      }
      return jsonOk({
        choices: [
          { message: { content: JSON.stringify({ categorySlug: 'how-to-guides', tagSlugs: ['investing', 'made-up'] }) } },
        ],
      });
    };
    const assigned = await autoAssignArticleTaxonomy(db, admin, article.id, {
      apiKey: 'openrouter-key',
      fetchFn: assignFetch,
    });
    expect(assigned.categorySlug).toBe('how-to-guides');
    expect(assigned.tagSlugs).toEqual(['investing']);
    expect(await auditCount('article.taxonomyAssigned')).toBe(1);
  });

  it('suggests in-body images for an existing article that has none', async () => {
    const site = await createSite(db, admin, siteInput);
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      imagePromptInstructions: 'Clean editorial finance imagery.',
      bannedPhrases: [],
    });

    const contentMarkdown = `# How to Build Wealth\n\n## Steps\n\n${'Useful guidance. '.repeat(80)}`;
    const draftFetch = async () => ({
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
                metaDescription: 'Practical steps to build wealth.',
                contentMarkdown,
                imagePrompt: 'Editorial hero image of personal finance planning.',
                inlineImages: [],
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
      { siteId: site.id, keyword: 'how to build wealth' },
      { apiKey: 'openrouter-key', fetchFn: draftFetch },
    );
    expect(await listArticleImages(db, admin, article.id)).toHaveLength(0);

    const suggestFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                inlineImages: [
                  {
                    placement: 'Steps',
                    alt: 'Three-step savings flowchart',
                    aspectRatio: '16:9',
                    prompt: 'Flat-vector flowchart with three labeled stages, brand-safe, no text.',
                  },
                ],
              }),
            },
          },
        ],
      }),
    });
    const created = await suggestArticleInlineImages(db, admin, article.id, {
      apiKey: 'openrouter-key',
      fetchFn: suggestFetch,
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.placement).toBe('Steps');

    const images = await listArticleImages(db, admin, article.id);
    expect(images).toHaveLength(1);
    expect(await auditCount('article.inlineImagesSuggested')).toBe(1);

    await expect(
      suggestArticleInlineImages(db, admin, article.id, {
        apiKey: 'openrouter-key',
        fetchFn: suggestFetch,
      }),
    ).rejects.toThrow(/already has in-body images/);
  });

  it('regenerates with comments + SEO, preserving taxonomy and in-body images', async () => {
    const site = await createSite(db, admin, siteInput);
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });
    const okJson = (value: unknown) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => value,
    });

    const v1 = `# How to Build Wealth\n\n## Steps\n\n${'Thin content. '.repeat(80)}`;
    const draftFetch = async () =>
      okJson({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build Wealth',
                slug: 'how-to-build-wealth',
                metaDescription: 'Practical steps to build wealth.',
                contentMarkdown: v1,
                imagePrompt: 'Editorial hero image of personal finance planning.',
                inlineImages: [
                  {
                    placement: 'Steps',
                    alt: 'Savings flowchart',
                    aspectRatio: '16:9',
                    prompt: 'Flat-vector flowchart, brand-safe, no text.',
                  },
                ],
              }),
            },
          },
        ],
      });
    const article = await generateArticleDraft(
      db,
      admin,
      { siteId: site.id, keyword: 'how to build wealth' },
      { apiKey: 'openrouter-key', fetchFn: draftFetch },
    );
    // Reviewer sets taxonomy manually.
    await updateArticleDraft(db, admin, article.id, {
      title: 'How to Build Wealth',
      contentMarkdown: v1,
      categorySlug: 'how-to-guides',
      tagSlugs: ['investing'],
    });
    expect(await listArticleImages(db, admin, article.id)).toHaveLength(1);

    const v2 = `# How to Build Wealth Fast\n\n## Steps\n\n${'Much richer guidance with examples. '.repeat(80)}`;
    const regenFetch = async () =>
      okJson({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build Wealth Fast in 2026',
                slug: 'how-to-build-wealth-fast',
                metaDescription:
                  'A practical, detailed guide to building wealth with real examples and steps.',
                contentMarkdown: v2,
                imagePrompt: 'Editorial hero image v2.',
                inlineImages: [],
              }),
            },
          },
        ],
      });
    const regenerated = await regenerateArticleDraft(
      db,
      admin,
      article.id,
      { comments: 'Add concrete examples.' },
      { apiKey: 'openrouter-key', fetchFn: regenFetch },
    );

    expect(regenerated.title).toBe('How to Build Wealth Fast in 2026');
    expect(regenerated.status).toBe('PENDING_REVIEW');
    expect(regenerated.categorySlug).toBe('how-to-guides');
    expect(regenerated.tagSlugs).toEqual(['investing']);
    expect(await listArticleImages(db, admin, article.id)).toHaveLength(1);
    expect(await db.articleRevision.count({ where: { articleId: article.id } })).toBe(3);
    expect(await auditCount('article.regenerated')).toBe(1);

    // A published article can still be regenerated — it returns to review.
    await db.article.update({ where: { id: article.id }, data: { status: 'PUBLISHED' } });
    const reRegenerated = await regenerateArticleDraft(
      db,
      admin,
      article.id,
      {},
      { apiKey: 'openrouter-key', fetchFn: regenFetch },
    );
    expect(reRegenerated.status).toBe('PENDING_REVIEW');
  });

  it('edits the primary keyword, re-scores, and rejects a duplicate term', async () => {
    const site = await createSite(db, admin, siteInput);
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });
    const contentMarkdown = `# How to Build Wealth\n\n## Steps\n\n${'Useful guidance. '.repeat(80)}`;
    const draftFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build Wealth',
                slug: 'how-to-build-wealth',
                metaDescription: 'Practical steps to build wealth.',
                contentMarkdown,
                imagePrompt: 'Editorial hero image of personal finance planning.',
                inlineImages: [],
              }),
            },
          },
        ],
      }),
    });
    const article = await generateArticleDraft(
      db,
      admin,
      { siteId: site.id, keyword: 'how to build wealth' },
      { apiKey: 'openrouter-key', fetchFn: draftFetch },
    );
    expect(article.keyword).toBe('how to build wealth');

    const updated = await updateArticleKeyword(db, admin, article.id, 'build wealth fast');
    expect(updated.keyword).toBe('build wealth fast');
    expect(updated.seoReport).not.toBeNull();
    expect(await auditCount('article.keywordUpdated')).toBe(1);

    // A term already used by another keyword on the site is rejected.
    await addKeywords(db, admin, { siteId: site.id, terms: ['taken term'] });
    await expect(updateArticleKeyword(db, admin, article.id, 'taken term')).rejects.toThrow(
      /already exists/,
    );
  });

  it('republishes an edited article by updating the existing CMS entry in place', async () => {
    const site = await createSite(db, admin, { ...siteInput, cmsType: 'STRAPI' });
    await setSiteCredentials(db, admin, site.id, {
      cmsType: 'STRAPI',
      apiToken: 'strapi-secret-token',
      apiBaseUrl: 'https://strapi.example.com',
      collectionApiId: 'articles',
      fieldMap: { title: 'title', slug: 'slug', content: 'content' },
      contentFormat: 'MARKDOWN',
      publicationStatus: 'DRAFT',
    });
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });

    const contentMarkdown = `# How to Build Wealth\n\n## Steps\n\n${'Useful guidance. '.repeat(80)}`;
    const draftFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'How to Build Wealth',
                slug: 'how-to-build-wealth',
                metaDescription: 'Practical steps to build wealth.',
                contentMarkdown,
                imagePrompt: 'Editorial hero image of personal finance planning.',
                inlineImages: [],
              }),
            },
          },
        ],
      }),
    });
    const article = await generateArticleDraft(
      db,
      admin,
      { siteId: site.id, keyword: 'how to build wealth' },
      { apiKey: 'openrouter-key', fetchFn: draftFetch },
    );
    await approveArticle(db, admin, article.id);

    const calls: Array<{ url: string; method?: string }> = [];
    const jsonOk = (value: unknown) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => value,
    });
    const publishFetch = async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method });
      return jsonOk({ data: { id: 7, documentId: 'doc_1', slug: 'how-to-build-wealth' } });
    };

    // First publish → creates a new CMS entry.
    await publishArticleToCms(db, admin, article.id, { fetchFn: publishFetch });
    expect(calls.some((c) => /\/api\/articles\?/.test(c.url) && c.method === 'POST')).toBe(true);

    // Edit the published article → it returns to review → approve again.
    await updateArticleDraft(db, admin, article.id, {
      title: 'How to Build Wealth (Updated)',
      contentMarkdown: `# How to Build Wealth\n\n## Steps\n\n${'Even better guidance. '.repeat(80)}`,
    });
    await approveArticle(db, admin, article.id);

    calls.length = 0;
    // Second publish → updates the existing entry in place (PUT), no new create.
    const republished = await publishArticleToCms(db, admin, article.id, { fetchFn: publishFetch });
    expect(republished.status).toBe('PUBLISHED');
    expect(calls.some((c) => c.url.includes('/api/articles/doc_1') && c.method === 'PUT')).toBe(true);
    expect(calls.some((c) => /\/api\/articles\?/.test(c.url) && c.method === 'POST')).toBe(false);

    const records = await listArticlePublishRecords(db, admin, article.id);
    expect(records.filter((r) => r.status === 'success')).toHaveLength(2);
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
    expect(approved.article.status).toBe('APPROVED');
    // No emitter supplied, so approval is a pure state change and nothing
    // reaches the CMS on its own.
    expect(approved.publish).toBe('not_configured');

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

describe('keyword discovery (Phase 6)', () => {
  it('enqueues discovered keywords with provenance and dedupes vs existing', async () => {
    const site = await createSite(db, admin, siteInput);
    await addKeywords(db, admin, { siteId: site.id, terms: ['existing term'] });

    const result = await enqueueDiscoveredKeywords(db, admin, {
      siteId: site.id,
      keywords: [
        {
          term: 'new trending topic',
          source: 'google_trends',
          score: 0.8,
          metadata: { kind: 'google_trends', relevance: 0.8 },
        },
        { term: 'Existing Term', source: 'llm_web', score: 0.9 }, // dup (case-insensitive)
      ],
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);

    const kws = await listKeywords(db, admin, site.id);
    const found = kws.find((k) => k.term === 'new trending topic');
    expect(found?.source).toBe('google_trends');
    expect(found?.discoveryScore).toBeCloseTo(0.8, 5);
    expect(found?.priority).toBe(80);
    expect(found?.status).toBe('QUEUED');
    expect(await auditCount('keywords.discovered')).toBe(1);
  });

  it('runs discovery sources end-to-end and queues the results', async () => {
    const site = await createSite(db, admin, siteInput);
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
      topicPillars: ['home espresso'],
      geo: 'us',
    });

    const mockSource: KeywordSource = {
      id: 'llm_web',
      isEnabled: () => true,
      discover: async () => [{ term: 'discovered topic', source: 'llm_web', score: 0.7 }],
    };

    const result = await runSiteDiscovery(db, admin, site.id, {
      sources: [mockSource],
      fetchFn: async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}), text: async () => '' }),
    });

    expect(result.created).toBe(1);
    expect(result.candidates).toBe(1);
    const kws = await listKeywords(db, admin, site.id);
    expect(kws.some((k) => k.term === 'discovered topic' && k.source === 'llm_web')).toBe(true);

    // Topic fields persisted on the style guide.
    const guide = await db.styleGuide.findUnique({ where: { siteId: site.id } });
    expect(guide?.topicPillars).toEqual(['home espresso']);
    expect(guide?.geo).toBe('US');
  });
});

describe('usage + budget (cost accounting, Spec §7.4 / §10.7)', () => {
  const draftFetch = (usage?: Record<string, unknown>) => async () => ({
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
              metaDescription: 'Learn practical steps to build wealth on any income today.',
              contentMarkdown: `# How to Build Wealth\n\n${'Useful finance guidance. '.repeat(80)}`,
              imagePrompt: 'Editorial personal finance planning scene.',
            }),
          },
        },
      ],
      ...(usage ? { usage } : {}),
    }),
    text: async () => '',
  });

  it('records a UsageRecord and per-article cost for a draft', async () => {
    const site = await createSite(db, admin, siteInput);
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });

    const article = await generateArticleDraft(
      db,
      admin,
      { siteId: site.id, keyword: 'how to build wealth' },
      {
        apiKey: 'openrouter-key',
        // Default draft model '~anthropic/claude-sonnet-latest' priced at 3/15 per MTok.
        fetchFn: draftFetch({ prompt_tokens: 100_000, completion_tokens: 20_000 }),
      },
    );

    const usage = await db.usageRecord.findFirst({
      where: { articleId: article.id, purpose: 'draft' },
    });
    expect(usage).not.toBeNull();
    expect(usage?.provider).toBe('openrouter');
    expect(usage?.inputTokens).toBe(100_000);
    expect(usage?.outputTokens).toBe(20_000);
    // (100_000*3 + 20_000*15) / 1e6 = 0.6
    expect(Number(usage?.costUsd)).toBeCloseTo(0.6, 4);

    const row = await db.article.findUnique({
      where: { id: article.id },
      select: { costUsd: true },
    });
    expect(Number(row?.costUsd)).toBeCloseTo(0.6, 4);
  });

  it('blocks generation (without calling the provider) once the monthly budget is reached', async () => {
    const site = await createSite(db, admin, siteInput);
    await upsertStyleGuide(db, admin, site.id, {
      systemPrompt: 'Write practical articles.',
      bannedPhrases: [],
    });

    await updateSetting(db, admin, 'monthly_budget_usd', 0.01);
    await db.usageRecord.create({
      data: {
        provider: 'openrouter',
        model: 'm',
        purpose: 'draft',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 1,
      },
    });

    const fetchSpy = vi.fn(draftFetch({ prompt_tokens: 10, completion_tokens: 10 }));

    await expect(
      generateArticleDraft(
        db,
        admin,
        { siteId: site.id, keyword: 'how to build wealth' },
        { apiKey: 'openrouter-key', fetchFn: fetchSpy },
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    // The guard runs before the paid call — the provider must not be hit.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await listSiteArticles(db, admin, site.id)).toHaveLength(0);
  });
});
