import type { Prisma } from '@prisma/client';
import type { Db } from '../db/types';

/**
 * Append-only audit of every state-changing action (Spec §10.1.6). Call this in
 * the SAME transaction as the mutation it records so they commit atomically.
 */
export interface AuditEntry {
  /** Null for system/cron actions; a user id for human actions. */
  actorId?: string | null;
  actorType: 'human' | 'system';
  /** e.g. "site.created", "article.approved", "site.credentials.updated". */
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorType: entry.actorType,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    },
  });
}
