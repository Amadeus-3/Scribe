import { PrismaClient } from '@prisma/client';

/**
 * Integration tests run against a dedicated `<db>_test` database derived from
 * DATABASE_URL, so they never touch dev data. The test DB is created + migrated
 * by the vitest globalSetup (test/global-setup.ts).
 */
export function deriveTestUrl(base: string): string {
  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '') || 'scribe';
  url.pathname = `/${dbName}_test`;
  return url.toString();
}

/** URL to the server's default `postgres` database (used to CREATE the test DB). */
export function adminUrl(base: string): string {
  const url = new URL(base);
  url.pathname = '/postgres';
  return url.toString();
}

export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is required for integration tests');
  return deriveTestUrl(base);
}

let client: PrismaClient | undefined;
export function getTestPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  }
  return client;
}

// Child-first order is irrelevant with CASCADE, but listing every table keeps
// truncation total and explicit.
const TABLES = [
  'AuditLog',
  'Review',
  'PublishRecord',
  'UsageRecord',
  'ArticleRevision',
  'Article',
  'Brief',
  'Keyword',
  'StyleGuide',
  'Session',
  'Account',
  'VerificationToken',
  'Site',
  'Setting',
  'User',
];

export async function truncateAll(db: PrismaClient): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
