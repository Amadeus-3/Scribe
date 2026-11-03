import { z } from 'zod';
import { mapOpenRouterUsage, type LlmUsage } from '../cost/usage';

/**
 * Minimal OpenRouter chat-completions helper, shared by features that need a
 * one-shot completion (topic relevance scoring, web-search discovery). Fetch is
 * injectable so callers stay testable with mocks. Supports the OpenRouter web
 * plugin for grounded, recent results.
 */
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** OpenRouter returns token usage alongside the completion; capture it for cost accounting. */
const UsageRawSchema = z
  .object({
    prompt_tokens: z.number().nullable().optional(),
    completion_tokens: z.number().nullable().optional(),
    prompt_tokens_details: z
      .object({ cached_tokens: z.number().nullable().optional() })
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponseLike>;

const ChatResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  usage: UsageRawSchema,
});

export interface OpenRouterChatResult {
  content: string;
  usage: LlmUsage;
}

export class OpenRouterChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterChatError';
  }
}

export interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function callOpenRouterChat({
  apiKey,
  model,
  messages,
  responseFormat,
  plugins,
  temperature = 0.2,
  fetchFn = fetch,
}: {
  apiKey?: string;
  model: string;
  messages: OpenRouterChatMessage[];
  responseFormat?: { type: 'json_object' };
  /** e.g. [{ id: 'web', max_results: 5 }] to enable grounded web search. */
  plugins?: Array<Record<string, unknown>>;
  temperature?: number;
  fetchFn?: FetchLike;
}): Promise<OpenRouterChatResult> {
  if (!apiKey) {
    throw new OpenRouterChatError('Save an OpenRouter API key in Settings first.');
  }
  const body: Record<string, unknown> = { model, messages, temperature };
  if (responseFormat) body.response_format = responseFormat;
  if (plugins) body.plugins = plugins;

  const res = await fetchFn(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new OpenRouterChatError(
      `OpenRouter chat failed (${res.status} ${res.statusText}): ${text.slice(0, 240)}`,
    );
  }
  const parsed = ChatResponseSchema.parse(await res.json());
  const content = parsed.choices[0]?.message.content;
  if (!content) throw new OpenRouterChatError('OpenRouter returned empty content.');
  return { content, usage: mapOpenRouterUsage(parsed.usage) };
}

/** Parse a JSON value from model output (raw, fenced, or embedded). Throws on failure. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  // Fall back to the first balanced-looking object/array span.
  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    const first = trimmed.indexOf(open);
    const last = trimmed.lastIndexOf(close);
    if (first >= 0 && last > first) {
      const parsed = tryParse(trimmed.slice(first, last + 1));
      if (parsed !== undefined) return parsed;
    }
  }
  throw new OpenRouterChatError('Model did not return parseable JSON.');
}
