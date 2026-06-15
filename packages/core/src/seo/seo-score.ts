import {
  type SeoCheck,
  type SeoCheckStatus,
  type SeoReport,
  SeoReportSchema,
} from './seo-report';

/**
 * Deterministic, people-first SEO scorer.
 *
 * Encodes the *mechanical* rules from the SEO article skill (docs/ai-project:
 * seo-article-rules Step 4–5, quality-review-checklist) that can be checked
 * without an LLM: title/slug/meta shape, heading structure, keyword placement
 * and density, snippet-friendly formatting, links, anti-patterns, and the image
 * prompt. Editorial judgment (business fit, originality, E-E-A-T depth) is left
 * to the human reviewer.
 *
 * Pure and side-effect free so it is fully unit-testable and free to run on
 * every draft and edit. It never mutates article state or the approval gate
 * (Spec §10.1) — its output is advisory.
 */

export interface ScoreArticleSeoInput {
  title: string;
  slug: string;
  metaDescription: string;
  contentMarkdown: string;
  imagePrompt?: string | null;
  /** The article's primary keyword — drives placement and density checks. */
  primaryKeyword: string;
  /** Site-configured banned phrases; their presence is a critical failure. */
  bannedPhrases?: string[];
  /** Number of in-body (supporting) images planned for the article. */
  inlineImageCount?: number;
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
  'how',
  'what',
  'why',
  'your',
  'you',
  'is',
  'are',
  'best',
]);

// Generic openers the skill bans outright — a hard credibility/quality signal.
const GENERIC_OPENERS = [
  "in today's fast-paced world",
  "in today's world",
  "in today's digital age",
  'in the digital age',
  'in the modern world',
  'in this day and age',
  'in an increasingly',
  'in the world of',
  'in the realm of',
];

// Overused hype/filler the skill says to avoid unless genuinely natural.
const FILLER_WORDS = [
  'delve',
  'unlock',
  'game-changer',
  'game changer',
  'tapestry',
  'navigating the',
  'ever-evolving',
  'ever evolving',
  'elevate your',
  'supercharge',
  'unleash',
  'a testament to',
  'in conclusion,',
  'when it comes to',
];

const TITLE_HYPE = [
  'comprehensive guide',
  'ultimate guide',
  "you won't believe",
  'must-read',
  'game-changer',
  'game changer',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (ASCII boundary) presence test on already-lowercased text. */
function hasWord(textLower: string, word: string): boolean {
  if (!word) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(word)}(?:[^a-z0-9]|$)`).test(textLower);
}

/** Count non-overlapping occurrences of a phrase in already-lowercased text. */
function countPhrase(textLower: string, phraseLower: string): number {
  if (!phraseLower) return 0;
  return textLower.split(phraseLower).length - 1;
}

/** Significant (non-stopword) words of the keyword, lowercased. */
function coreWords(keyword: string): string[] {
  return (keyword.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w),
  );
}

/** How many of the keyword's significant words appear in the text. */
function coreWordsPresent(textLower: string, core: string[]): number {
  return core.filter((w) => hasWord(textLower, w)).length;
}

/**
 * A long-tail / headline-style keyword (many significant words or very long).
 * For these, exact-phrase placement and density are not meaningful signals —
 * you cannot fit a headline into a 50–60 char title, and a long phrase never
 * repeats — so the keyword checks match on term overlap instead of demanding
 * the whole phrase.
 */
function isLongKeyword(keyword: string): boolean {
  return coreWords(keyword).length > 4 || keyword.trim().length > 50;
}

/** Keyword match: exact phrase, all significant words (short), or a strong
 *  majority of them (long/headline keywords). */
function containsKeyword(text: string, keyword: string): boolean {
  const t = text.toLowerCase();
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;
  if (t.includes(kw)) return true;
  const core = coreWords(keyword);
  if (core.length === 0) return false;
  const present = coreWordsPresent(t, core);
  return core.length <= 3 ? present === core.length : present / core.length >= 0.6;
}

/** Strip Markdown to plain prose for word counting and density. */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>+\s?/gm, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
}

interface Heading {
  level: number;
  text: string;
}

function getHeadings(md: string): Heading[] {
  return md.split(/\r?\n/).flatMap((line) => {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    return m ? [{ level: m[1]?.length ?? 1, text: m[2] ?? '' }] : [];
  });
}

/** The first prose block, before any heading or list — the intro. */
function firstParagraph(md: string): string {
  const buf: string[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const boundary =
      line === '' || line.startsWith('#') || /^([-*+]\s|\d+\.\s|\|)/.test(line);
    if (boundary) {
      if (buf.length > 0) break;
      continue;
    }
    buf.push(line);
  }
  return stripMarkdown(buf.join(' '));
}

function hasList(md: string): boolean {
  return /^\s*([-*+]|\d+\.)\s+/m.test(md);
}

function hasTable(md: string): boolean {
  return /^\s*\|.+\|\s*$/m.test(md) && /^\s*\|?[\s:]*-{3,}[\s:|-]*\|?/m.test(md);
}

function getLinks(md: string): { href: string; external: boolean }[] {
  const links: { href: string; external: boolean }[] = [];
  const re = /(!?)\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (m[1] === '!') continue; // image, not a link
    const href = m[2] ?? '';
    links.push({ href, external: /^https?:\/\//i.test(href) });
  }
  return links;
}

/** pass → status 'pass'; else warn → 'warn'; else 'fail'. */
function band(
  pass: boolean,
  warn: boolean,
  passDetail: string,
  warnDetail: string,
  failDetail: string,
): Pick<SeoCheck, 'status' | 'detail'> {
  if (pass) return { status: 'pass', detail: passDetail };
  if (warn) return { status: 'warn', detail: warnDetail };
  return { status: 'fail', detail: failDetail };
}

export function scoreArticleSeo(input: ScoreArticleSeoInput): SeoReport {
  const title = input.title?.trim() ?? '';
  const slug = input.slug?.trim() ?? '';
  const meta = input.metaDescription?.trim() ?? '';
  const md = input.contentMarkdown ?? '';
  const keyword = input.primaryKeyword?.trim() ?? '';
  const imagePrompt = (input.imagePrompt ?? '').trim();

  const titleLower = title.toLowerCase();
  const contentLower = md.toLowerCase();
  const plain = stripMarkdown(md);
  const plainWords = words(plain);
  const totalWords = plainWords.length;
  const first100 = plainWords.slice(0, 100).join(' ');
  const lastChunk = plainWords.slice(Math.floor(totalWords * 0.85)).join(' ');
  const headings = getHeadings(md);
  const h2Count = headings.filter((h) => h.level === 2).length;
  const bodyH1Count = headings.filter((h) => h.level === 1).length;
  const intro = firstParagraph(md);
  const links = getLinks(md);

  const checks: SeoCheck[] = [];

  // ── Title ────────────────────────────────────────────────────────────────
  const titleLen = title.length;
  checks.push({
    id: 'title-length',
    label: 'Title length',
    category: 'title',
    weight: 2,
    critical: false,
    ...band(
      titleLen >= 40 && titleLen <= 65,
      titleLen >= 30 && titleLen <= 70,
      `Title is ${titleLen} characters — within the ideal range.`,
      `Title is ${titleLen} characters; aim for ~50–60 so it isn't truncated.`,
      titleLen === 0
        ? 'Add a title.'
        : `Title is ${titleLen} characters; rewrite to ~50–60 characters.`,
    ),
  });

  checks.push({
    id: 'title-keyword',
    label: 'Keyword in title',
    category: 'title',
    weight: 3,
    critical: true,
    ...band(
      containsKeyword(title, keyword),
      false,
      'The primary keyword appears in the title.',
      '',
      `The primary keyword "${keyword}" is missing from the title — add it near the front.`,
    ),
  });

  const titleStuffed = countPhrase(titleLower, keyword.toLowerCase()) > 2;
  const titleHype = TITLE_HYPE.find((w) => titleLower.includes(w));
  checks.push({
    id: 'title-quality',
    label: 'Title not clickbait or stuffed',
    category: 'title',
    weight: 1,
    critical: false,
    ...band(
      !titleStuffed && !titleHype,
      Boolean(titleStuffed || titleHype),
      'Title reads naturally.',
      titleStuffed
        ? 'The keyword repeats in the title; use it once.'
        : `Avoid hype/filler in the title (e.g. "${titleHype}").`,
      '',
    ),
  });

  // ── Slug ─────────────────────────────────────────────────────────────────
  const slugClean = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const slugSegments = slug.split('-').filter(Boolean).length;
  const slugTrim = slugClean && slug.length <= 60 && slugSegments <= 7;
  checks.push({
    id: 'slug-format',
    label: 'Slug format',
    category: 'slug',
    weight: 1,
    critical: false,
    ...band(
      slugTrim,
      slugClean,
      'Slug is clean, lowercase, and hyphenated.',
      'Slug is long; shorten it and drop filler words.',
      'Slug should be lowercase words separated by single hyphens.',
    ),
  });

  checks.push({
    id: 'slug-keyword',
    label: 'Keyword in slug',
    category: 'slug',
    weight: 1,
    critical: false,
    ...band(
      containsKeyword(slug.replace(/-/g, ' '), keyword),
      !containsKeyword(slug.replace(/-/g, ' '), keyword),
      'The core keyword is in the slug.',
      'Include the core keyword in the slug.',
      '',
    ),
  });

  // ── Meta description ───────────────────────────────────────────────────────
  const metaLen = meta.length;
  checks.push({
    id: 'meta-present',
    label: 'Meta description present',
    category: 'meta',
    weight: 2,
    critical: true,
    ...band(
      metaLen > 0,
      false,
      'A meta description is set.',
      '',
      'Add a meta description (140–160 characters).',
    ),
  });

  if (metaLen > 0) {
    checks.push({
      id: 'meta-length',
      label: 'Meta description length',
      category: 'meta',
      weight: 2,
      critical: false,
      ...band(
        metaLen >= 120 && metaLen <= 160,
        (metaLen >= 90 && metaLen < 120) || (metaLen > 160 && metaLen <= 170),
        `Meta description is ${metaLen} characters — within range.`,
        `Meta description is ${metaLen} characters; aim for 140–160.`,
        `Meta description is ${metaLen} characters; rewrite to 140–160.`,
      ),
    });

    checks.push({
      id: 'meta-keyword',
      label: 'Keyword in meta description',
      category: 'meta',
      weight: 1,
      critical: false,
      ...band(
        containsKeyword(meta, keyword),
        !containsKeyword(meta, keyword),
        'The keyword appears in the meta description.',
        'Work the primary keyword into the meta description naturally.',
        '',
      ),
    });
  }

  // ── Structure ──────────────────────────────────────────────────────────────
  checks.push({
    id: 'headings-present',
    label: 'Section headings',
    category: 'structure',
    weight: 2,
    critical: true,
    ...band(
      h2Count >= 3,
      h2Count === 2,
      `Article has ${h2Count} H2 sections.`,
      'Only two H2 sections; add more to cover the topic fully.',
      'Add H2 sections — the article needs a logical heading structure.',
    ),
  });

  const firstH2Index = headings.findIndex((h) => h.level === 2);
  const h3BeforeH2 = headings.some(
    (h, i) => h.level >= 3 && (firstH2Index === -1 || i < firstH2Index),
  );
  checks.push({
    id: 'heading-hierarchy',
    label: 'Heading hierarchy',
    category: 'structure',
    weight: 1,
    critical: false,
    ...band(
      bodyH1Count === 0 && !h3BeforeH2,
      bodyH1Count === 0,
      'Heading hierarchy is logical (H2 → H3).',
      'A subheading appears before any H2; fix the heading order.',
      'The body contains an extra H1 — the title is the only H1, use H2/H3 below it.',
    ),
  });

  checks.push({
    id: 'word-count',
    label: 'Content depth',
    category: 'structure',
    weight: 2,
    critical: totalWords < 450,
    ...band(
      totalWords >= 800,
      totalWords >= 450,
      `Article is ${totalWords} words.`,
      `Article is ${totalWords} words; consider expanding to fully satisfy the intent.`,
      `Article is only ${totalWords} words — too thin; expand it.`,
    ),
  });

  const introOk = intro.length > 0 && !GENERIC_OPENERS.some((p) => intro.toLowerCase().startsWith(p));
  const introWords = words(intro).length;
  checks.push({
    id: 'direct-answer',
    label: 'Direct answer up front',
    category: 'structure',
    weight: 1,
    critical: false,
    ...band(
      introOk && introWords > 0 && introWords <= 90 && containsKeyword(intro, keyword),
      introOk && introWords > 0 && introWords <= 140,
      'The intro gives a direct, keyword-relevant answer up front.',
      'Tighten the intro to answer the main question in 1–3 sentences up front.',
      'Open with a direct answer to the search query, not a long or generic intro.',
    ),
  });

  checks.push({
    id: 'snippet-formatting',
    label: 'Scannable formatting',
    category: 'structure',
    weight: 1,
    critical: false,
    ...band(
      hasList(md) || hasTable(md),
      !(hasList(md) || hasTable(md)),
      'Uses lists/tables that are easy to scan and to lift into snippets.',
      'Add a list or comparison table where it helps scannability.',
      '',
    ),
  });

  const hasConclusionHeading = headings.some((h) =>
    /conclusion|takeaway|final|summary|next step|wrap[- ]?up|bottom line/i.test(h.text),
  );
  checks.push({
    id: 'conclusion',
    label: 'Conclusion / next step',
    category: 'structure',
    weight: 1,
    critical: false,
    ...band(
      hasConclusionHeading || containsKeyword(lastChunk, keyword),
      !(hasConclusionHeading || containsKeyword(lastChunk, keyword)),
      'Has a clear closing section.',
      'Add a conclusion that restates the takeaway and gives a next step.',
      '',
    ),
  });

  // ── Keyword usage ──────────────────────────────────────────────────────────
  checks.push({
    id: 'keyword-intro',
    label: 'Keyword in first 100 words',
    category: 'keyword',
    weight: 2,
    critical: false,
    ...band(
      containsKeyword(first100, keyword),
      false,
      'Primary keyword appears in the first 100 words.',
      '',
      'Work the primary keyword into the first ~100 words naturally.',
    ),
  });

  const longKeyword = isLongKeyword(keyword);
  const keywordCore = coreWords(keyword);
  // For a long/headline keyword, "in a heading" means the heading carries the
  // topic (≥2 of its significant words), since the full phrase won't fit.
  const kwInHeading = headings.some((h) =>
    longKeyword
      ? coreWordsPresent(h.text.toLowerCase(), keywordCore) >= 2
      : containsKeyword(h.text, keyword),
  );
  checks.push({
    id: 'keyword-heading',
    label: 'Keyword in a heading',
    category: 'keyword',
    weight: 1,
    critical: false,
    ...band(
      kwInHeading,
      !kwInHeading,
      'Primary keyword appears in at least one heading.',
      'Add the primary keyword (or its key terms) to at least one H2 where it reads naturally.',
      '',
    ),
  });

  if (longKeyword) {
    // Exact density is meaningless for a long-form/headline keyword.
    checks.push({
      id: 'keyword-density',
      label: 'Keyword density',
      category: 'keyword',
      weight: 2,
      critical: false,
      status: 'pass',
      detail: 'Long-form keyword — exact keyword density is not a meaningful signal.',
    });
  } else {
    const phraseHits = countPhrase(contentLower, keyword.toLowerCase());
    const density = totalWords > 0 ? (phraseHits * Math.max(1, keywordCore.length)) / totalWords : 0;
    const densityPct = (density * 100).toFixed(1);
    const stuffed = density > 0.03;
    const sparse = totalWords > 0 && density < 0.003;
    checks.push({
      id: 'keyword-density',
      label: 'Keyword density',
      category: 'keyword',
      weight: 2,
      critical: true,
      ...band(
        !stuffed && !sparse,
        sparse,
        `Keyword density is a natural ${densityPct}%.`,
        `Keyword density is ${densityPct}% — mention the topic a little more.`,
        `Keyword density is ${densityPct}% — reduce repetition (keep under ~2.5%).`,
      ),
    });
  }

  // ── Readability / anti-patterns ────────────────────────────────────────────
  const opener = intro.toLowerCase().slice(0, 80);
  const genericOpener = GENERIC_OPENERS.find((p) => opener.startsWith(p) || opener.includes(p));
  checks.push({
    id: 'generic-opener',
    label: 'No generic opener',
    category: 'readability',
    weight: 2,
    critical: true,
    ...band(
      !genericOpener,
      false,
      'No generic "in today\'s world" style opener.',
      '',
      `Remove the generic opener ("${genericOpener}") and start with a direct answer.`,
    ),
  });

  const fillerFound = FILLER_WORDS.filter((w) => contentLower.includes(w));
  checks.push({
    id: 'filler-words',
    label: 'No filler / hype',
    category: 'readability',
    weight: 1,
    critical: false,
    ...band(
      fillerFound.length === 0,
      fillerFound.length <= 2,
      'No overused filler or hype phrases.',
      `Reduce filler/hype: ${fillerFound.join(', ')}.`,
      `Too much filler/hype — remove: ${fillerFound.join(', ')}.`,
    ),
  });

  const banned = (input.bannedPhrases ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => contentLower.includes(p.toLowerCase()));
  if ((input.bannedPhrases ?? []).some((p) => p.trim())) {
    checks.push({
      id: 'banned-phrases',
      label: 'No site-banned phrases',
      category: 'readability',
      weight: 2,
      critical: true,
      ...band(
        banned.length === 0,
        false,
        'No site-banned phrases present.',
        '',
        `Remove site-banned phrases: ${banned.join(', ')}.`,
      ),
    });
  }

  // ── Links ──────────────────────────────────────────────────────────────────
  const internalLinks = links.filter((l) => !l.external).length;
  const suggestsInternal = /internal link|related (article|read|post|guide)|see also/i.test(md);
  checks.push({
    id: 'internal-links',
    label: 'Internal links',
    category: 'links',
    weight: 1,
    critical: false,
    ...band(
      internalLinks > 0 || suggestsInternal,
      !(internalLinks > 0 || suggestsInternal),
      'Includes internal link(s) or suggestions.',
      'Suggest internal links to the pillar and adjacent cluster articles.',
      '',
    ),
  });

  const externalLinks = links.filter((l) => l.external).length;
  const hasClaims = /\b\d+(\.\d+)?\s?%|\baccording to\b|\bstudy\b|\bresearch\b|\bsurvey\b|\bstatistics?\b/i.test(
    plain,
  );
  checks.push({
    id: 'external-links',
    label: 'Sources for claims',
    category: 'links',
    weight: 1,
    critical: false,
    ...band(
      externalLinks > 0 || !hasClaims,
      hasClaims && externalLinks === 0,
      externalLinks > 0 ? 'Links out to external sources.' : 'No factual claims requiring sources.',
      'Cite an authoritative external source for the factual/statistical claims.',
      '',
    ),
  });

  // ── Media ────────────────────────────────────────────────────────────────
  const hasAspect = /\b\d{1,2}\s*:\s*\d{1,2}\b|aspect ratio/i.test(imagePrompt);
  const hasAvoid = /\bavoid\b|\bwithout\b|\bno\b|\bnot\b/i.test(imagePrompt);
  checks.push({
    id: 'image-prompt',
    label: 'Hero image prompt quality',
    category: 'media',
    weight: 1,
    critical: false,
    ...band(
      imagePrompt.length >= 120 && hasAspect && hasAvoid,
      imagePrompt.length > 0,
      'Hero image prompt is detailed with aspect ratio and constraints.',
      'Strengthen the hero image prompt: add aspect ratio and "what to avoid".',
      'Add a detailed hero image prompt.',
    ),
  });

  // Long, complex articles usually need in-body visuals (a chart, flowchart,
  // comparison) — flag when the plan has none. Short articles need only a hero.
  const inlineCount = input.inlineImageCount ?? 0;
  const needsInline = totalWords >= 1200;
  checks.push({
    id: 'inline-images',
    label: 'In-body images',
    category: 'media',
    weight: 1,
    critical: false,
    ...band(
      !needsInline || inlineCount >= 1,
      needsInline && inlineCount === 0,
      needsInline
        ? `${inlineCount} in-body image${inlineCount === 1 ? '' : 's'} planned for this long article.`
        : 'Short enough to need only a hero image.',
      'Long article with no in-body images — add a chart, flowchart, or comparison visual where it aids the reader.',
      '',
    ),
  });

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce(
    (sum, c) => sum + c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0),
    0,
  );
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;
  const criticalFail = checks.some((c) => c.critical && c.status === 'fail');
  const verdict: SeoCheckStatus = criticalFail || score < 60 ? 'fail' : score < 80 ? 'warn' : 'pass';
  const flags = checks.filter((c) => c.status === 'fail').map((c) => c.detail);

  return SeoReportSchema.parse({
    version: 1,
    score,
    verdict,
    checks,
    flags,
    wordCount: totalWords,
    generatedAt: new Date().toISOString(),
  });
}
