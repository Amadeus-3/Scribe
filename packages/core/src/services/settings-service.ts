import type { PrismaClient } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { getSettings, setSetting, type SettingKey, type Settings } from '../domain/settings';

export async function getSettingsForActor(db: PrismaClient, actor: Actor): Promise<Settings> {
  authorize(actor, 'settings.read');
  return getSettings(db);
}

export async function updateSetting<K extends SettingKey>(
  db: PrismaClient,
  actor: Actor,
  key: K,
  value: unknown,
): Promise<Settings[K]> {
  authorize(actor, 'settings.update');
  return db.$transaction(async (tx) => {
    const saved = await setSetting(tx, key, value);
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'settings.updated',
      entityType: 'Setting',
      entityId: key,
      metadata: { key },
    });
    return saved;
  });
}
