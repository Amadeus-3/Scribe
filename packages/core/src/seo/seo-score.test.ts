import { describe, it, expect } from 'vitest';
import { scoreArticleSeo, type ScoreArticleSeoInput } from './seo-score';
import { parseSeoReport, SeoReportSchema, type SeoReport } from './seo-report';

const KEYWORD = 'best coffee grinder';

function find(report: SeoReport, id: string) {
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new Error(`check ${id} not found`);
  return check;
}

/** A well-optimized article that should satisfy the deterministic rules. */
function goodArticle(): ScoreArticleSeoInput {
  const para =
    'A quality grinder changes how your morning cup tastes because consistent ' +
    'particle size controls extraction across brew methods. The right model ' +
    'depends on your brew style, your budget, and the counter space you have at home.';
  const block = Array(7).fill(para).join('\n\n');
  const contentMarkdown = [
    'The best coffee grinder gives you a consistent grind so your pour-over and ' +
      'espresso taste the way they should. Here is how to choose one for your home setup.',
    '## Why a good grinder matters',
    block,
    '## What to look for in the best coffee grinder',
    '- Burr type: conical or flat',
    '- Grind range from espresso to French press',
    '- Solid build quality and a real warranty',
    block,
    '## Burr vs blade grinders',
    block,
    'See our [pour-over brewing guide](/guides/pour-over) and the standards from [the SCA](https://example.com).',
    '## Conclusion',
    'A solid grinder is the upgrade that improves every cup. Pick the model that ' +
      'fits your brew method and budget, then dial in your grind.',
  ].join('\n\n');

  return {
    title: 'The Best Coffee Grinder for Pour-Over and Espresso at Home',
    slug: 'best-coffee-grinder',
    metaDescription:
      'Find the best coffee grinder for home brewing, with clear picks for ' +
      'pour-over and espresso and the key things to check before you buy a model.',
    contentMarkdown,
    imagePrompt:
      'Hero image of a modern conical burr coffee grinder on a wooden kitchen ' +
      'counter, warm morning light, shallow depth of field, photorealistic, ' +
      '16:9 aspect ratio. Avoid visible brand logos and any text.',
    primaryKeyword: KEYWORD,
  };
}

describe('scoreArticleSeo — well-optimized article', () => {
  const report = scoreArticleSeo(goodArticle());

  it('returns a schema-valid report', () => {
    expect(() => SeoReportSchema.parse(report)).not.toThrow();
  });

  it('passes with a high score and no flags', () => {
    expect(report.verdict).toBe('pass');
    expect(report.score).toBeGreaterThanOrEqual(80);
    expect(report.flags).toHaveLength(0);
  });

  it('passes every critical check', () => {
    const failedCritical = report.checks.filter((c) => c.critical && c.status === 'fail');
    expect(failedCritical).toHaveLength(0);
  });

  it('detects keyword placement in title, intro, and a heading', () => {
    expect(find(report, 'title-keyword').status).toBe('pass');
    expect(find(report, 'keyword-intro').status).toBe('pass');
    expect(find(report, 'keyword-heading').status).toBe('pass');
  });

  it('counts words from stripped markdown', () => {
    expect(report.wordCount).toBeGreaterThan(800);
  });
});

describe('scoreArticleSeo — weak article', () => {
  const report = scoreArticleSeo({
    title: 'Coffee',
    slug: 'Best_Coffee_Grinder!!',
    metaDescription: '',
    contentMarkdown: "In today's fast-paced world, coffee is great. Let us delve into coffee.",
    imagePrompt: '',
    primaryKeyword: KEYWORD,
  });

  it('fails overall with a low score and flags', () => {
    expect(report.verdict).toBe('fail');
    expect(report.score).toBeLessThan(60);
    expect(report.flags.length).toBeGreaterThan(0);
  });

  it('flags the expected critical problems', () => {
    expect(find(report, 'title-keyword').status).toBe('fail');
    expect(find(report, 'meta-present').status).toBe('fail');
    expect(find(report, 'headings-present').status).toBe('fail');
    expect(find(report, 'word-count').status).toBe('fail');
    expect(find(report, 'generic-opener').status).toBe('fail');
  });

  it('rejects a non-hyphenated, mixed-case slug', () => {
    expect(find(report, 'slug-format').status).toBe('fail');
  });
});

describe('scoreArticleSeo — keyword density', () => {
  it('flags keyword stuffing as a critical failure', () => {
    const stuffed = `${`${KEYWORD} `.repeat(40)}\n\n## ${KEYWORD}\n\n${`${KEYWORD} `.repeat(40)}`;
    const report = scoreArticleSeo({
      title: `The ${KEYWORD} guide for your home kitchen setup`,
      slug: 'best-coffee-grinder',
      metaDescription: 'x'.repeat(150),
      contentMarkdown: stuffed,
      primaryKeyword: KEYWORD,
    });
    const density = find(report, 'keyword-density');
    expect(density.status).toBe('fail');
    expect(density.critical).toBe(true);
  });
});

describe('scoreArticleSeo — banned phrases', () => {
  it('only adds the check when phrases are configured', () => {
    const report = scoreArticleSeo({ ...goodArticle(), bannedPhrases: [] });
    expect(report.checks.some((c) => c.id === 'banned-phrases')).toBe(false);
  });

  it('fails when a banned phrase appears in the body', () => {
    const article = goodArticle();
    const report = scoreArticleSeo({
      ...article,
      contentMarkdown: `${article.contentMarkdown}\n\nThis is a game-changer for sure.`,
      bannedPhrases: ['game-changer'],
    });
    const check = find(report, 'banned-phrases');
    expect(check.status).toBe('fail');
    expect(check.critical).toBe(true);
    expect(report.verdict).toBe('fail');
  });
});

describe('scoreArticleSeo — meta description length bands', () => {
  const base = {
    title: 'The Best Coffee Grinder for Home Pour-Over Brewing Today',
    slug: 'best-coffee-grinder',
    contentMarkdown: goodArticle().contentMarkdown,
    primaryKeyword: KEYWORD,
  };
  const metaOf = (len: number) => `${KEYWORD} ${'a'.repeat(Math.max(0, len - KEYWORD.length - 1))}`;

  it('passes at 150 characters', () => {
    expect(find(scoreArticleSeo({ ...base, metaDescription: metaOf(150) }), 'meta-length').status).toBe(
      'pass',
    );
  });
  it('warns at 100 characters', () => {
    expect(find(scoreArticleSeo({ ...base, metaDescription: metaOf(100) }), 'meta-length').status).toBe(
      'warn',
    );
  });
  it('fails at 80 characters', () => {
    expect(find(scoreArticleSeo({ ...base, metaDescription: metaOf(80) }), 'meta-length').status).toBe(
      'fail',
    );
  });
});

describe('scoreArticleSeo — in-body images', () => {
  const longBase = {
    title: 'The Best Coffee Grinder for Pour-Over and Espresso at Home',
    slug: 'best-coffee-grinder',
    metaDescription: 'x'.repeat(150),
    contentMarkdown: `The best coffee grinder intro paragraph.\n\n## Section\n\n${'word '.repeat(1300)}`,
    primaryKeyword: KEYWORD,
  };

  it('warns when a long article has no in-body images', () => {
    expect(find(scoreArticleSeo({ ...longBase, inlineImageCount: 0 }), 'inline-images').status).toBe(
      'warn',
    );
  });

  it('passes when a long article plans in-body images', () => {
    expect(find(scoreArticleSeo({ ...longBase, inlineImageCount: 2 }), 'inline-images').status).toBe(
      'pass',
    );
  });

  it('passes a short article with only a hero image', () => {
    const report = scoreArticleSeo({ ...goodArticle(), inlineImageCount: 0 });
    expect(find(report, 'inline-images').status).toBe('pass');
  });
});

describe('scoreArticleSeo — long / headline keyword', () => {
  // Mirrors a real case where the stored "keyword" is actually the headline.
  const para =
    'A starter emergency fund protects your budget when an unexpected bill lands, so you ' +
    'do not reach for a credit card. Building it on a tight paycheck means automating small, ' +
    'consistent transfers you will not miss.';
  const block = Array(9).fill(para).join('\n\n');
  const report = scoreArticleSeo({
    title: 'How to Build a $1,000 Emergency Fund Paycheck to Paycheck',
    slug: 'build-1000-emergency-fund-paycheck-to-paycheck',
    metaDescription:
      'Build a $1,000 emergency fund even on a paycheck-to-paycheck budget with simple ' +
      'automatic transfers and a quick subscription audit you can start today.',
    contentMarkdown: [
      'Building a $1,000 emergency fund on a paycheck-to-paycheck budget is doable when you ' +
        'automate small transfers and trim a few recurring costs. Here is the plan.',
      '## Why $1,000 is the right first goal',
      block,
      '## How to find money in a paycheck-to-paycheck budget',
      '- Audit subscriptions',
      '- Trim one recurring bill',
      '- Automate a small weekly transfer',
      block,
      '## Where to keep your emergency fund',
      block,
      'See our [budgeting guide](/guides/budgeting) for more.',
      '## Conclusion',
      'Start your emergency fund this week with one automatic transfer, then build from there.',
    ].join('\n\n'),
    imagePrompt:
      'Hero image of a calm home desk with a notebook budget and a small savings jar, warm ' +
      'light, photorealistic, 16:9 aspect ratio. Avoid logos and any text.',
    primaryKeyword: 'How to Build a $1,000 Emergency Fund (Even If You Live Paycheck to Paycheck)',
  });

  it('does not demand the whole headline in the title', () => {
    expect(find(report, 'title-keyword').status).toBe('pass');
  });

  it('skips exact density for a long-form keyword', () => {
    const density = find(report, 'keyword-density');
    expect(density.status).toBe('pass');
    expect(density.detail).toMatch(/long-form/i);
  });

  it('matches a heading on topic terms', () => {
    expect(find(report, 'keyword-heading').status).toBe('pass');
  });

  it('is not falsely failed by the keyword checks', () => {
    expect(report.verdict).not.toBe('fail');
    expect(report.flags.some((flag) => /missing from the title/i.test(flag))).toBe(false);
  });
});

describe('parseSeoReport', () => {
  it('returns null for nullish or invalid values', () => {
    expect(parseSeoReport(null)).toBeNull();
    expect(parseSeoReport(undefined)).toBeNull();
    expect(parseSeoReport({})).toBeNull();
    expect(parseSeoReport({ score: 50 })).toBeNull();
  });

  it('round-trips a generated report', () => {
    const report = scoreArticleSeo(goodArticle());
    expect(parseSeoReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });
});
