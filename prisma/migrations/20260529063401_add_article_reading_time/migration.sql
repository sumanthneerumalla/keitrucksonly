-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "readingTimeMinutes" INTEGER NOT NULL DEFAULT 1;

-- Phase 15 Step 5 polish (F8): backfill reading time from each row's bodyHtml.
-- Mirrors `~/lib/readingTime.ts`: strip HTML tags, count whitespace-separated
-- words, divide by 200 wpm, ceil, floor of 1 minute.
UPDATE "Article"
SET "readingTimeMinutes" = GREATEST(
    1,
    CEIL(
        array_length(
            regexp_split_to_array(
                btrim(regexp_replace("bodyHtml", '<[^>]*>', ' ', 'g')),
                '\s+'
            ),
            1
        )::numeric / 200
    )::int
);
