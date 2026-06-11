-- Drop the guest-user columns (2026-06-11 cleanup).
--
-- The guest feature (User rows with isGuest=true, created via a drop-in
-- createGuest procedure) shipped schema + backend but never got a UI entry
-- point, so no guest rows were ever created in any environment. The product
-- decision is logged-in club members only — guests are cut, not deferred.
-- See designFiles/drop-in/group-join-feature-plan.md (rewritten same day).
--
-- Safe to run on dev + prod: both columns are unreferenced by live code at
-- deploy time and contain only default values (isGuest=false, NULL).

ALTER TABLE "User" DROP CONSTRAINT "User_guestCreatedBy_fkey";
ALTER TABLE "User" DROP COLUMN "guestCreatedBy";
ALTER TABLE "User" DROP COLUMN "isGuest";
