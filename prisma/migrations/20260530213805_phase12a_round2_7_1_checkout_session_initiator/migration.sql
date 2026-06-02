-- Phase 12a Round 2.7.1 — CheckoutSession initiator + explicit expiry
--
-- Adds two fields to CheckoutSession to close a Round 1 spec-drift gap
-- (designFiles/roadmap/phase12-stripe-connect.md §4.4 + §7.8.13):
--
--   * `initiatedByUserId` — the user who clicked "Pay" (actor), as opposed
--     to `consumerUserId` (beneficiary). Drives the §7.8.13 resume-checkout
--     banner so a parent paying for a kid sees their own row, not the kid's.
--     Nullable + SetNull on user delete so guest checkouts and post-delete
--     audit rows still resolve.
--
--   * `expiresAt` — explicit expiry mirroring the Stripe session's
--     `expires_at` (createdAt + 30 min). The banner query filters
--     `expiresAt > now()` so stale rows never display even when status
--     stays 'open' (no expiry cron in 12a — deferred).
--
-- Hand-written (not `prisma migrate dev`-generated) per Round 1 precedent:
-- `expiresAt` is NOT NULL with no default, so a generator that didn't see
-- the data shape would refuse. Backfill order:
--
--   1. Add `expiresAt` nullable
--   2. Backfill existing rows to `createdAt + interval '30 minutes'`
--      (defensive — there should be no live CheckoutSession rows yet)
--   3. Tighten to NOT NULL

-- 1. Add columns
ALTER TABLE "CheckoutSession"
    ADD COLUMN "initiatedByUserId" TEXT,
    ADD COLUMN "expiresAt" TIMESTAMP(3);

-- 2. Defensive backfill: any existing rows get a 30-minute window from
-- their createdAt. There should be none in dev (Round 1 just landed), but
-- this is idempotent and guards against the prod migration order.
UPDATE "CheckoutSession"
    SET "expiresAt" = "createdAt" + interval '30 minutes'
    WHERE "expiresAt" IS NULL;

-- 3. Tighten to NOT NULL now that every row has a value
ALTER TABLE "CheckoutSession"
    ALTER COLUMN "expiresAt" SET NOT NULL;

-- 4. FK on initiatedByUserId (SetNull preserves the row when the actor
-- user is deleted; the CheckoutSession is read-only audit/debug anyway)
ALTER TABLE "CheckoutSession"
    ADD CONSTRAINT "CheckoutSession_initiatedByUserId_fkey"
    FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("userId")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Index for the §7.8.13 banner query
-- (where initiatedByUserId = ? AND clubShortName = ? AND status = 'open'
--  AND expiresAt > now())
CREATE INDEX "CheckoutSession_initiatedByUserId_idx"
    ON "CheckoutSession"("initiatedByUserId");
