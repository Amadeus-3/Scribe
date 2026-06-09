import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, getSite, getStyleGuide, listKeywords, can } from '@scribe/core';
import { requireActor } from '@/lib/session';
import { PageHeader, Card, Field, Badge, inputClass } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import {
  updateSiteAction,
  setCredentialsAction,
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

  const [guide, keywords] = await Promise.all([
    getStyleGuide(prisma, actor, id),
    listKeywords(prisma, actor, id),
  ]);

  const canEdit = can(actor.role, 'site.update');
  const canCreds = can(actor.role, 'site.credentials.manage');
  const canGuide = can(actor.role, 'styleGuide.update');
  const canKw = can(actor.role, 'keyword.create');
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
          <Card title="Details">
            <ActionForm action={updateSiteAction} submitLabel="Save details">
              <input type="hidden" name="id" value={site.id} />
              <Field label="Name" name="name">
                <input id="name" name="name" defaultValue={site.name} required className={inputClass} />
              </Field>
              <Field label="Base URL" name="baseUrl">
                <input
                  id="baseUrl"
                  name="baseUrl"
                  type="url"
                  defaultValue={site.baseUrl}
                  required
                  className={inputClass}
                />
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
                <input type="checkbox" name="briefAutoApprove" defaultChecked={site.briefAutoApprove} />{' '}
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

        {canCreds ? (
          <Card
            title="WordPress credentials"
            description="Application Password on a least-privilege account. Stored AES-256-GCM encrypted; never shown back."
          >
            <p className="mb-2 text-xs">
              Status:{' '}
              {site.hasCredentials ? <Badge tone="ok">configured</Badge> : <Badge tone="muted">not set</Badge>}
            </p>
            <ActionForm action={setCredentialsAction} submitLabel="Save credentials">
              <input type="hidden" name="id" value={site.id} />
              <Field label="Username" name="username">
                <input id="username" name="username" required className={inputClass} autoComplete="off" />
              </Field>
              <Field label="Application password" name="applicationPassword">
                <input
                  id="applicationPassword"
                  name="applicationPassword"
                  type="password"
                  required
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
            </ActionForm>
          </Card>
        ) : null}

        {canGuide ? (
          <Card title="Style guide" description="Voice, rules, and the drafting system prompt.">
            <ActionForm action={upsertStyleGuideAction} submitLabel="Save style guide">
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
              <Field label="Tone notes" name="toneNotes">
                <input id="toneNotes" name="toneNotes" defaultValue={guide?.toneNotes ?? ''} className={inputClass} />
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
      </div>
    </>
  );
}
