import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Accepts either the root client or a transaction client, so domain helpers can
 * run inside `prisma.$transaction(...)` (e.g. a mutation + its AuditLog row in
 * the same transaction — Spec §5.1, §10.1.6).
 */
export type Db = PrismaClient | Prisma.TransactionClient;
