import type { Prisma, PrismaClient, StyleGuide } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { StyleGuideInputSchema } from '../domain/style-guide';

export async function getStyleGuide(
  db: PrismaClient,
  actor: Actor,
  siteId: string,
): Promise<StyleGuide | null> {
  authorize(actor, 'styleGuide.read');
  return db.styleGuide.findUnique({ where: { siteId } });
}

export async function upsertStyleGuide(
  db: PrismaClient,
  actor: Actor,
  siteId: string,
  input: unknown,
): Promise<StyleGuide> {
  authorize(actor, 'styleGuide.update');
  const data = StyleGuideInputSchema.parse(input);
  const fields = {
    systemPrompt: data.systemPrompt,
    businessContext: data.businessContext ?? null,
    audienceNotes: data.audienceNotes ?? null,
    seoGuidance: data.seoGuidance ?? null,
    imagePromptInstructions: data.imagePromptInstructions ?? null,
    toneNotes: data.toneNotes ?? null,
    formattingRules: data.formattingRules ?? null,
    readingLevel: data.readingLevel ?? null,
    bannedPhrases: data.bannedPhrases as Prisma.InputJsonValue,
  };
  return db.$transaction(async (tx) => {
    const guide = await tx.styleGuide.upsert({
      where: { siteId },
      create: { siteId, ...fields },
      update: fields,
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'styleGuide.upserted',
      entityType: 'StyleGuide',
      entityId: guide.id,
      metadata: { siteId },
    });
    return guide;
  });
}
