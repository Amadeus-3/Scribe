import { describe, it, expect } from 'vitest';
import { parseKeywordSeedList } from './keyword';
import { parseBannedPhrases, StyleGuideInputSchema } from './style-guide';
import { SiteInputSchema, WordPressCredentialsSchema } from './site';

describe('parseKeywordSeedList', () => {
  it('trims, drops blanks, and de-dupes case-insensitively (first casing kept)', () => {
    expect(parseKeywordSeedList('  Best Coffee \n\nbest coffee\nTea  \n')).toEqual(['Best Coffee', 'Tea']);
  });
  it('returns empty for blank input', () => {
    expect(parseKeywordSeedList('\n   \n')).toEqual([]);
  });
});

describe('parseBannedPhrases', () => {
  it('splits on newlines and commas, trims, drops blanks', () => {
    expect(parseBannedPhrases('delve,\n tapestry \nin conclusion,')).toEqual([
      'delve',
      'tapestry',
      'in conclusion',
    ]);
  });
});

describe('StyleGuideInputSchema', () => {
  it('requires a system prompt', () => {
    expect(() => StyleGuideInputSchema.parse({ bannedPhrases: [] })).toThrow();
  });
  it('accepts a valid guide', () => {
    const guide = StyleGuideInputSchema.parse({ systemPrompt: 'Write clearly.', bannedPhrases: ['delve'] });
    expect(guide.systemPrompt).toBe('Write clearly.');
    expect(guide.bannedPhrases).toEqual(['delve']);
  });
});

describe('SiteInputSchema', () => {
  it('requires a name + valid URL and defaults briefAutoApprove to true', () => {
    const site = SiteInputSchema.parse({ name: 'Blog', baseUrl: 'https://blog.example.com' });
    expect(site.briefAutoApprove).toBe(true);
  });
  it('rejects an invalid URL', () => {
    expect(() => SiteInputSchema.parse({ name: 'x', baseUrl: 'not-a-url' })).toThrow();
  });
});

describe('WordPressCredentialsSchema', () => {
  it('requires username + application password', () => {
    expect(() => WordPressCredentialsSchema.parse({ username: 'a' })).toThrow();
    expect(WordPressCredentialsSchema.parse({ username: 'a', applicationPassword: 'b' })).toEqual({
      username: 'a',
      applicationPassword: 'b',
    });
  });
});
