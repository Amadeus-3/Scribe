import Link from 'next/link';
import { prisma, getSettings, monthToDateSpendUsd, can } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { Card, PageHeader, Stat, StatusBadge, StepList, buttonClass } from '@/components/ui';
import { AutopilotPanel } from '@/components/autopilot-panel';

export default async function DashboardHome() {
  const actor = await requireActor();
  const [sites, configuredSites, queuedKeywords, articles, pendingReview, approved, published, failed, recent, spendThisMonth, settings] =
    await Promise.all([
    prisma.site.count(),
    prisma.site.count({ where: { cmsCredentialsEnc: { not: null } } }),
    prisma.keyword.count({ where: { status: 'QUEUED' } }),
    prisma.article.count(),
    prisma.article.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.article.count({ where: { status: 'APPROVED' } }),
    prisma.article.count({ where: { status: 'PUBLISHED' } }),
    prisma.article.count({ where: { status: 'PUBLISH_FAILED' } }),
    prisma.article.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true, updatedAt: true, wordCount: true },
    }),
    monthToDateSpendUsd(prisma),
    getSettings(prisma),
  ]);

  const budget = settings.monthly_budget_usd;
  const spendPct = budget > 0 ? Math.round((spendThisMonth / budget) * 100) : 0;
  const spendDescription =
    budget > 0 ? `of $${budget.toFixed(0)} monthly budget (${spendPct}%)` : 'this month (no budget set)';

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A working view of what is configured, what needs review, and what is ready to publish."
        actions={
          <Link href="/sites" className={buttonClass({ variant: 'primary' })}>
            Create article
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <Stat label="Sites" value={sites} description={`${configuredSites} with CMS credentials`} />
        <Stat label="Queued keywords" value={queuedKeywords} description="Waiting for article ideas" />
        <Stat label="Needs review" value={pendingReview} description="Drafts awaiting a decision" />
        <Stat label="Ready / failed" value={`${approved} / ${failed}`} description="Approved and retryable posts" />
        <Stat
          label="AI spend (month)"
          value={`$${spendThisMonth.toFixed(2)}`}
          description={spendDescription}
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[380px_1fr]">
        <AutopilotPanel canRun={can(actor.role, 'article.create')} />

        <Card title="Start here" description="The shortest path to a published blog post.">
          <StepList
            steps={[
              {
                label: 'Open a site',
                description: sites > 0 ? 'Choose the blog you want to work on.' : 'Add your first blog and CMS mapping.',
                href: '/sites',
                done: sites > 0,
              },
              {
                label: 'Generate a draft',
                description: 'Use the site page once the style guide and CMS config are ready.',
                href: '/sites',
                done: articles > 0,
              },
              {
                label: 'Review the article',
                description: pendingReview > 0 ? `${pendingReview} draft needs review.` : 'No drafts are waiting right now.',
                href: '/articles',
                done: pendingReview === 0 && articles > 0,
              },
              {
                label: 'Publish to CMS',
                description: approved > 0 ? `${approved} approved article can be published.` : `${published} already published.`,
                href: '/articles',
                done: published > 0,
              },
            ]}
          />
        </Card>

        <Card
          title="Recent articles"
          description="Latest drafts and publishing states across all sites."
          actions={<Link href="/articles" className={buttonClass({ variant: 'secondary', size: 'sm' })}>View all</Link>}
        >
          {recent.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-panel-2/45 p-6 text-center text-sm text-muted">
              No articles yet. Open a site to generate the first draft.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((article) => (
                <li key={article.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link href={`/articles/${article.id}`} className="truncate text-sm font-medium text-fg hover:text-accent">
                      {article.title ?? 'Untitled article'}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                      {article.wordCount ? <span>{article.wordCount} words</span> : null}
                      <span>Updated {article.updatedAt.toISOString().slice(0, 10)}</span>
                    </div>
                  </div>
                  <StatusBadge status={article.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
