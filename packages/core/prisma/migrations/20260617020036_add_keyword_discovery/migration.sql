-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "discoveryScore" DOUBLE PRECISION,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "sourceMetadata" JSONB;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "discoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gscPropertyUrl" TEXT;

-- AlterTable
ALTER TABLE "StyleGuide" ADD COLUMN     "excludedTopics" JSONB,
ADD COLUMN     "geo" TEXT,
ADD COLUMN     "topicClusters" JSONB,
ADD COLUMN     "topicPillars" JSONB;

-- CreateIndex
CREATE INDEX "Keyword_siteId_source_idx" ON "Keyword"("siteId", "source");
