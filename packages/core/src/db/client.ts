import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client singleton (Spec §3.1). Both the web app and the worker
 * import this. In development we stash the instance on `globalThis` so Next.js
 * hot-reload does not exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { scribePrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.scribePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.scribePrisma = prisma;
}
