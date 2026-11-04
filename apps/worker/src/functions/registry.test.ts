import { describe, it, expect } from 'vitest';
import { PIPELINE_EVENTS } from '@scribe/core';
import { functions } from './index';
import { PIPELINE_TICK_CONFIG } from './pipeline-tick';
import { ARTICLE_AUTODRAFT_CONFIG } from './article-autodraft';
import { DISCOVERY_RUN_CONFIG, WEEKLY_DISCOVERY_CONFIG } from './keyword-discovery';

/**
 * Wiring tests, not logic tests. The logic lives in pure functions in
 * packages/core, which is where its tests are.
 *
 * The failure these exist to catch is the nastiest one in an event system: a
 * function triggering on an event name nobody ever sends. Nothing errors,
 * nothing retries, no run appears — articles simply never get drafted, and the
 * only symptom is silence.
 */

/** The event names the client registers schemas for. */
const REGISTERED_EVENTS = new Set<string>(Object.values(PIPELINE_EVENTS));

interface TriggerLike {
  event?: string;
  cron?: string;
}

function triggersOf(fn: (typeof functions)[number]): TriggerLike[] {
  // `triggers` is not part of the public type surface, so read it structurally
  // rather than reaching into a private field with a cast to any.
  const record = fn as unknown as { opts?: { triggers?: TriggerLike[] } };
  const definition = fn as unknown as { triggers?: TriggerLike[] };
  return definition.triggers ?? record.opts?.triggers ?? [];
}

describe('function registry', () => {
  it('registers every autopilot function', () => {
    const ids = functions.map((fn) => fn.id(''));
    expect(ids).toEqual(
      expect.arrayContaining([
        WEEKLY_DISCOVERY_CONFIG.id,
        DISCOVERY_RUN_CONFIG.id,
        PIPELINE_TICK_CONFIG.id,
        ARTICLE_AUTODRAFT_CONFIG.id,
      ]),
    );
  });

  it('has no duplicate function ids', () => {
    // A duplicate id silently shadows a function at registration time.
    const ids = functions.map((fn) => fn.id(''));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only triggers on event names the client has schemas for', () => {
    const seen: string[] = [];
    for (const fn of functions) {
      const triggers = triggersOf(fn);
      // Guard against this test quietly becoming vacuous if a future Inngest
      // version moves `triggers`: no triggers at all means we are reading the
      // wrong field, not that the function has none.
      expect(triggers.length, `could not read triggers for ${fn.id('')}`).toBeGreaterThan(0);

      for (const trigger of triggers) {
        if (!trigger.event) continue;
        seen.push(trigger.event);
        expect(
          REGISTERED_EVENTS.has(trigger.event),
          `${fn.id('')} triggers on unregistered event "${trigger.event}"`,
        ).toBe(true);
      }
    }
    // At least one event-triggered function exists, so the loop did real work.
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('flow control', () => {
  it('keeps the tick cheap and non-retrying', () => {
    // The next tick in 15 minutes IS the retry; retrying re-reads stale state.
    expect(PIPELINE_TICK_CONFIG.retries).toBe(0);
    expect(PIPELINE_TICK_CONFIG.concurrency.limit).toBe(1);
  });

  it('makes autodraft idempotent per keyword and serialized per site', () => {
    expect(ARTICLE_AUTODRAFT_CONFIG.idempotency).toBe('event.data.keywordId');
    const [perSite, global] = ARTICLE_AUTODRAFT_CONFIG.concurrency;
    expect(perSite).toEqual({ key: 'event.data.siteId', limit: 1 });
    // The global cap is what bounds worst-case budget overshoot.
    expect(global.limit).toBe(1);
  });

  it('rate-limits discovery per site so it cannot be paid for twice a day', () => {
    expect(DISCOVERY_RUN_CONFIG.rateLimit).toEqual({
      limit: 1,
      period: '24h',
      key: 'event.data.siteId',
    });
  });
});
