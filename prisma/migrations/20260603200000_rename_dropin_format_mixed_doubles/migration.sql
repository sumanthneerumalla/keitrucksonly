-- Rename DropInFormat enum value MIXED -> MIXED_DOUBLES.
-- Drop-in formats: SINGLES and DOUBLES are gender-OPEN; MIXED_DOUBLES is the
-- strict 1-male + 1-female formal format. In-place RENAME VALUE (no data loss,
-- no enum recreate). The DropInSession.format column is nullable + currently
-- has no rows using MIXED.
ALTER TYPE "DropInFormat" RENAME VALUE 'MIXED' TO 'MIXED_DOUBLES';
