-- CreateTable
CREATE TABLE "MemberClubProfile" (
    "memberClubProfileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "phone" VARCHAR(32),
    "streetAddress" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(50),
    "zipCode" VARCHAR(20),
    "emergencyContactName" VARCHAR(120),
    "emergencyContactPhone" VARCHAR(32),
    "emergencyContactRelationship" VARCHAR(50),
    "referralSource" VARCHAR(120),
    "howHeard" VARCHAR(120),
    "medicalNotes" VARCHAR(2000),
    "allergies" VARCHAR(1000),
    "generalNotes" VARCHAR(5000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberClubProfile_pkey" PRIMARY KEY ("memberClubProfileId")
);

-- CreateIndex
CREATE INDEX "MemberClubProfile_userId_idx" ON "MemberClubProfile"("userId");

-- CreateIndex
CREATE INDEX "MemberClubProfile_clubShortName_idx" ON "MemberClubProfile"("clubShortName");

-- CreateIndex
CREATE UNIQUE INDEX "MemberClubProfile_userId_clubShortName_key" ON "MemberClubProfile"("userId", "clubShortName");

-- AddForeignKey
ALTER TABLE "MemberClubProfile" ADD CONSTRAINT "MemberClubProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberClubProfile" ADD CONSTRAINT "MemberClubProfile_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Data backfill (see designFiles/per-club-profiles.md §5). Runs automatically
-- with the migration — no separate script. Idempotent (ON CONFLICT guards +
-- deterministic ids), so safe even if re-run. Ids are derived from the unique
-- (userId, clubShortName) pair: cuids contain no ':' so the value is collision-
-- free, and there is NO dependency on gen_random_uuid()/pgcrypto or any Postgres
-- version. The app mints cuids for rows created after this migration.
-- ============================================================================

-- 1) Empty placeholder row for every (userId, clubShortName) the user belongs to.
--    UserClub is per-facility, so DISTINCT collapses multi-facility duplicates.
INSERT INTO "MemberClubProfile" ("memberClubProfileId", "userId", "clubShortName", "createdAt", "updatedAt")
SELECT 'mcp:' || m."userId" || ':' || m."clubShortName", m."userId", m."clubShortName", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "userId", "clubShortName" FROM "UserClub") m
ON CONFLICT ("userId", "clubShortName") DO NOTHING;

-- 2) Copy the legacy StudentProfile.profileData blob into the member's PRIMARY
--    club row. dateOfBirth is DROPPED (it lives on User.dateOfBirth); skillLevel
--    is untouched (stays global on StudentProfile). Primary club = User.clubShortName
--    when that is a real membership, else the lexicographically-first membership,
--    else the active club (orphan with no UserClub rows). LEFT(...) clamps to the
--    column caps so a stale over-long value can't fail the insert (old phone cap 40).
WITH uc AS (
    SELECT DISTINCT "userId", "clubShortName" FROM "UserClub"
),
pc AS (
    SELECT u."userId",
        COALESCE(
            (SELECT x."clubShortName" FROM uc x
             WHERE x."userId" = u."userId" AND x."clubShortName" = u."clubShortName" LIMIT 1),
            (SELECT MIN(x."clubShortName") FROM uc x WHERE x."userId" = u."userId"),
            u."clubShortName"
        ) AS "clubShortName"
    FROM "User" u
)
INSERT INTO "MemberClubProfile" (
    "memberClubProfileId", "userId", "clubShortName",
    "phone", "medicalNotes", "allergies", "generalNotes",
    "createdAt", "updatedAt"
)
SELECT
    'mcp:' || sp."userId" || ':' || pc."clubShortName", sp."userId", pc."clubShortName",
    LEFT(NULLIF(TRIM(sp."profileData"->>'phone'), ''), 32),
    LEFT(NULLIF(TRIM(sp."profileData"->>'medicalNotes'), ''), 2000),
    LEFT(NULLIF(TRIM(sp."profileData"->>'allergies'), ''), 1000),
    LEFT(NULLIF(TRIM(sp."profileData"->>'generalNotes'), ''), 5000),
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StudentProfile" sp
JOIN pc ON pc."userId" = sp."userId"
WHERE sp."profileData" IS NOT NULL
  AND COALESCE(
        NULLIF(TRIM(sp."profileData"->>'phone'), ''),
        NULLIF(TRIM(sp."profileData"->>'medicalNotes'), ''),
        NULLIF(TRIM(sp."profileData"->>'allergies'), ''),
        NULLIF(TRIM(sp."profileData"->>'generalNotes'), '')
      ) IS NOT NULL
ON CONFLICT ("userId", "clubShortName") DO UPDATE SET
    "phone"        = EXCLUDED."phone",
    "medicalNotes" = EXCLUDED."medicalNotes",
    "allergies"    = EXCLUDED."allergies",
    "generalNotes" = EXCLUDED."generalNotes",
    "updatedAt"    = CURRENT_TIMESTAMP;
