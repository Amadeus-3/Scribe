import { googleSearchConsoleSource } from './gsc-source';
import { googleTrendsRssSource } from './trends-rss-source';
import { llmWebTrendSource } from './llm-web-source';
import type { KeywordSource } from './types';

/**
 * Default discovery sources, in priority order. GSC is the primary (free,
 * per-site) signal; Trends RSS + LLM web-search add momentum/breadth. A paid
 * category-filtered provider (DataForSEO) can be inserted here later behind the
 * same interface without touching the orchestrator or queueing.
 */
export const DEFAULT_KEYWORD_SOURCES: KeywordSource[] = [
  googleSearchConsoleSource,
  googleTrendsRssSource,
  llmWebTrendSource,
];
