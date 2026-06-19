import { describe, it, expect } from 'vitest';
import { buildNicheDescription, resolveSiteTopics } from './site-topics';

describe('buildNicheDescription', () => {
  it('uses structured topics when present', () => {
    const topics = { pillars: ['investing'], clusters: ['etfs'], excluded: [], geo: 'US' };
    expect(buildNicheDescription(topics, { businessContext: 'ignored when topics exist' })).toContain(
      'investing',
    );
  });

  it('falls back to the business context when topics are empty', () => {
    const topics = { pillars: [], clusters: [], excluded: [], geo: 'US' };
    const niche = buildNicheDescription(topics, {
      businessContext: 'A personal finance education blog about investing and side hustles.',
    });
    expect(niche).toContain('personal finance');
  });

  it('returns empty when there is neither topics nor context', () => {
    expect(buildNicheDescription({ pillars: [], clusters: [], excluded: [], geo: 'US' }, null)).toBe('');
  });
});

describe('resolveSiteTopics', () => {
  it('parses Json lists and normalizes geo to uppercase, defaulting to US', () => {
    const t = resolveSiteTopics({ topicPillars: ['a', 'b'], geo: 'gb' });
    expect(t.pillars).toEqual(['a', 'b']);
    expect(t.geo).toBe('GB');
    expect(resolveSiteTopics(null).geo).toBe('US');
  });
});
