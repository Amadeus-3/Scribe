/**
 * Public surface of @scribe/core (Spec §3.1).
 *
 * This package stays free of framework/UI imports so it is testable in
 * isolation (Spec §15). Domain logic (state machine, Zod schemas, LLM + CMS
 * clients, QA checks) is added here in later phases.
 */

// Configuration
export * from './config/env';

// Security primitives
export * from './crypto/encryption';
export * from './auth/authorize';

// Observability
export * from './observability/logger';

// Domain
export * from './audit/audit-log';
export * from './domain/settings';
export * from './domain/style-guide';
export * from './domain/site';
export * from './domain/keyword';

// Database access + generated Prisma types and enums
export type { Db } from './db/types';
export * from './db/client';
export * from '@prisma/client';
