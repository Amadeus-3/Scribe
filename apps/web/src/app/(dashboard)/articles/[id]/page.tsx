import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, getArticle, getSite, listArticlePublishRecords, can } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Field, Badge, inputClass } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import {
  updateArticleDraftAction,
  approveArticleAction,
  requestArticleChangesAction,
  rejectArticleAction,
  publishArticleAction,
  uploadArticleImageAction,
} from '@/server/actions';

export default async function ArticleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const article = await getArticle(prisma, actor, id);
  if (!article) notFound();

  const site = await getSite(prisma, actor, article.siteId);
  const publishRecords = await listArticlePublishRecords(prisma, actor, article.id);
  const latestPublishRecord = publishRecords[0] ?? null;
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
            <Badge tone="muted">{article.status}</Badge>
            {site ? (
              <Link href={`/sites/${site.id}`} className="text-sm text-muted hover:text-fg">
                Back to site
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Review editor">
          {canEdit ? (
            <ActionForm action={updateArticleDraftAction} submitLabel="Save article">
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
          <Card title="Review actions">
            <div className="grid gap-3">
              {canApprove ? (
                <ActionForm action={approveArticleAction} submitLabel="Approve">
                  <input type="hidden" name="id" value={article.id} />
                </ActionForm>
              ) : null}
              {canRequestChanges ? (
                <ActionForm action={requestArticleChangesAction} submitLabel="Request changes">
                  <input type="hidden" name="id" value={article.id} />
                  <Field label="Reason" name="reason" hint="Optional">
                    <textarea id="reason" name="reason" rows={3} className={inputClass} />
                  </Field>
                </ActionForm>
              ) : null}
              {canReject ? (
                <ActionForm action={rejectArticleAction} submitLabel="Reject">
                  <input type="hidden" name="id" value={article.id} />
                  <Field label="Reason" name="reason" hint="Optional">
                    <textarea id="reason" name="reason" rows={3} className={inputClass} />
                  </Field>
                </ActionForm>
              ) : null}
            </div>
          </Card>

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
                <dt className="text-xs text-muted">Model</dt>
                <dd>{article.llmModel ?? 'Unknown'}</dd>
              </div>
            </dl>
          </Card>

          <Card
            title="Publishing"
            description="Approved articles can be sent to the configured Strapi collection."
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
                  <dt className="text-xs text-muted">Published URL</dt>
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
                submitLabel={article.status === 'PUBLISH_FAILED' ? 'Retry publish' : 'Publish'}
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
        </div>
      </div>
    </>
  );
}
