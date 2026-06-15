import type { SeoReport, SeoCheckStatus } from '@scribe/core';
import { Card, Badge } from './ui';

const STATUS_ORDER: Record<SeoCheckStatus, number> = { fail: 0, warn: 1, pass: 2 };
const STATUS_TONE: Record<SeoCheckStatus, 'ok' | 'warn' | 'danger'> = {
  pass: 'ok',
  warn: 'warn',
  fail: 'danger',
};
const STATUS_DOT: Record<SeoCheckStatus, string> = {
  pass: 'bg-ok',
  warn: 'bg-warn',
  fail: 'bg-danger',
};
const VERDICT_LABEL: Record<SeoCheckStatus, string> = {
  pass: 'Good',
  warn: 'Needs work',
  fail: 'Poor',
};

/**
 * Renders the advisory deterministic SEO report for an article. Surfaces the
 * score, verdict, and the failing/critical flags so a reviewer can triage at a
 * glance, then the full checklist. Display-only — it does not (and must not)
 * change the article's status or the human approval gate.
 */
export function SeoScoreCard({ report }: { report: SeoReport | null }) {
  if (!report) {
    return (
      <Card title="SEO score">
        <p className="text-sm text-muted">Not scored yet. Generate or save the draft to score it.</p>
      </Card>
    );
  }

  const checks = [...report.checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const scoreColor =
    report.verdict === 'pass'
      ? 'text-ok'
      : report.verdict === 'warn'
        ? 'text-warn'
        : 'text-danger';

  return (
    <Card
      title="SEO score"
      description="Deterministic on-page check against the SEO rules. Advisory only — it never changes the approval gate."
    >
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${scoreColor}`}>{report.score}</span>
        <span className="text-xs text-muted">/ 100</span>
        <Badge tone={STATUS_TONE[report.verdict]}>{VERDICT_LABEL[report.verdict]}</Badge>
        <span className="ml-auto text-xs text-muted">{report.wordCount} words</span>
      </div>

      {report.flags.length > 0 ? (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 p-2.5">
          <div className="text-xs font-medium text-danger">
            {report.flags.length} {report.flags.length === 1 ? 'flag' : 'flags'} to fix
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-fg">
            {report.flags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ok">No blocking SEO issues found.</p>
      )}

      <ul className="mt-3 grid gap-2 border-t border-border pt-3">
        {checks.map((check) => (
          <li key={check.id} className="flex gap-2 text-sm">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[check.status]}`}
              aria-hidden
            />
            <span>
              <span className="sr-only">{check.status}: </span>
              <span className="font-medium">{check.label}</span>
              {check.critical ? <span className="ml-1 text-xs text-muted">(critical)</span> : null}
              <span className="block text-xs text-muted">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
