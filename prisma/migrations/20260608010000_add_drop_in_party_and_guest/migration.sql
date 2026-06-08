-- Drop-in: group/party join + persistent guests.
-- See designFiles/drop-in/group-join-feature-plan.md.
--
-- This migration:
--   1. Creates the DropInParty table.
--   2. Adds DropInCheckIn.partyId as NULLABLE, then backfills it (one party per
--      existing check-in, openToFill=true so behavior matches today's de-facto
--      solo-mix), then SETs NOT NULL.
--   3. Adds User.isGuest + User.guestCreatedBy self-FK.
--
-- Backfill is idempotent: it only touches DropInCheckIn rows that don't yet
-- have a partyId. Safe to re-run.

-- =============================================================================
-- 1. DropInParty table
-- =============================================================================

CREATE TABLE "DropInParty" (
    "partyId"         TEXT NOT NULL,
    "sessionId"       TEXT NOT NULL,
    "openToFill"      BOOLEAN NOT NULL DEFAULT false,
    "queuedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DropInParty_pkey" PRIMARY KEY ("partyId")
);

CREATE INDEX "DropInParty_sessionId_queuedAt_idx"
    ON "DropInParty"("sessionId", "queuedAt");

ALTER TABLE "DropInParty" ADD CONSTRAINT "DropInParty_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "DropInSession"("sessionId")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 2. DropInCheckIn.partyId — add nullable, backfill, set NOT NULL
-- =============================================================================

ALTER TABLE "DropInCheckIn" ADD COLUMN "partyId" TEXT;

-- Backfill: one DropInParty row per existing DropInCheckIn (any status),
-- openToFill = true (matches today's behavior where solo entries are implicitly
-- mixable via slice(0, N) selection). We materialize parties with
-- createdByUserId = ci.userId so we can map back without temp tables.
INSERT INTO "DropInParty" (
    "partyId", "sessionId", "openToFill", "queuedAt", "createdByUserId",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    ci."sessionId",
    true,
    ci."queuedAt",
    ci."userId",
    ci."createdAt",
    ci."updatedAt"
FROM "DropInCheckIn" ci
WHERE ci."partyId" IS NULL;

-- Wire each check-in to its freshly-created party. Match on
-- (sessionId, createdByUserId=userId) — unique because DropInCheckIn has
-- @@unique([sessionId, userId]) and we created exactly one party per check-in.
UPDATE "DropInCheckIn" ci
SET "partyId" = p."partyId"
FROM "DropInParty" p
WHERE ci."sessionId" = p."sessionId"
  AND ci."userId"    = p."createdByUserId"
  AND ci."partyId"   IS NULL;

-- All check-ins are now linked. Enforce NOT NULL + FK + index.
ALTER TABLE "DropInCheckIn" ALTER COLUMN "partyId" SET NOT NULL;

ALTER TABLE "DropInCheckIn" ADD CONSTRAINT "DropInCheckIn_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "DropInParty"("partyId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "DropInCheckIn_sessionId_partyId_idx"
    ON "DropInCheckIn"("sessionId", "partyId");

-- =============================================================================
-- 3. User: isGuest + guestCreatedBy self-FK
-- =============================================================================

ALTER TABLE "User" ADD COLUMN "isGuest"        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "guestCreatedBy" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_guestCreatedBy_fkey"
    FOREIGN KEY ("guestCreatedBy") REFERENCES "User"("userId")
    ON DELETE SET NULL ON UPDATE CASCADE;
