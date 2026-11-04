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
export * from './auth/system-actor';
export * from './auth/human-actor';
export * from './auth/sign-in-policy';

// Observability
export * from './observability/logger';

// Domain
export * from './audit/audit-log';
export * from './domain/settings';
export * from './domain/style-guide';
export * from './domain/site';
export * from './domain/keyword';
export * from './domain/article-transitions';

// Pipeline (autopilot)
export * from './pipeline/pacing';
export * from './pipeline/events';

// Notifications
export * from './notify/review-digest';
export * from './notify/mailer';

// AI providers
export * from './ai/openrouter';
export * from './ai/openrouter-chat';
export * from './ai/gemini-image';
export * from './ai/style-guide-suggester';
export * from './ai/article-drafter';

// Trending-topic discovery (pluggable keyword sources)
export * from './keyword-sources/types';
export * from './keyword-sources/site-topics';
export * from './keyword-sources/run-discovery';
export * from './keyword-sources/sources';
export * from './keyword-sources/gsc-source';
export * from './keyword-sources/trends-rss-source';
export * from './keyword-sources/llm-web-source';

// Public site context
export * from './site-context/public-site-context';

// SEO scoring (deterministic, advisory)
export * from './seo/seo-report';
export * from './seo/seo-score';

// Cost/usage accounting + budget guard
export * from './cost/usage';

// CMS publishers
export * from './cms/strapi-publisher';
export * from './cms/strapi-taxonomy';

// Services (authorize + Zod + audit-in-transaction)
export * from './services/pipeline-service';
export * from './services/site-service';
export * from './services/style-guide-service';
export * from './services/keyword-service';
export * from './services/article-service';
export * from './services/settings-service';
export * from './services/provider-credential-service';
export * from './services/keyword-discovery-service';
export * from './services/user-service';

// Database access + generated Prisma types and enums
export type { Db } from './db/types';
export * from './db/client';
export * from '@prisma/client';
