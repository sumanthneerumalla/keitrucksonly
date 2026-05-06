-- Data-only migration: clear the legacy hard-coded color defaults that
-- previously got baked into newly-created resources.
--
-- Background: the Manage Resources form in ResourceManagerClient.tsx
-- pre-filled the color picker with `#4F46E5` (indigo, =--primary) and
-- `#EFF6FF` (light-blue, =--accent). When operators created a court
-- without touching the color picker, those exact values got submitted
-- and stored — making every "default" resource render with indigo title
-- on light-blue cell, which clashes with the calendar's warm-paper
-- aesthetic.
--
-- This migration nullifies those columns ONLY where they exactly match
-- the legacy default pair. Any resource whose operator chose a different
-- color is left untouched. Reversible — operators can re-set colors via
-- the form.
--
-- The form pre-fill behaviour was also fixed in the same commit so new
-- resources don't bake these values back in.

UPDATE "ClubResource"
SET "color" = NULL,
    "backgroundColor" = NULL
WHERE "color" = '#4F46E5'
  AND "backgroundColor" = '#EFF6FF';

UPDATE "ClubResourceType"
SET "color" = NULL,
    "backgroundColor" = NULL
WHERE "color" = '#4F46E5'
  AND "backgroundColor" = '#EFF6FF';
