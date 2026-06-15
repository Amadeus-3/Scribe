import { z } from 'zod';

/**
 * SEO scoring report — the validated shape stored in `Article.qaReport`.
 *
 * The score is deterministic and people-first: it encodes the mechanical,
 * automatable rules from the SEO article skill (docs/ai-project) so a human
 * reviewer sees an at-a-glance grade plus a precise, actionable checklist.
 * It is advisory only — it never changes an article's status or the human
 * approval gate (Spec §10.1).
 *
 * Json columns must be parsed through a Zod schema before write (CLAUDE.md),
 * so this schema is the single source of truth for the column's shape.
 */

/** pass = meets the rule · warn = weak but acceptable · fail = violates the rule. */
export const SeoCheckStatusSchema = z.enum(['pass', 'warn', 'fail']);
export type SeoCheckStatus = z.infer<typeof SeoCheckStatusSchema>;

/** Which on-page area a check belongs to, used to group the checklist in the UI. */
export const SeoCheckCategorySchema = z.enum([
  'title',
  'slug',
  'meta',
  'structure',
  'keyword',
  'readability',
  'links',
  'media',
]);
export type SeoCheckCategory = z.infer<typeof SeoCheckCategorySchema>;

export const SeoCheckSchema = z.object({
  /** Stable identifier, e.g. "title-length". */
  id: z.string().min(1),
  /** Short human label, e.g. "Title length". */
  label: z.string().min(1),
  category: SeoCheckCategorySchema,
  status: SeoCheckStatusSchema,
  /** Specific, actionable explanation shown to the reviewer. */
  detail: z.string().min(1),
  /** Relative contribution to the overall score. */
  weight: z.number().positive(),
  /** A failing critical check forces an overall "fail" verdict and raises a flag. */
  critical: z.boolean(),
});
export type SeoCheck = z.infer<typeof SeoCheckSchema>;

export const SeoReportSchema = z.object({
  /** Bumped when the scoring shape changes so old reports stay parseable. */
  version: z.literal(1),
  /** 0–100 weighted score across all checks. */
  score: z.number().min(0).max(100),
  /** Overall verdict derived from the score and any critical failures. */
  verdict: SeoCheckStatusSchema,
  checks: z.array(SeoCheckSchema),
  /** Human-readable headline issues (the failing/critical checks), for quick triage. */
  flags: z.array(z.string()),
  wordCount: z.number().int().nonnegative(),
  /** ISO timestamp of when the report was generated. */
  generatedAt: z.string().min(1),
});
export type SeoReport = z.infer<typeof SeoReportSchema>;

/**
 * Safely parse a stored `qaReport` Json value back into a typed report.
 * Returns null for missing or legacy/invalid values so callers can render
 * "not scored yet" rather than throw.
 */
export function parseSeoReport(value: unknown): SeoReport | null {
  if (value == null) return null;
  const result = SeoReportSchema.safeParse(value);
  return result.success ? result.data : null;
}
