import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { adminUrl, testDatabaseUrl } from '../src/test/db';

/**
 * Vitest globalSetup for integration tests: ensure the `<db>_test` database
 * exists and is migrated to the current schema before any test runs.
 */
export default async function setup(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is required for integration tests');

  const testUrl = testDatabaseUrl();
  const dbName = new URL(testUrl).pathname.replace(/^\//, '');

  // Create the test database if it does not exist (connect to `postgres`).
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl(base) } } });
  try {
    const rows = await admin.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"`,
      dbName,
    );
    if (!rows[0]?.exists) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  // Apply committed migrations to the test database.
  const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: coreDir,
    env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
    stdio: 'inherit',
  });
}
