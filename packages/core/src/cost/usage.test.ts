import { describe, it, expect } from 'vitest';
import {
  BudgetExceededError,
  computeImageCostUsd,
  computeTextCostUsd,
  mapGeminiUsage,
  mapOpenRouterUsage,
  monthStartUtc,
} from './usage';

describe('mapOpenRouterUsage', () => {
  it('splits fresh vs cached input tokens', () => {
    expect(
      mapOpenRouterUsage({
        prompt_tokens: 1000,
        completion_tokens: 400,
        prompt_tokens_details: { cached_tokens: 250 },
      }),
    ).toEqual({ inputTokens: 750, outputTokens: 400, cachedTokens: 250 });
  });

  it('defaults missing/absent usage to zero', () => {
    expect(mapOpenRouterUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
    expect(mapOpenRouterUsage({ prompt_tokens: 10 })).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      cachedTokens: 0,
    });
  });
});

describe('mapGeminiUsage', () => {
  it('maps prompt/candidate token counts', () => {
    expect(mapGeminiUsage({ promptTokenCount: 12, candidatesTokenCount: 34 })).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      cachedTokens: 0,
    });
  });
  it('defaults absent metadata to zero', () => {
    expect(mapGeminiUsage(null)).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  });
});

describe('computeTextCostUsd', () => {
  const pricing = {
    'm/sonnet': { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 },
    'm/no-cache': { inputPerMTok: 3, outputPerMTok: 15 },
  };

  it('prices input, output, and cached tokens', () => {
    // (1_000_000*3 + 1_000_000*15 + 1_000_000*0.3) / 1e6 = 18.3
    const cost = computeTextCostUsd(pricing, 'm/sonnet', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(18.3, 6);
  });

  it('falls back to the input rate for cached tokens when no cache price', () => {
    const cost = computeTextCostUsd(pricing, 'm/no-cache', {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3, 6);
  });

  it('returns 0 for an unknown model (degrades, never throws)', () => {
    expect(
      computeTextCostUsd(pricing, 'm/unknown', { inputTokens: 999, outputTokens: 999, cachedTokens: 0 }),
    ).toBe(0);
  });
});

describe('computeImageCostUsd', () => {
  const imagePricing = { 'gemini-3.1-flash-image': { perImageUsd: 0.039 } };
  it('multiplies per-image price by count', () => {
    expect(computeImageCostUsd(imagePricing, 'gemini-3.1-flash-image', 2)).toBeCloseTo(0.078, 6);
  });
  it('returns 0 for an unknown image model', () => {
    expect(computeImageCostUsd(imagePricing, 'other', 5)).toBe(0);
  });
});

describe('monthStartUtc', () => {
  it('returns the first instant of the current UTC month', () => {
    const start = monthStartUtc(new Date('2026-06-19T13:45:00Z'));
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('BudgetExceededError', () => {
  it('carries scope, limit, and spend', () => {
    const e = new BudgetExceededError('monthly', 50, 51.2);
    expect(e.name).toBe('BudgetExceededError');
    expect(e.scope).toBe('monthly');
    expect(e.limitUsd).toBe(50);
    expect(e.spentUsd).toBe(51.2);
    expect(e.message).toContain('Monthly AI budget');
  });
});
