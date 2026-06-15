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

// AI providers
export * from './ai/openrouter';
export * from './ai/gemini-image';
export * from './ai/style-guide-suggester';
export * from './ai/article-drafter';

// Public site context
export * from './site-context/public-site-context';

// SEO scoring (deterministic, advisory)
export * from './seo/seo-report';
export * from './seo/seo-score';

// CMS publishers
export * from './cms/strapi-publisher';
export * from './cms/strapi-taxonomy';

// Services (authorize + Zod + audit-in-transaction)
export * from './services/site-service';
export * from './services/style-guide-service';
export * from './services/keyword-service';
export * from './services/article-service';
export * from './services/settings-service';
export * from './services/provider-credential-service';

// Database access + generated Prisma types and enums
export type { Db } from './db/types';
export * from './db/client';
export * from '@prisma/client';
