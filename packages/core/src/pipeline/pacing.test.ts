import { describe, it, expect } from 'vitest';
import {
  decidePacing,
  derivedSpacingMinutes,
  effectiveSpacingMinutes,
  isWithinRunWindow,
  rollingWindowStart,
  type PacingConfig,
  type PacingInputs,
  type RunWindow,
} from './pacing';

const ALWAYS_ON: RunWindow = {
  daysOfWeek: [],
  startHour: 0,
  endHour: 24,
  timezoneOffsetMinutes: 0,
};

const config = (over: Partial<PacingConfig> = {}): PacingConfig => ({
  articlesPerWeek: 3,
  maxUnreviewed: 5,
  minSpacingMinutes: 0,
  runWindow: ALWAYS_ON,
  ...over,
});

// 2026-08-30 is a Sunday (day 0).
const NOW = new Date('2026-08-30T12:00:00.000Z');

const inputs = (over: Partial<PacingInputs> = {}): PacingInputs => ({
  now: NOW,
  articlesInWindow: 0,
  lastArticleAt: null,
  unreviewed: 0,
  queuedKeywords: 10,
  ...over,
});

describe('rollingWindowStart', () => {
  it('defaults to 7 days back', () => {
    expect(rollingWindowStart(NOW)).toEqual(new Date('2026-08-23T12:00:00.000Z'));
  });
});

describe('derivedSpacingMinutes', () => {
  it('spreads the weekly target evenly', () => {
    expect(derivedSpacingMinutes(1)).toBe(10080); // one per week
    expect(derivedSpacingMinutes(3)).toBe(3360); // one per 56h
    expect(derivedSpacingMinutes(7)).toBe(1440); // one per day
  });

  it('is infinite when the target is zero, so nothing is ever eligible', () => {
    expect(derivedSpacingMinutes(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('effectiveSpacingMinutes', () => {
  it('prefers an explicit override', () => {
    expect(effectiveSpacingMinutes(config({ minSpacingMinutes: 90 }))).toBe(90);
  });

  it('derives from the weekly target when the override is zero', () => {
    expect(effectiveSpacingMinutes(config({ articlesPerWeek: 7 }))).toBe(1440);
  });
});

describe('isWithinRunWindow', () => {
  it('allows everything with the default all-day window', () => {
    expect(isWithinRunWindow(NOW, ALWAYS_ON)).toBe(true);
  });

  it('treats endHour as exclusive and startHour as inclusive', () => {
    const window = { ...ALWAYS_ON, startHour: 12, endHour: 13 };
    expect(isWithinRunWindow(new Date('2026-08-30T12:00:00Z'), window)).toBe(true);
    expect(isWithinRunWindow(new Date('2026-08-30T12:59:59Z'), window)).toBe(true);
    expect(isWithinRunWindow(new Date('2026-08-30T13:00:00Z'), window)).toBe(false);
    expect(isWithinRunWindow(new Date('2026-08-30T11:59:59Z'), window)).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    const overnight = { ...ALWAYS_ON, startHour: 22, endHour: 6 };
    expect(isWithinRunWindow(new Date('2026-08-30T23:00:00Z'), overnight)).toBe(true);
    expect(isWithinRunWindow(new Date('2026-08-30T03:00:00Z'), overnight)).toBe(true);
    expect(isWithinRunWindow(new Date('2026-08-30T12:00:00Z'), overnight)).toBe(false);
  });

  it('restricts to the configured days of week', () => {
    const weekdays = { ...ALWAYS_ON, daysOfWeek: [1, 2, 3, 4, 5] };
    expect(isWithinRunWindow(NOW, weekdays)).toBe(false); // Sunday
    expect(isWithinRunWindow(new Date('2026-08-31T12:00:00Z'), weekdays)).toBe(true); // Monday
  });

  it('shifts hours by the configured offset', () => {
    const window = { daysOfWeek: [], startHour: 9, endHour: 20, timezoneOffsetMinutes: -240 };
    // 23:00 UTC is 19:00 at UTC-4, inside the window.
    expect(isWithinRunWindow(new Date('2026-08-30T23:00:00Z'), window)).toBe(true);
    // 08:00 UTC is 04:00 at UTC-4, outside it — and would be INSIDE without the
    // offset applied, so this pins the shift rather than the raw UTC hour.
    expect(isWithinRunWindow(new Date('2026-08-30T08:00:00Z'), window)).toBe(false);
  });

  it('shifts the day of week across the offset boundary', () => {
    // 01:00 UTC Monday is still Sunday at UTC-4.
    const sundayOnly = { daysOfWeek: [0], startHour: 0, endHour: 24, timezoneOffsetMinutes: -240 };
    expect(isWithinRunWindow(new Date('2026-08-31T01:00:00Z'), sundayOnly)).toBe(true);
  });
});

describe('decidePacing', () => {
  it('grants exactly one slot when everything is clear', () => {
    const decision = decidePacing(config(), inputs());
    expect(decision.slots).toBe(1);
    expect(decision.reason).toBe('ok');
    expect(decision.detail.remainingThisWeek).toBe(3);
  });

  it('never grants more than one slot even with a large target and empty queue state', () => {
    const decision = decidePacing(config({ articlesPerWeek: 100 }), inputs({ queuedKeywords: 500 }));
    expect(decision.slots).toBe(1);
  });

  it('pauses on a zero weekly target', () => {
    const decision = decidePacing(config({ articlesPerWeek: 0 }), inputs());
    expect(decision).toMatchObject({ slots: 0, reason: 'paused' });
  });

  it('skips outside the run window', () => {
    const window = { ...ALWAYS_ON, startHour: 0, endHour: 6 };
    const decision = decidePacing(config({ runWindow: window }), inputs());
    expect(decision).toMatchObject({ slots: 0, reason: 'outside_run_window' });
  });

  it('stops once the weekly target is met', () => {
    const decision = decidePacing(config({ articlesPerWeek: 3 }), inputs({ articlesInWindow: 3 }));
    expect(decision).toMatchObject({ slots: 0, reason: 'weekly_target_met' });
    expect(decision.detail.remainingThisWeek).toBe(0);
  });

  it('counts human-made articles toward the target, so output cannot double', () => {
    // The weekly number is a cost budget for the site, not an automation quota.
    const decision = decidePacing(config({ articlesPerWeek: 2 }), inputs({ articlesInWindow: 2 }));
    expect(decision.reason).toBe('weekly_target_met');
  });

  it('still allows a draft when one under the target', () => {
    const decision = decidePacing(config({ articlesPerWeek: 3 }), inputs({ articlesInWindow: 2 }));
    expect(decision.slots).toBe(1);
  });

  it('stops when the unreviewed backlog is full', () => {
    const decision = decidePacing(config({ maxUnreviewed: 2 }), inputs({ unreviewed: 2 }));
    expect(decision).toMatchObject({ slots: 0, reason: 'unreviewed_backlog_full' });
    expect(decision.detail.backlogHeadroom).toBe(0);
  });

  it('treats maxUnreviewed 0 as unlimited', () => {
    const decision = decidePacing(config({ maxUnreviewed: 0 }), inputs({ unreviewed: 999 }));
    expect(decision.slots).toBe(1);
    expect(decision.detail.backlogHeadroom).toBe(Number.POSITIVE_INFINITY);
  });

  it('waits for the spacing interval to elapse', () => {
    // 3/week is one per 56h; the last article was 1h ago.
    const decision = decidePacing(
      config({ articlesPerWeek: 3 }),
      inputs({ lastArticleAt: new Date(NOW.getTime() - 60 * 60 * 1000) }),
    );
    expect(decision).toMatchObject({ slots: 0, reason: 'spacing_not_elapsed' });
    expect(decision.detail.nextEligibleAt).toEqual(new Date('2026-09-01T19:00:00.000Z'));
  });

  it('allows a draft exactly at the spacing threshold', () => {
    const spacingMs = 3360 * 60_000; // 3/week
    const decision = decidePacing(
      config({ articlesPerWeek: 3 }),
      inputs({ lastArticleAt: new Date(NOW.getTime() - spacingMs) }),
    );
    expect(decision.slots).toBe(1);
  });

  it('measures spacing from the newest article of any origin', () => {
    // A human burst must not get an auto draft stacked on top of it.
    const decision = decidePacing(
      config({ minSpacingMinutes: 120 }),
      inputs({ lastArticleAt: new Date(NOW.getTime() - 60 * 60 * 1000) }),
    );
    expect(decision.reason).toBe('spacing_not_elapsed');
  });

  it('ignores spacing when the site has never produced an article', () => {
    const decision = decidePacing(config(), inputs({ lastArticleAt: null }));
    expect(decision.slots).toBe(1);
    expect(decision.detail.nextEligibleAt).toBeNull();
  });

  it('skips when there is nothing claimable', () => {
    const decision = decidePacing(config(), inputs({ queuedKeywords: 0 }));
    expect(decision).toMatchObject({ slots: 0, reason: 'no_queued_keywords' });
  });

  it('reports the most decisive reason first when several apply', () => {
    // Paused outranks everything: it is the cheapest and most explanatory.
    const decision = decidePacing(
      config({ articlesPerWeek: 0, maxUnreviewed: 1 }),
      inputs({ unreviewed: 99, queuedKeywords: 0 }),
    );
    expect(decision.reason).toBe('paused');
  });
});
