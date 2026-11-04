import { z } from 'zod';
import type { Settings, OpenRouterTextModel } from '../domain/settings';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<HttpResponseLike>;

const OpenRouterRawModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    created: z.number().int().nonnegative().nullable().optional(),
    context_length: z.number().int().positive().nullable().optional(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).optional(),
        output_modalities: z.array(z.string()).optional(),
      })
      .nullable()
      .optional(),
    pricing: z
      .object({
        prompt: z.string().optional(),
        completion: z.string().optional(),
        input_cache_read: z.string().optional(),
        input_cache_write: z.string().optional(),
      })
      .nullable()
      .optional(),
    supported_parameters: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

const OpenRouterModelsResponseSchema = z.object({
  data: z.array(OpenRouterRawModelSchema),
});

type OpenRouterRawModel = z.infer<typeof OpenRouterRawModelSchema>;

export class OpenRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

function parsePrice(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function toPerMTok(value: number): number {
  return Number((value * 1_000_000).toFixed(6));
}

// The pipeline only ever sends text prompts and only ever consumes text
// completions, so a model that also accepts images/audio or emits non-text
// output is noise in the picker (and a cost/behaviour surprise). Keep the
// catalog to strictly text -> text models.
function isTextOnlyModality(modalities: string[]): boolean {
  return modalities.length > 0 && modalities.every((modality) => modality === 'text');
}

export function normalizeOpenRouterTextModel(
  model: OpenRouterRawModel,
): OpenRouterTextModel | null {
  const inputModalities = model.architecture?.input_modalities ?? [];
  const outputModalities = model.architecture?.output_modalities ?? [];
  if (!isTextOnlyModality(inputModalities) || !isTextOnlyModality(outputModalities)) {
    return null;
  }

  const supported = new Set(model.supported_parameters ?? []);
  return {
    id: model.id,
    name: model.name,
    description: model.description ?? null,
    contextLength: model.context_length ?? null,
    inputModalities,
    outputModalities,
    promptPriceUsdPerToken: parsePrice(model.pricing?.prompt),
    completionPriceUsdPerToken: parsePrice(model.pricing?.completion),
    cacheReadPriceUsdPerToken: parsePrice(model.pricing?.input_cache_read),
    cacheWritePriceUsdPerToken: parsePrice(model.pricing?.input_cache_write),
    supportsStructuredOutputs:
      supported.has('structured_outputs') || supported.has('response_format'),
    supportsTools: supported.has('tools'),
    createdAtUnix: model.created ?? null,
  };
}

export function buildOpenRouterPricingCatalog(models: OpenRouterTextModel[]): Settings['pricing'] {
  const pricing: Settings['pricing'] = {};

  for (const model of models) {
    if (model.promptPriceUsdPerToken === null || model.completionPriceUsdPerToken === null) {
      continue;
    }

    const entry: Settings['pricing'][string] = {
      inputPerMTok: toPerMTok(model.promptPriceUsdPerToken),
      outputPerMTok: toPerMTok(model.completionPriceUsdPerToken),
    };

    if (model.cacheReadPriceUsdPerToken !== null) {
      entry.cacheReadPerMTok = toPerMTok(model.cacheReadPriceUsdPerToken);
    }
    if (model.cacheWritePriceUsdPerToken !== null) {
      entry.cacheWritePerMTok = toPerMTok(model.cacheWritePriceUsdPerToken);
    }

    pricing[model.id] = entry;
  }

  return pricing;
}

export async function fetchOpenRouterTextModels({
  apiKey,
  fetchFn = fetch,
}: {
  apiKey?: string;
  fetchFn?: FetchLike;
} = {}): Promise<OpenRouterTextModel[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchFn(OPENROUTER_MODELS_URL, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new OpenRouterError(
      `OpenRouter model sync failed (${response.status} ${response.statusText}): ${body.slice(0, 240)}`,
    );
  }

  const payload = OpenRouterModelsResponseSchema.parse(await response.json());
  return payload.data
    .map((model) => normalizeOpenRouterTextModel(model))
    .filter((model): model is OpenRouterTextModel => model !== null);
}
