-- Backfill existing NULL article costs to 0 so the column can become NOT NULL
-- and `increment` updates work (NULL + n = NULL in SQL).
UPDATE "Article" SET "costUsd" = 0 WHERE "costUsd" IS NULL;

-- AlterTable: default per-article AI spend to 0 and make it required.
ALTER TABLE "Article" ALTER COLUMN "costUsd" SET NOT NULL,
ALTER COLUMN "costUsd" SET DEFAULT 0;
