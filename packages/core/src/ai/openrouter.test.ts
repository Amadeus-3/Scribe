import { describe, it, expect, vi } from 'vitest';
import {
  buildOpenRouterPricingCatalog,
  fetchOpenRouterTextModels,
  normalizeOpenRouterTextModel,
} from './openrouter';

describe('normalizeOpenRouterTextModel', () => {
  it('keeps text-output models and normalizes pricing + capabilities', () => {
    const model = normalizeOpenRouterTextModel({
      id: 'provider/model',
      name: 'Provider Model',
      description: 'A useful text model',
      created: 123,
      context_length: 128000,
      architecture: {
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
      },
      pricing: {
        prompt: '0.000001',
        completion: '0.000002',
        input_cache_read: '0.0000002',
        input_cache_write: '0.00000125',
      },
      supported_parameters: ['response_format', 'tools'],
    });

    expect(model).toEqual({
      id: 'provider/model',
      name: 'Provider Model',
      description: 'A useful text model',
      contextLength: 128000,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      promptPriceUsdPerToken: 0.000001,
      completionPriceUsdPerToken: 0.000002,
      cacheReadPriceUsdPerToken: 0.0000002,
      cacheWritePriceUsdPerToken: 0.00000125,
      supportsStructuredOutputs: true,
      supportsTools: true,
      createdAtUnix: 123,
    });
  });

  it('drops models that do not produce text', () => {
    const model = normalizeOpenRouterTextModel({
      id: 'provider/image',
      name: 'Provider Image',
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['image'],
      },
    });

    expect(model).toBeNull();
  });
});

describe('fetchOpenRouterTextModels', () => {
  it('fetches the catalog and returns only text-output models', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => ({
        data: [
          {
            id: 'text/model',
            name: 'Text Model',
            architecture: { output_modalities: ['text'] },
            pricing: { prompt: '0.000001', completion: '0.000003' },
          },
          {
            id: 'image/model',
            name: 'Image Model',
            architecture: { output_modalities: ['image'] },
          },
        ],
      }),
    });

    const models = await fetchOpenRouterTextModels({ apiKey: 'sk-or-test', fetchFn });

    expect(fetchFn).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer sk-or-test',
      },
    });
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('text/model');
  });
});

describe('buildOpenRouterPricingCatalog', () => {
  it('converts OpenRouter per-token prices into per-million-token settings', () => {
    const pricing = buildOpenRouterPricingCatalog([
      {
        id: 'text/model',
        name: 'Text Model',
        description: null,
        contextLength: null,
        inputModalities: ['text'],
        outputModalities: ['text'],
        promptPriceUsdPerToken: 0.000001,
        completionPriceUsdPerToken: 0.000003,
        cacheReadPriceUsdPerToken: 0.0000001,
        cacheWritePriceUsdPerToken: null,
        supportsStructuredOutputs: false,
        supportsTools: false,
        createdAtUnix: null,
      },
    ]);

    expect(pricing['text/model']).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 3,
      cacheReadPerMTok: 0.1,
    });
  });
});
