import { describe, it, expect, vi } from 'vitest';
import { recordAudit } from './audit-log';
import type { Db } from '../db/types';

describe('recordAudit', () => {
  it('creates an audit row from the entry', async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { auditLog: { create } } as unknown as Db;
    await recordAudit(db, {
      actorId: 'u1',
      actorType: 'human',
      action: 'site.created',
      entityType: 'Site',
      entityId: 's1',
      metadata: { name: 'Blog' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'u1',
        actorType: 'human',
        action: 'site.created',
        entityType: 'Site',
        entityId: 's1',
        metadata: { name: 'Blog' },
      },
    });
  });

  it('defaults actorId to null and omits metadata when absent (system action)', async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { auditLog: { create } } as unknown as Db;
    await recordAudit(db, {
      actorType: 'system',
      action: 'sourcing.ran',
      entityType: 'System',
      entityId: 'sourcing.weekly',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        actorType: 'system',
        action: 'sourcing.ran',
        entityType: 'System',
        entityId: 'sourcing.weekly',
      },
    });
  });
});
