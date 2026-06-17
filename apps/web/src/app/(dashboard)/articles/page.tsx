import Link from 'next/link';
import { prisma, listArticles } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { Card, EmptyState, PageHeader, Stat, StatusBadge, buttonClass } from '@/components/ui';

export default async function ArticlesPage() {
  const actor = await requireActor();
  const articles = await listArticles(prisma, actor);
  const pending = articles.filter((article) => article.status === 'PENDING_REVIEW').length;
  const approved = articles.filter((article) => article.status === 'APPROVED').length;
  const published = articles.filter((article) => article.status === 'PUBLISHED').length;
  const failed = articles.filter((article) => article.status === 'PUBLISH_FAILED').length;

  return (
    <>
      <PageHeader
        title="Articles"
        description="Review generated drafts, upload article images, approve, and publish to the configured CMS."
        actions={
          <Link href="/sites" className={buttonClass({ variant: 'primary' })}>
            Generate draft
          </Link>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Needs review" value={pending} description="Edit, approve, or request changes" />
        <Stat label="Approved" value={approved} description="Ready to publish" />
        <Stat label="Published" value={published} description="Sent to CMS" />
        <Stat label="Publish failed" value={failed} description="Open and retry after fixing config" />
      </div>

      <Card title="Article queue" description="Newest articles appear first. Open one to review the full draft and publishing panel.">
        <div className="grid gap-2">
          {articles.length === 0 ? (
            <EmptyState
              title="No generated articles yet"
              description="Open a configured site, enter a keyword, and generate your first draft."
              action={
                <Link href="/sites" className={buttonClass({ variant: 'secondary' })}>
                  Open sites
                </Link>
              }
            />
          ) : (
            articles.map((article) => (
              <article
                key={article.id}
                className="rounded-md border border-border bg-panel-2/45 p-3 transition hover:border-accent/35 hover:bg-panel-2"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={article.status} />
                      {article.wordCount ? (
                        <span className="text-xs text-muted">{article.wordCount} words</span>
                      ) : null}
                    </div>
                    <Link
                      href={`/articles/${article.id}`}
                      className="mt-2 block truncate text-sm font-medium text-fg hover:text-accent"
                    >
                      {article.title ?? 'Untitled article'}
                    </Link>
                    {article.metaDescription ? (
                      <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-5 text-muted">
                        {article.metaDescription}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                      {article.slug ? <span>{article.slug}</span> : null}
                      {article.llmModel ? <span>{article.llmModel}</span> : null}
                      <span>Updated {article.updatedAt.toISOString().slice(0, 10)}</span>
                    </div>
                  </div>
                  <Link
                    href={`/articles/${article.id}`}
                    className={buttonClass({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}
                  >
                    {article.status === 'APPROVED' || article.status === 'PUBLISH_FAILED'
                      ? 'Publish'
                      : article.status === 'PENDING_REVIEW' || article.status === 'CHANGES_REQUESTED'
                        ? 'Review'
                        : 'Open'}
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </Card>
    </>
  );
}
