import Link from 'next/link';
import { prisma, listArticles } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Badge } from '@/components/ui';

export default async function ArticlesPage() {
  const actor = await requireActor();
  const articles = await listArticles(prisma, actor);

  return (
    <>
      <PageHeader title="Articles" description="Generated drafts awaiting review and publishing." />
      <Card>
        <ul className="grid gap-1">
          {articles.length === 0 ? (
            <li className="text-sm text-muted">No generated articles yet.</li>
          ) : (
            articles.map((article) => (
              <li key={article.id} className="border-t border-border py-2 first:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/articles/${article.id}`}
                    className="text-sm text-accent hover:underline"
                  >
                    {article.title ?? 'Untitled article'}
                  </Link>
                  <Badge tone="muted">{article.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                  {article.slug ? <span>{article.slug}</span> : null}
                  {article.wordCount ? <span>{article.wordCount} words</span> : null}
                  {article.llmModel ? <span>{article.llmModel}</span> : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </Card>
    </>
  );
}
