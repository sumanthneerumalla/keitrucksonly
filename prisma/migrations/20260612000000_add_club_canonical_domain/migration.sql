-- Phase 16 D2 (2026-06-12): club's canonical public base URL.
-- NULL = default platform URL https://facilitypresence.com/<clubShortName>.
ALTER TABLE "Club" ADD COLUMN "canonicalDomain" VARCHAR(255);
