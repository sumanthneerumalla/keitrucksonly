-- Phase 15 Stage 2 — add clubShortName scope to Article + ArticleTag.
-- null = platform article/tag; set = scoped to that club.
-- Slug uniqueness becomes per-scope (composite). Tags are also per-scope.

-- DropIndex
DROP INDEX "Article_slug_key";

-- DropIndex
DROP INDEX "Article_status_publishedAt_idx";

-- DropIndex
DROP INDEX "ArticleTag_name_key";

-- DropIndex
DROP INDEX "ArticleTag_slug_key";

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "clubShortName" TEXT;

-- AlterTable
ALTER TABLE "ArticleTag" ADD COLUMN     "clubShortName" TEXT;

-- CreateIndex
CREATE INDEX "Article_clubShortName_status_publishedAt_idx" ON "Article"("clubShortName", "status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Article_clubShortName_slug_key" ON "Article"("clubShortName", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleTag_clubShortName_slug_key" ON "ArticleTag"("clubShortName", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleTag_clubShortName_name_key" ON "ArticleTag"("clubShortName", "name");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTag" ADD CONSTRAINT "ArticleTag_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE SET NULL ON UPDATE CASCADE;
