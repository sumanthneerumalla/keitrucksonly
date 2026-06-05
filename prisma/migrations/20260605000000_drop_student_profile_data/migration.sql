-- per-club-profiles.md PR3 cutover. The profileData blob's fields were migrated
-- to MemberClubProfile (phone/medical/allergies/general) + User.dateOfBirth by
-- 20260604222752, and the app no longer reads or writes the column. Safe to drop.

-- AlterTable
ALTER TABLE "StudentProfile" DROP COLUMN "profileData";
