import { z } from 'zod';

/** A single seed keyword (manual sourcing, Decision §18.1). */
export const KeywordTermSchema = z.string().trim().min(1).max(200);

/**
 * Parse a pasted seed list into unique, trimmed terms. Split on BOTH newlines
 * and commas so a pasted "a, b, c" cluster becomes three keywords (not one).
 * De-duplication is case-insensitive; the first-seen casing is kept.
 */
export function parseKeywordSeedList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/[\n,]/)) {
    const term = line.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

export const KeywordSeedInputSchema = z.object({
  siteId: z.string().min(1),
  terms: z.array(KeywordTermSchema).min(1, 'Add at least one keyword'),
});
export type KeywordSeedInput = z.infer<typeof KeywordSeedInputSchema>;
