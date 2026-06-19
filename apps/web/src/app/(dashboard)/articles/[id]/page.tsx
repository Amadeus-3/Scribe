import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  prisma,
  getArticle,
  getSite,
  listArticlePublishRecords,
  listArticleImages,
  listSiteTaxonomy,
  can,
  type SiteTaxonomyDTO,
} from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Field, Badge, StatusBadge, buttonClass, inputClass } from '@/components/ui';
import { SeoScoreCard } from '@/components/seo-score-card';
import { InlineImagesCard } from '@/components/inline-images-card';
import { TaxonomyFields } from '@/components/taxonomy-fields';
import { ActionForm } from '@/components/action-form';
import {
  updateArticleDraftAction,
  approveArticleAction,
  requestArticleChangesAction,
  rejectArticleAction,
  publishArticleAction,
  uploadArticleImageAction,
  autoAssignTaxonomyAction,
  regenerateArticleAction,
  updateArticleKeywordAction,
} from '@/server/actions';

export default async function ArticleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const article = await getArticle(prisma, actor, id);
  if (!article) notFound();

  const site = await getSite(prisma, actor, article.siteId);
  const inlineImages = await listArticleImages(prisma, actor, article.id);
  const publishRecords = await listArticlePublishRecords(prisma, actor, article.id);
  // Best-effort: the CMS may be unreachable/misconfigured — degrade to no picker.
  let taxonomy: SiteTaxonomyDTO | null = null;
  try {
    taxonomy = await listSiteTaxonomy(prisma, actor, article.siteId);
  } catch {
    taxonomy = null;
  }
  const latestPublishRecord = publishRecords[0] ?? null;
  const hasPublished = publishRecords.some((record) => record.status === 'success');
  const canEdit = can(actor.role, 'article.edit');
  const canApprove = can(actor.role, 'article.approve');
  const canRequestChanges = can(actor.role, 'article.requestChanges');
  const canReject = can(actor.role, 'article.reject');
  const canPublish = can(actor.role, 'article.publish');
  const publishable = article.status === 'APPROVED' || article.status === 'PUBLISH_FAILED';
  const imageSrc =
    article.imageMimeType && article.imageDataBase64
      ? `data:${article.imageMimeType};base64,${article.imageDataBase64}`
      : null;

  return (
    <>
      <PageHeader
        title={article.title ?? 'Untitled article'}
        description={article.slug ?? undefined}
        actions={
          <>
            <StatusBadge status={article.status} />
            {site ? (
              <Link href={`/sites/${site.id}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                Back to site
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Review editor">
          {canEdit ? (
            // Key on regenAttempts so a regenerate remounts the form and reloads
            // the new draft into these uncontrolled inputs. Without this, the
            // stale textarea would be saved back over the regenerated content.
            <ActionForm
              key={article.regenAttempts}
              action={updateArticleDraftAction}
              submitLabel="Save article"
            >
              <input type="hidden" name="id" value={article.id} />
              <Field label="Title" name="title">
                <input
                  id="title"
                  name="title"
                  required
                  defaultValue={article.title ?? ''}
                  className={inputClass}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Slug" name="slug">
                  <input
                    id="slug"
                    name="slug"
                    defaultValue={article.slug ?? ''}
                    className={inputClass}
                  />
                </Field>
                <Field label="Meta description" name="metaDescription">
                  <input
                    id="metaDescription"
                    name="metaDescription"
                    defaultValue={article.metaDescription ?? ''}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field
                label="Manual image prompt(s)"
                name="imagePrompt"
                hint="Copy this into your image generator, then upload the finished image."
              >
                <textarea
                  id="imagePrompt"
                  name="imagePrompt"
                  rows={4}
                  defaultValue={article.imagePrompt ?? ''}
                  className={inputClass}
                />
              </Field>
              {taxonomy ? (
                <TaxonomyFields
                  taxonomy={taxonomy}
                  categorySlug={article.categorySlug}
                  tagSlugs={article.tagSlugs}
                />
              ) : null}
              <Field label="Draft markdown" name="contentMarkdown">
                <textarea
                  id="contentMarkdown"
                  name="contentMarkdown"
                  required
                  rows={28}
                  defaultValue={article.contentMarkdown ?? ''}
                  className={`${inputClass} font-mono leading-6`}
                />
              </Field>
            </ActionForm>
          ) : (
            <pre className="whitespace-pre-wrap rounded-md bg-panel-2 p-3 text-sm leading-6 text-fg">
              {article.contentMarkdown ?? 'No draft content.'}
            </pre>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <Card
            title="Review actions"
            description="Approve the draft when the article, metadata, taxonomy, and image prompt are ready."
          >
            <div className="grid gap-3">
              {canApprove ? (
                <ActionForm action={approveArticleAction} submitLabel="Approve">
                  <input type="hidden" name="id" value={article.id} />
                </ActionForm>
              ) : null}
              {canRequestChanges ? (
                <ActionForm
                  action={requestArticleChangesAction}
                  submitLabel="Request changes"
                  submitVariant="secondary"
                >
                  <input type="hidden" name="id" value={article.id} />
                  <Field label="Reason" name="reason" hint="Optional">
                    <textarea id="reason" name="reason" rows={3} className={inputClass} />
                  </Field>
                </ActionForm>
              ) : null}
              {canReject ? (
                <ActionForm action={rejectArticleAction} submitLabel="Reject" submitVariant="danger">
                  <input type="hidden" name="id" value={article.id} />
                  <Field label="Reason" name="reason" hint="Optional">
                    <textarea id="reason" name="reason" rows={3} className={inputClass} />
                  </Field>
                </ActionForm>
              ) : null}
            </div>
          </Card>

          {canEdit ? (
            <Card
              title="Primary keyword"
              description="The SEO target this article is scored against. Refine it to a concise phrase, then re-score / regenerate."
            >
              <ActionForm action={updateArticleKeywordAction} submitLabel="Save keyword & re-score">
                <input type="hidden" name="id" value={article.id} />
                <Field label="Keyword" name="keyword">
                  <input
                    id="keyword"
                    name="keyword"
                    required
                    defaultValue={article.keyword ?? ''}
                    className={inputClass}
                  />
                </Field>
              </ActionForm>
            </Card>
          ) : null}

          <SeoScoreCard report={article.seoReport} />

          {canEdit && taxonomy ? (
            <Card
              title="AI metadata"
              description="Let the model assign this article's category and tags from your CMS taxonomy. Existing drafts can be classified without re-writing the content."
            >
              <ActionForm action={autoAssignTaxonomyAction} submitLabel="Auto-assign category & tags">
                <input type="hidden" name="id" value={article.id} />
              </ActionForm>
            </Card>
          ) : null}

          {canEdit && article.status !== 'PUBLISHING' ? (
            <Card
              title="Regenerate (AI)"
              description="Rewrite this draft with the model, folding in your comments and the current SEO findings. Saved as a new version and sent back to review — the live CMS post is untouched until you publish again."
            >
              <ActionForm action={regenerateArticleAction} submitLabel="Regenerate draft">
                <input type="hidden" name="id" value={article.id} />
                <Field
                  label="Comments for the rewrite"
                  name="comments"
                  hint="Optional. The current SEO findings are sent automatically."
                >
                  <textarea id="comments" name="comments" rows={4} className={inputClass} />
                </Field>
                {article.seoReport && article.seoReport.flags.length > 0 ? (
                  <p className="text-xs text-muted">
                    Will also address {article.seoReport.flags.length} SEO flag
                    {article.seoReport.flags.length === 1 ? '' : 's'}.
                  </p>
                ) : null}
              </ActionForm>
            </Card>
          ) : null}

          <Card title="Article metadata">
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Meta description</dt>
                <dd>{article.metaDescription ?? 'None'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Word count</dt>
                <dd>{article.wordCount ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Category</dt>
                <dd>{article.categorySlug ?? 'None'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Tags</dt>
                <dd>{article.tagSlugs.length > 0 ? article.tagSlugs.join(', ') : 'None'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Model</dt>
                <dd>{article.llmModel ?? 'Unknown'}</dd>
              </div>
            </dl>
          </Card>

          <Card
            title="Publishing"
            description="Approved articles are sent to the configured Strapi collection. Public vs draft behavior is controlled on the site CMS settings."
          >
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Latest attempt</dt>
                <dd>
                  {latestPublishRecord ? (
                    <Badge tone={latestPublishRecord.status === 'success' ? 'ok' : 'danger'}>
                      {latestPublishRecord.status}
                    </Badge>
                  ) : (
                    'None'
                  )}
                </dd>
              </div>
              {latestPublishRecord?.url ? (
                <div>
                  <dt className="text-xs text-muted">CMS URL</dt>
                  <dd>
                    <a
                      href={latestPublishRecord.url}
                      className="text-accent hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {latestPublishRecord.url}
                    </a>
                  </dd>
                </div>
              ) : null}
              {latestPublishRecord?.error ? (
                <div>
                  <dt className="text-xs text-muted">Error</dt>
                  <dd className="text-danger">{latestPublishRecord.error}</dd>
                </div>
              ) : null}
            </dl>
            {canPublish && publishable ? (
              <ActionForm
                action={publishArticleAction}
                submitLabel={
                  hasPublished
                    ? 'Republish (update live post)'
                    : article.status === 'PUBLISH_FAILED'
                      ? 'Retry publish'
                      : 'Publish'
                }
                className="mt-3 border-t border-border pt-3"
              >
                <input type="hidden" name="id" value={article.id} />
              </ActionForm>
            ) : (
              <p className="mt-3 border-t border-border pt-3 text-sm text-muted">
                {article.status === 'PUBLISHED'
                  ? 'This article has already been published.'
                  : !canPublish
                    ? 'Only an Admin can publish approved articles.'
                    : 'Approve the article before publishing.'}
              </p>
            )}
          </Card>

          <Card
            title="Manual image"
            description="Use this prompt in your image tool, then upload the finished article image."
          >
            {imageSrc ? (
              <img
                src={imageSrc}
                alt={article.title ?? 'Article image'}
                className="aspect-video w-full rounded-md object-cover"
              />
            ) : (
              <p className="text-sm text-muted">No image uploaded yet.</p>
            )}
            <div className="mt-3 rounded-md border border-border bg-panel-2 p-3">
              <div className="text-xs font-medium text-muted">Image prompt(s)</div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-5">
                {article.imagePrompt ?? 'No image prompt yet. Add one in the review editor.'}
              </p>
            </div>
            {canEdit ? (
              <ActionForm
                action={uploadArticleImageAction}
                submitLabel={imageSrc ? 'Replace image' : 'Upload image'}
                className="mt-3 border-t border-border pt-3"
                encType="multipart/form-data"
              >
                <input type="hidden" name="id" value={article.id} />
                <Field
                  label="Image file"
                  name="imageFile"
                  hint="JPEG, PNG, WebP, AVIF, or GIF. Max 5 MB."
                >
                  <input
                    id="imageFile"
                    name="imageFile"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                    required
                    className={inputClass}
                  />
                </Field>
              </ActionForm>
            ) : null}
          </Card>

          <InlineImagesCard
            articleId={article.id}
            images={inlineImages}
            canEdit={canEdit}
          />
        </div>
      </div>
    </>
  );
}
