-- Court-preference feature: hard court lock on a party.
-- Nullable, no backfill (null = any court = prior behavior).
-- AlterTable
ALTER TABLE "DropInParty" ADD COLUMN     "preferredCourtId" TEXT;
