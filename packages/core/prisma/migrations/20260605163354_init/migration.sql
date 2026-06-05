-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "CmsType" AS ENUM ('WORDPRESS');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "KeywordStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SearchIntent" AS ENUM ('INFORMATIONAL', 'COMMERCIAL', 'TRANSACTIONAL', 'NAVIGATIONAL');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('GENERATED', 'APPROVED', 'CONSUMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('QUEUED', 'BRIEFED', 'BRIEF_APPROVED', 'DRAFTING', 'DRAFTED', 'QA_PASSED', 'QA_FAILED', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RevisionAuthorType" AS ENUM ('AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "cmsType" "CmsType" NOT NULL DEFAULT 'WORDPRESS',
    "cmsCredentialsEnc" TEXT,
    "defaultAuthor" TEXT,
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "briefAutoApprove" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleGuide" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "toneNotes" TEXT,
    "formattingRules" TEXT,
    "readingLevel" TEXT,
    "bannedPhrases" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "intent" "SearchIntent",
    "searchVolume" INTEGER,
    "difficulty" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "KeywordStatus" NOT NULL DEFAULT 'QUEUED',
    "sourcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brief" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intent" "SearchIntent" NOT NULL,
    "outline" JSONB NOT NULL,
    "targetWordCount" INTEGER NOT NULL,
    "internalLinkTargets" JSONB,
    "serpAnalysis" JSONB,
    "status" "BriefStatus" NOT NULL DEFAULT 'GENERATED',
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "briefId" TEXT,
    "title" TEXT,
    "slug" TEXT,
    "metaDescription" TEXT,
    "contentMarkdown" TEXT,
    "contentHtml" TEXT,
    "status" "ArticleStatus" NOT NULL DEFAULT 'QUEUED',
    "wordCount" INTEGER,
    "qaReport" JSONB,
    "llmModel" TEXT,
    "costUsd" DECIMAL(10,4),
    "regenAttempts" INTEGER NOT NULL DEFAULT 0,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "authorType" "RevisionAuthorType" NOT NULL,
    "editedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishRecord" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "cmsPostId" TEXT,
    "url" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "articleId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StyleGuide_siteId_key" ON "StyleGuide"("siteId");

-- CreateIndex
CREATE INDEX "Keyword_siteId_status_idx" ON "Keyword"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_siteId_term_key" ON "Keyword"("siteId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "Brief_keywordId_key" ON "Brief"("keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "Article_keywordId_key" ON "Article"("keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "Article_briefId_key" ON "Article"("briefId");

-- CreateIndex
CREATE INDEX "Article_status_idx" ON "Article"("status");

-- CreateIndex
CREATE INDEX "Article_siteId_status_idx" ON "Article"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleRevision_articleId_version_key" ON "ArticleRevision"("articleId", "version");

-- CreateIndex
CREATE INDEX "Review_articleId_idx" ON "Review"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishRecord_idempotencyKey_key" ON "PublishRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublishRecord_articleId_idx" ON "PublishRecord"("articleId");

-- CreateIndex
CREATE INDEX "UsageRecord_createdAt_idx" ON "UsageRecord"("createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_articleId_idx" ON "UsageRecord"("articleId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "StyleGuide" ADD CONSTRAINT "StyleGuide_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brief" ADD CONSTRAINT "Brief_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishRecord" ADD CONSTRAINT "PublishRecord_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
