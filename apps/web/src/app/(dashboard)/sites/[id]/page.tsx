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
import {
  PageHeader,
  Card,
  Field,
  Badge,
  Disclosure,
  EmptyState,
  StatusBadge,
  StepList,
  buttonClass,
  inputClass,
} from '@/components/ui';
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
  discoverKeywordsAction,
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
  const topicLines = (value: unknown): string =>
    Array.isArray(value) ? (value as string[]).filter((v) => typeof v === 'string').join('\n') : '';
  const pillarsText = topicLines(guide?.topicPillars);
  const clustersText = topicLines(guide?.topicClusters);
  const excludedText = topicLines(guide?.excludedTopics);

  return (
    <>
      <PageHeader
        title={site.name}
        description={site.baseUrl}
        actions={
          <>
            <StatusBadge status={site.status} />
            <Link href="/sites" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              All sites
            </Link>
          </>
        }
      />

      <Card
        title="Set up this site"
        description="Finish these to start generating and publishing articles."
        className="mb-4"
      >
        <StepList
          steps={[
            { label: '1. Site details', description: `${site.cmsType} CMS · ${site.baseUrl}`, done: true },
            {
              label: '2. Connect the CMS',
              description: site.hasCredentials
                ? 'Credentials saved.'
                : 'Add the API token + URL below.',
              done: site.hasCredentials,
            },
            {
              label: '3. Style guide',
              description: guide ? 'Saved — used for every draft.' : 'Use “Suggest with AI”, then save.',
              done: Boolean(guide),
            },
            {
              label: '4. Add keywords',
              description:
                keywords.length > 0
                  ? `${keywords.length} in the queue.`
                  : 'Seed a few, or “Discover trending topics”.',
              done: keywords.length > 0,
            },
            {
              label: '5. Generate an article',
              description:
                articles.length > 0 ? `${articles.length} draft(s).` : 'Pick a keyword and generate.',
              done: articles.length > 0,
            },
          ]}
        />
      </Card>

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
              <label className="flex items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="briefAutoApprove"
                  defaultChecked={site.briefAutoApprove}
                />{' '}
                Auto-approve briefs
              </label>
              <Disclosure
                summary="Trending-topic discovery"
                hint="optional"
                defaultOpen={Boolean(site.gscPropertyUrl) || site.discoveryEnabled}
              >
                <Field
                  label="Google Search Console property"
                  name="gscPropertyUrl"
                  hint="e.g. sc-domain:example.com or https://example.com/"
                >
                  <input
                    id="gscPropertyUrl"
                    name="gscPropertyUrl"
                    defaultValue={site.gscPropertyUrl ?? ''}
                    placeholder="sc-domain:example.com"
                    className={inputClass}
                  />
                </Field>
                <label className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    name="discoveryEnabled"
                    defaultChecked={site.discoveryEnabled}
                  />{' '}
                  Include in the weekly auto-discovery run
                </label>
              </Disclosure>
            </ActionForm>
            <form action={setSiteStatusAction} className="mt-3 border-t border-border pt-3">
              <input type="hidden" name="id" value={site.id} />
              <input
                type="hidden"
                name="status"
                value={site.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}
              />
              <button className={buttonClass({ variant: 'secondary', size: 'sm' })}>
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
            <div className="mb-3 flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">Status</span>
              {site.hasCredentials ? (
                <Badge tone="ok">configured</Badge>
              ) : (
                <Badge tone="warn">not set</Badge>
              )}
            </div>
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
            <div className="mb-3 flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">Status</span>
              {site.hasCredentials ? (
                <Badge tone="ok">configured</Badge>
              ) : (
                <Badge tone="warn">not set</Badge>
              )}
            </div>
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
              <Disclosure summary="Field mapping" hint="defaults fit a standard Strapi blog">
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
              </Disclosure>
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
              <Disclosure summary="Voice, formatting & banned phrases" hint="optional">
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
              </Disclosure>
              <Disclosure
                summary="Trending-topic discovery"
                hint="optional — targets discovery to this niche"
              >
              <Field label="Topic pillars" name="topicPillars" hint="Primary niche topics, one per line">
                <textarea
                  id="topicPillars"
                  name="topicPillars"
                  rows={3}
                  defaultValue={pillarsText}
                  className={inputClass}
                />
              </Field>
              <Field label="Topic clusters" name="topicClusters" hint="Supporting subtopics, one per line">
                <textarea
                  id="topicClusters"
                  name="topicClusters"
                  rows={3}
                  defaultValue={clustersText}
                  className={inputClass}
                />
              </Field>
              <Field
                label="Excluded topics"
                name="excludedTopics"
                hint="Never queue these (off-niche / brand safety), one per line"
              >
                <textarea
                  id="excludedTopics"
                  name="excludedTopics"
                  rows={2}
                  defaultValue={excludedText}
                  className={inputClass}
                />
              </Field>
              <Field label="Country (geo)" name="geo" hint="2-letter ISO code for trends, e.g. US">
                <input
                  id="geo"
                  name="geo"
                  defaultValue={guide?.geo ?? ''}
                  placeholder="US"
                  className={inputClass}
                />
              </Field>
              </Disclosure>
            </ActionForm>
          </Card>
        ) : null}

        <Card
          title={`Keywords (${keywords.length})`}
          description="Seed list + topics discovered from Google Search Console, Google Trends, and AI web search."
        >
          {canKw ? (
            <div className="grid gap-3">
              <ActionForm action={addKeywordsAction} submitLabel="Add keywords">
                <input type="hidden" name="siteId" value={site.id} />
                <Field label="Seed list" name="terms" hint="One keyword per line; duplicates skipped">
                  <textarea id="terms" name="terms" rows={3} className={inputClass} />
                </Field>
              </ActionForm>
              <ActionForm
                action={discoverKeywordsAction}
                submitLabel="Discover trending topics"
                submitVariant="secondary"
              >
                <input type="hidden" name="siteId" value={site.id} />
                <p className="text-xs text-muted">
                  Pulls GSC opportunities + on-niche Google Trends + AI web search into the queue.
                  Needs the site&apos;s topics (above) and the GSC/OpenRouter keys in Settings.
                </p>
              </ActionForm>
            </div>
          ) : null}
          <ul className="mt-3 grid gap-1">
            {keywords.length === 0 ? (
              <li>
                <EmptyState
                  title="No keywords yet"
                  description="Add seed keywords, discover trending topics, or type one when generating a draft."
                />
              </li>
            ) : (
              keywords.map((k) => {
                const fromDiscovery = Boolean(k.source) && k.source !== 'manual_seed';
                return (
                  <li
                    key={k.id}
                    className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="truncate">{k.term}</span>
                      <StatusBadge status={k.status} />
                      {fromDiscovery ? (
                        <Badge tone="default">{k.source?.replaceAll('_', ' ')}</Badge>
                      ) : null}
                      {typeof k.discoveryScore === 'number' ? (
                        <Badge tone="muted">{Math.round(k.discoveryScore * 100)}</Badge>
                      ) : null}
                    </span>
                    {can(actor.role, 'keyword.delete') ? (
                      <form action={deleteKeywordAction} className="shrink-0">
                        <input type="hidden" name="id" value={k.id} />
                        <input type="hidden" name="siteId" value={site.id} />
                        <button className={buttonClass({ variant: 'ghost', size: 'sm' })}>Remove</button>
                      </form>
                    ) : null}
                  </li>
                );
              })
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
              <li>
                <EmptyState
                  title="No articles yet"
                  description="Generate a draft from a keyword when the site context is ready."
                />
              </li>
            ) : (
              articles.map((article) => (
                <li key={article.id} className="border-t border-border py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/articles/${article.id}`} className="font-medium text-fg hover:text-accent">
                      {article.title ?? 'Untitled article'}
                    </Link>
                    <StatusBadge status={article.status} />
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
            <ActionForm action={deleteSiteAction} submitLabel="Delete site" submitVariant="danger">
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
