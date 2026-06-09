import { prisma } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Stat } from '@/components/ui';

export default async function DashboardHome() {
  await requireActor();
  const [sites, queuedKeywords, articles, pendingReview] = await Promise.all([
    prisma.site.count(),
    prisma.keyword.count({ where: { status: 'QUEUED' } }),
    prisma.article.count(),
    prisma.article.count({ where: { status: 'PENDING_REVIEW' } }),
  ]);

  return (
    <>
      <PageHeader title="Dashboard" description="Pipeline overview." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sites" value={sites} />
        <Stat label="Queued keywords" value={queuedKeywords} />
        <Stat label="Articles" value={articles} />
        <Stat label="Pending review" value={pendingReview} />
      </div>
      <p className="mt-5 text-sm text-muted">
        Drafting, QA, the review queue, and publishing arrive in later phases. For now, add a site
        and its style guide, then seed keywords.
      </p>
    </>
  );
}
