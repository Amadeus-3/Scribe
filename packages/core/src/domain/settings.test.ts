import { describe, it, expect, vi } from 'vitest';
import { SettingsSchema, DEFAULT_SETTINGS, getSettings, setSetting } from './settings';
import type { Db } from '../db/types';

describe('settings schema + defaults', () => {
  it('seeds the budget + model defaults', () => {
    expect(DEFAULT_SETTINGS.monthly_budget_usd).toBe(50);
    expect(DEFAULT_SETTINGS.per_article_cost_ceiling_usd).toBe(2);
    expect(DEFAULT_SETTINGS.models.qa).toContain('haiku');
    expect(DEFAULT_SETTINGS.pricing['claude-sonnet-4-6']?.inputPerMTok).toBe(3);
  });

  it('rejects invalid values', () => {
    expect(() => SettingsSchema.shape.monthly_budget_usd.parse(-1)).toThrow();
    expect(() => SettingsSchema.shape.briefs_per_run.parse(0)).toThrow();
  });
});

describe('getSettings', () => {
  it('parses stored keys and fills defaults for absent ones', async () => {
    const db = {
      setting: { findMany: vi.fn().mockResolvedValue([{ key: 'monthly_budget_usd', value: 120 }]) },
    } as unknown as Db;
    const settings = await getSettings(db);
    expect(settings.monthly_budget_usd).toBe(120);
    expect(settings.briefs_per_run).toBe(5);
  });
});

describe('setSetting', () => {
  it('validates then upserts', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { setting: { upsert } } as unknown as Db;
    const value = await setSetting(db, 'monthly_budget_usd', 75);
    expect(value).toBe(75);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'monthly_budget_usd' },
      create: { key: 'monthly_budget_usd', value: 75 },
      update: { value: 75 },
    });
  });

  it('throws on an invalid value before writing', async () => {
    const upsert = vi.fn();
    const db = { setting: { upsert } } as unknown as Db;
    await expect(setSetting(db, 'briefs_per_run', -5)).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});
