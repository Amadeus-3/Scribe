import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  prisma,
  getSite,
  getSiteCredentialsSummary,
  getStyleGuide,
  listKeywords,
  listSiteArticles,
  can,
} from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Field, Badge, inputClass } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import {
  updateSiteAction,
  deleteSiteAction,
  setCredentialsAction,
  suggestStyleGuideAction,
  generateArticleDraftAction,
  upsertStyleGuideAction,
  addKeywordsAction,
  deleteKeywordAction,
  setSiteStatusAction,
} from '@/server/actions';

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const site = await getSite(prisma, actor, id);
  if (!site) notFound();

  const [guide, keywords, articles] = await Promise.all([
    getStyleGuide(prisma, actor, id),
    listKeywords(prisma, actor, id),
    listSiteArticles(prisma, actor, id),
  ]);

  const canEdit = can(actor.role, 'site.update');
  const canDelete = can(actor.role, 'site.delete');
  const canCreds = can(actor.role, 'site.credentials.manage');
  const canGuide = can(actor.role, 'styleGuide.update');
  const canKw = can(actor.role, 'keyword.create');
  const canGenerateArticle = can(actor.role, 'article.create');
  const credentialSummary = canCreds ? await getSiteCredentialsSummary(prisma, actor, id) : null;
  const bannedText = Array.isArray(guide?.bannedPhrases)
    ? (guide?.bannedPhrases as string[]).join('\n')
    : '';

  return (
    <>
      <PageHeader
        title={site.name}
        description={site.baseUrl}
        actions={
          <>
            <Badge tone={site.status === 'ACTIVE' ? 'ok' : 'muted'}>{site.status}</Badge>
            <Link href="/sites" className="text-sm text-muted hover:text-fg">
              ← All sites
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {canEdit ? (
          <Card title="Details" description="Public website settings and CMS type.">
            <ActionForm action={updateSiteAction} submitLabel="Save details">
              <input type="hidden" name="id" value={site.id} />
              <Field label="Name" name="name">
                <input
                  id="name"
                  name="name"
                  defaultValue={site.name}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Public website URL" name="baseUrl">
                <input
                  id="baseUrl"
                  name="baseUrl"
                  type="url"
                  defaultValue={site.baseUrl}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Article CMS" name="cmsType">
                <select
                  id="cmsType"
                  name="cmsType"
                  defaultValue={site.cmsType}
                  className={inputClass}
                >
                  <option value="STRAPI">Strapi</option>
                  <option value="WORDPRESS">WordPress</option>
                </select>
              </Field>
              <Field label="Default author" name="defaultAuthor">
                <input
                  id="defaultAuthor"
                  name="defaultAuthor"
                  defaultValue={site.defaultAuthor ?? ''}
                  className={inputClass}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="briefAutoApprove"
                  defaultChecked={site.briefAutoApprove}
                />{' '}
                Auto-approve briefs
              </label>
            </ActionForm>
            <form action={setSiteStatusAction} className="mt-3 border-t border-border pt-3">
              <input type="hidden" name="id" value={site.id} />
              <input
                type="hidden"
                name="status"
                value={site.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}
              />
              <button className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-fg">
                {site.status === 'ACTIVE' ? 'Pause site' : 'Activate site'}
              </button>
            </form>
          </Card>
        ) : null}

        {canCreds && credentialSummary?.cmsType === 'WORDPRESS' ? (
          <Card
            title="WordPress credentials"
            description="Application Password on a least-privilege account. Stored AES-256-GCM encrypted; never shown back."
          >
            <p className="mb-2 text-xs">
              Status:{' '}
              {site.hasCredentials ? (
                <Badge tone="ok">configured</Badge>
              ) : (
                <Badge tone="muted">not set</Badge>
              )}
            </p>
            <ActionForm action={setCredentialsAction} submitLabel="Save credentials">
              <input type="hidden" name="id" value={site.id} />
              <input type="hidden" name="cmsType" value="WORDPRESS" />
              <Field label="Username" name="username">
                <input
                  id="username"
                  name="username"
                  required
                  defaultValue={credentialSummary.username ?? ''}
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Application password"
                name="applicationPassword"
                hint={site.hasCredentials ? 'Leave blank to keep the current password.' : undefined}
              >
                <input
                  id="applicationPassword"
                  name="applicationPassword"
                  type="password"
                  required={!site.hasCredentials}
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
            </ActionForm>
          </Card>
        ) : null}

        {canCreds && credentialSummary?.cmsType === 'STRAPI' ? (
          <Card
            title="Strapi credentials"
            description="Content API token and collection mapping. Token is encrypted and never shown back."
          >
            <p className="mb-2 text-xs">
              Status:{' '}
              {site.hasCredentials ? (
                <Badge tone="ok">configured</Badge>
              ) : (
                <Badge tone="muted">not set</Badge>
              )}
            </p>
            <ActionForm action={setCredentialsAction} submitLabel="Save Strapi config">
              <input type="hidden" name="id" value={site.id} />
              <input type="hidden" name="cmsType" value="STRAPI" />
              <Field label="Strapi API URL" name="apiBaseUrl">
                <input
                  id="apiBaseUrl"
                  name="apiBaseUrl"
                  type="url"
                  required
                  defaultValue={credentialSummary.apiBaseUrl ?? ''}
                  placeholder="https://strapi.example.com"
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="API token"
                name="apiToken"
                hint={site.hasCredentials ? 'Leave blank to keep the current token.' : undefined}
              >
                <input
                  id="apiToken"
                  name="apiToken"
                  type="password"
                  required={!site.hasCredentials}
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Collection API ID" name="collectionApiId" hint="Usually articles">
                  <input
                    id="collectionApiId"
                    name="collectionApiId"
                    required
                    defaultValue={credentialSummary.collectionApiId}
                    className={inputClass}
                  />
                </Field>
                <Field label="Locale" name="locale" hint="Optional">
                  <input
                    id="locale"
                    name="locale"
                    defaultValue={credentialSummary.locale ?? ''}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title field" name="fieldMap.title">
                  <input
                    id="fieldMap.title"
                    name="fieldMap.title"
                    required
                    defaultValue={credentialSummary.fieldMap.title}
                    className={inputClass}
                  />
                </Field>
                <Field label="Slug field" name="fieldMap.slug">
                  <input
                    id="fieldMap.slug"
                    name="fieldMap.slug"
                    required
                    defaultValue={credentialSummary.fieldMap.slug}
                    className={inputClass}
                  />
                </Field>
                <Field label="Content field" name="fieldMap.content">
                  <input
                    id="fieldMap.content"
                    name="fieldMap.content"
                    required
                    defaultValue={credentialSummary.fieldMap.content}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Description field"
                  name="fieldMap.metaDescription"
                  hint="Your Article content type uses description"
                >
                  <input
                    id="fieldMap.metaDescription"
                    name="fieldMap.metaDescription"
                    defaultValue={credentialSummary.fieldMap.metaDescription ?? ''}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Image field" name="fieldMap.image" hint="Optional media field">
                  <input
                    id="fieldMap.image"
                    name="fieldMap.image"
                    defaultValue={credentialSummary.fieldMap.image ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Read time field" name="fieldMap.readTime" hint="Optional">
                  <input
                    id="fieldMap.readTime"
                    name="fieldMap.readTime"
                    defaultValue={credentialSummary.fieldMap.readTime ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Author field" name="fieldMap.author" hint="Optional">
                  <input
                    id="fieldMap.author"
                    name="fieldMap.author"
                    defaultValue={credentialSummary.fieldMap.author ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Date field" name="fieldMap.date" hint="Optional">
                  <input
                    id="fieldMap.date"
                    name="fieldMap.date"
                    defaultValue={credentialSummary.fieldMap.date ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Featured field" name="fieldMap.featured" hint="Optional boolean">
                  <input
                    id="fieldMap.featured"
                    name="fieldMap.featured"
                    defaultValue={credentialSummary.fieldMap.featured ?? ''}
                    className={inputClass}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Content format" name="contentFormat">
                  <select
                    id="contentFormat"
                    name="contentFormat"
                    defaultValue={credentialSummary.contentFormat}
                    className={inputClass}
                  >
                    <option value="HTML">HTML string</option>
                    <option value="MARKDOWN">Markdown string</option>
                    <option value="STRAPI_BLOCKS">Strapi blocks</option>
                  </select>
                </Field>
                <Field
                  label="When publishing from Scribe"
                  name="publicationStatus"
                  hint="Draft creates a Strapi draft that must still be published in Strapi."
                >
                  <select
                    id="publicationStatus"
                    name="publicationStatus"
                    defaultValue={credentialSummary.publicationStatus}
                    className={inputClass}
                  >
                    <option value="PUBLISHED">Create public published entry</option>
                    <option value="DRAFT">Create Strapi draft only</option>
                  </select>
                </Field>
              </div>
            </ActionForm>
          </Card>
        ) : null}

        {canGuide ? (
          <Card
            title="Style guide"
            description="Site context, article rules, and reusable image prompt direction."
          >
            <ActionForm action={suggestStyleGuideAction} submitLabel="Suggest with AI">
              <input type="hidden" name="siteId" value={site.id} />
              <Field label="Extra context" name="contextNotes" hint="Optional owner notes">
                <textarea
                  id="contextNotes"
                  name="contextNotes"
                  rows={3}
                  className={inputClass}
                  placeholder="Business model, offers, audience, preferred article angles, visual style..."
                />
              </Field>
            </ActionForm>

            <ActionForm
              action={upsertStyleGuideAction}
              submitLabel="Save style guide"
              className="mt-4 border-t border-border pt-4"
            >
              <input type="hidden" name="siteId" value={site.id} />
              <Field label="System prompt" name="systemPrompt">
                <textarea
                  id="systemPrompt"
                  name="systemPrompt"
                  required
                  rows={5}
                  defaultValue={guide?.systemPrompt ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Business context" name="businessContext">
                <textarea
                  id="businessContext"
                  name="businessContext"
                  rows={5}
                  defaultValue={guide?.businessContext ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Audience notes" name="audienceNotes">
                <textarea
                  id="audienceNotes"
                  name="audienceNotes"
                  rows={4}
                  defaultValue={guide?.audienceNotes ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="SEO guidance" name="seoGuidance">
                <textarea
                  id="seoGuidance"
                  name="seoGuidance"
                  rows={4}
                  defaultValue={guide?.seoGuidance ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Image prompt instructions" name="imagePromptInstructions">
                <textarea
                  id="imagePromptInstructions"
                  name="imagePromptInstructions"
                  rows={4}
                  defaultValue={guide?.imagePromptInstructions ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Tone notes" name="toneNotes">
                <textarea
                  id="toneNotes"
                  name="toneNotes"
                  rows={3}
                  defaultValue={guide?.toneNotes ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Formatting rules" name="formattingRules">
                <textarea
                  id="formattingRules"
                  name="formattingRules"
                  rows={4}
                  defaultValue={guide?.formattingRules ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Reading level" name="readingLevel" hint="e.g. Grade 8">
                <input
                  id="readingLevel"
                  name="readingLevel"
                  defaultValue={guide?.readingLevel ?? ''}
                  className={inputClass}
                />
              </Field>
              <Field label="Banned phrases" name="bannedPhrases" hint="One per line">
                <textarea
                  id="bannedPhrases"
                  name="bannedPhrases"
                  rows={3}
                  defaultValue={bannedText}
                  className={inputClass}
                />
              </Field>
            </ActionForm>
          </Card>
        ) : null}

        <Card title={`Keywords (${keywords.length})`} description="Manual seed list for this site.">
          {canKw ? (
            <ActionForm action={addKeywordsAction} submitLabel="Add keywords">
              <input type="hidden" name="siteId" value={site.id} />
              <Field label="Seed list" name="terms" hint="One keyword per line; duplicates skipped">
                <textarea id="terms" name="terms" rows={3} className={inputClass} />
              </Field>
            </ActionForm>
          ) : null}
          <ul className="mt-3 grid gap-1">
            {keywords.length === 0 ? (
              <li className="text-sm text-muted">No keywords yet.</li>
            ) : (
              keywords.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between border-t border-border py-1.5 text-sm"
                >
                  <span>
                    {k.term} <Badge tone="muted">{k.status}</Badge>
                  </span>
                  {can(actor.role, 'keyword.delete') ? (
                    <form action={deleteKeywordAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <input type="hidden" name="siteId" value={site.id} />
                      <button className="text-xs text-muted hover:text-danger">remove</button>
                    </form>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </Card>

        <Card
          title={`Articles (${articles.length})`}
          description="Generate draft articles and review saved outputs."
        >
          {canGenerateArticle ? (
            <ActionForm action={generateArticleDraftAction} submitLabel="Generate draft">
              <input type="hidden" name="siteId" value={site.id} />
              <Field label="Keyword" name="keyword">
                <input
                  id="keyword"
                  name="keyword"
                  required
                  className={inputClass}
                  placeholder="how to build wealth in your 30s"
                />
              </Field>
              <Field label="Article instructions" name="instructions" hint="Optional">
                <textarea
                  id="instructions"
                  name="instructions"
                  rows={3}
                  className={inputClass}
                  placeholder="Angle, examples to include, things to avoid..."
                />
              </Field>
            </ActionForm>
          ) : null}
          <ul className="mt-3 grid gap-1">
            {articles.length === 0 ? (
              <li className="text-sm text-muted">No articles yet.</li>
            ) : (
              articles.map((article) => (
                <li key={article.id} className="border-t border-border py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/articles/${article.id}`} className="text-accent hover:underline">
                      {article.title ?? 'Untitled article'}
                    </Link>
                    <Badge tone="muted">{article.status}</Badge>
                  </div>
                  {article.metaDescription ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {article.metaDescription}
                    </p>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </Card>

        {canDelete ? (
          <Card
            title="Delete site"
            description="Deletes this site and its related style guide, keywords, articles, and publish records."
          >
            <ActionForm action={deleteSiteAction} submitLabel="Delete site">
              <input type="hidden" name="id" value={site.id} />
              <Field label={`Type ${site.name} to confirm`} name="confirmName">
                <input id="confirmName" name="confirmName" required className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
