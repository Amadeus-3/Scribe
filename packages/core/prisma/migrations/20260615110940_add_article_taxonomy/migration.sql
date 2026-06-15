-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "categorySlug" TEXT,
ADD COLUMN     "tagSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];
