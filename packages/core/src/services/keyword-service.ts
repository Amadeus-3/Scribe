import type { Keyword, PrismaClient } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { KeywordSeedInputSchema } from '../domain/keyword';

export async function listKeywords(db: PrismaClient, actor: Actor, siteId: string): Promise<Keyword[]> {
  authorize(actor, 'keyword.read');
  return db.keyword.findMany({ where: { siteId }, orderBy: { sourcedAt: 'desc' } });
}

/** Add a seed list; returns the number actually created (duplicates skipped). */
export async function addKeywords(db: PrismaClient, actor: Actor, input: unknown): Promise<number> {
  authorize(actor, 'keyword.create');
  const { siteId, terms } = KeywordSeedInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    const result = await tx.keyword.createMany({
      data: terms.map((term) => ({ siteId, term })),
      skipDuplicates: true,
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'keywords.added',
      entityType: 'Site',
      entityId: siteId,
      metadata: { requested: terms.length, created: result.count },
    });
    return result.count;
  });
}

export async function deleteKeyword(db: PrismaClient, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'keyword.delete');
  await db.$transaction(async (tx) => {
    const keyword = await tx.keyword.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'keyword.deleted',
      entityType: 'Keyword',
      entityId: id,
      metadata: { term: keyword.term, siteId: keyword.siteId },
    });
  });
}
