import type { Db } from '../db/types';
import { getSettings, type Settings } from '../domain/settings';
import { logger } from '../observability/logger';

/**
 * Cost/usage accounting for every LLM + image call (Spec §7.4, §10.7). The
 * UsageRecord table and the budget Settings (`monthly_budget_usd`,
 * `per_article_cost_ceiling_usd`) exist; this module is what actually records a
 * row per call and enforces the budget *before* each call.
 *
 * The budget guard is a SOFT pre-check: it blocks the next call once spend has
 * crossed a ceiling, so a single in-flight call can overshoot slightly. That is
 * acceptable per the spec intent ("checked before every call") and keeps the
 * guard cheap. It never gates publishing — only generation/image/discovery.
 */

/** Normalized token usage from any provider. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cached/prompt-cache-read input tokens, priced separately when known. */
  cachedTokens: number;
}

export const EMPTY_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

/** Every billable call site, recorded on UsageRecord.purpose. */
export type UsagePurpose =
  | 'draft'
  | 'regenerate'
  | 'classify_taxonomy'
  | 'suggest_inline_images'
  | 'style_guide'
  | 'hero_image'
  | 'inline_image'
  | 'discovery_relevance'
  | 'discovery_web';

export type CostProvider = 'openrouter' | 'gemini';

/** Raw OpenRouter `usage` object (all fields optional/defensive). */
interface OpenRouterUsageRaw {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
}

/** Map OpenRouter usage → LlmUsage, splitting fresh vs cached input tokens. */
export function mapOpenRouterUsage(usage: OpenRouterUsageRaw | null | undefined): LlmUsage {
  if (!usage) return { ...EMPTY_USAGE };
  const prompt = Math.max(0, usage.prompt_tokens ?? 0);
  const cached = Math.max(0, usage.prompt_tokens_details?.cached_tokens ?? 0);
  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: Math.max(0, usage.completion_tokens ?? 0),
    cachedTokens: cached,
  };
}

/** Raw Gemini `usageMetadata` object. */
interface GeminiUsageRaw {
  promptTokenCount?: number | null;
  candidatesTokenCount?: number | null;
}

/** Map Gemini usageMetadata → LlmUsage (Gemini has no cache-read token tier here). */
export function mapGeminiUsage(meta: GeminiUsageRaw | null | undefined): LlmUsage {
  if (!meta) return { ...EMPTY_USAGE };
  return {
    inputTokens: Math.max(0, meta.promptTokenCount ?? 0),
    outputTokens: Math.max(0, meta.candidatesTokenCount ?? 0),
    cachedTokens: 0,
  };
}

const roundUsd = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Text cost in USD from token usage and the per-model pricing catalog (USD per
 * million tokens). Cached input is priced at cacheReadPerMTok when known, else
 * at the normal input rate. An unknown model degrades to $0 with a warning so a
 * missing price never blocks generation.
 */
export function computeTextCostUsd(
  pricing: Settings['pricing'],
  model: string,
  usage: LlmUsage,
): number {
  const entry = pricing[model];
  if (!entry) {
    logger.warn({ model }, 'no pricing entry for model — recording usage at $0 cost');
    return 0;
  }
  const cacheRate = entry.cacheReadPerMTok ?? entry.inputPerMTok;
  const cost =
    (usage.inputTokens * entry.inputPerMTok +
      usage.outputTokens * entry.outputPerMTok +
      usage.cachedTokens * cacheRate) /
    1_000_000;
  return roundUsd(cost);
}

/** Flat per-image cost in USD from the image pricing catalog. */
export function computeImageCostUsd(
  imagePricing: Settings['image_pricing'],
  model: string,
  imageCount: number,
): number {
  const entry = imagePricing[model];
  if (!entry) {
    logger.warn({ model }, 'no image pricing entry for model — recording usage at $0 cost');
    return 0;
  }
  return roundUsd(entry.perImageUsd * Math.max(0, imageCount));
}

/** Start of the current calendar month in UTC. */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Thrown by the budget guard before a call that would exceed a configured ceiling. */
export class BudgetExceededError extends Error {
  readonly scope: 'monthly' | 'article';
  readonly limitUsd: number;
  readonly spentUsd: number;
  constructor(scope: 'monthly' | 'article', limitUsd: number, spentUsd: number) {
    super(
      scope === 'monthly'
        ? `Monthly AI budget reached: $${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)} spent. Raise monthly_budget_usd in Settings to continue.`
        : `Per-article AI budget reached: $${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)} spent on this article. Raise per_article_cost_ceiling_usd in Settings to continue.`,
    );
    this.name = 'BudgetExceededError';
    this.scope = scope;
    this.limitUsd = limitUsd;
    this.spentUsd = spentUsd;
  }
}

/** Month-to-date spend across all AI calls, in USD. */
export async function monthToDateSpendUsd(db: Db, now: Date = new Date()): Promise<number> {
  const agg = await db.usageRecord.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: monthStartUtc(now) } },
  });
  return Number(agg._sum.costUsd ?? 0);
}

/**
 * Spend recorded against a single article, in USD. Aggregates the UsageRecord
 * ledger (the source of truth, full precision) rather than the denormalized,
 * lower-precision Article.costUsd column, so both budget scopes agree.
 */
async function articleSpendUsd(db: Db, articleId: string): Promise<number> {
  const agg = await db.usageRecord.aggregate({
    _sum: { costUsd: true },
    where: { articleId },
  });
  return Number(agg._sum.costUsd ?? 0);
}

/**
 * Budget guard — call BEFORE each AI request. Throws BudgetExceededError when
 * month-to-date spend has reached `monthly_budget_usd`, or (when articleId is
 * given) when the article's spend has reached `per_article_cost_ceiling_usd`.
 * A ceiling of 0 disables that scope (treated as "unlimited").
 */
export async function assertWithinBudget(
  db: Db,
  args: { articleId?: string | null; now?: Date } = {},
): Promise<void> {
  const settings = await getSettings(db);
  const now = args.now ?? new Date();

  const monthlyLimit = settings.monthly_budget_usd;
  if (monthlyLimit > 0) {
    const spent = await monthToDateSpendUsd(db, now);
    if (spent >= monthlyLimit) {
      throw new BudgetExceededError('monthly', monthlyLimit, spent);
    }
  }

  const articleLimit = settings.per_article_cost_ceiling_usd;
  if (args.articleId && articleLimit > 0) {
    const spent = await articleSpendUsd(db, args.articleId);
    if (spent >= articleLimit) {
      throw new BudgetExceededError('article', articleLimit, spent);
    }
  }
}

/**
 * Record one UsageRecord row and, for article-scoped calls, increment the
 * article's denormalized spend. Accepts a transaction client so it can commit in
 * the same transaction as the mutation it accompanies.
 */
export async function recordUsage(
  db: Db,
  args: {
    articleId?: string | null;
    provider: CostProvider;
    model: string;
    purpose: UsagePurpose;
    usage: LlmUsage;
    costUsd: number;
  },
): Promise<void> {
  await db.usageRecord.create({
    data: {
      articleId: args.articleId ?? null,
      provider: args.provider,
      model: args.model,
      purpose: args.purpose,
      inputTokens: args.usage.inputTokens,
      outputTokens: args.usage.outputTokens,
      cachedTokens: args.usage.cachedTokens,
      costUsd: args.costUsd,
    },
  });
  if (args.articleId) {
    await db.article.update({
      where: { id: args.articleId },
      data: { costUsd: { increment: args.costUsd } },
    });
  }
}
