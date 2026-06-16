-- ============================================================
-- Reset a TEST user to a FRESH / NOT-ONBOARDED state so you can replay the
-- onboarding flow:  gate -> /join (pick club) -> facility -> /profile -> app.
--
-- Usage: edit the email on the first query, then run the whole file
--        (psql, or the in-app /database/console). Re-runnable / idempotent.
--
-- WARNING: resets userType to STUDENT. Use a NON-admin test account only
--          (platform admins are exempt from the /join gate anyway).
-- ============================================================

DROP TABLE IF EXISTS _reset_target;
CREATE TEMP TABLE _reset_target AS
	SELECT "userId" FROM "User"
	WHERE lower(COALESCE("email", '')) = lower('sumanth.neerumalla@gmail.com');  -- <<< EDIT EMAIL

-- Sanity: expect exactly 1 row before trusting the rest.
SELECT count(*) AS matched FROM _reset_target;

-- (1) Drop club/facility memberships -> 0 UserClub rows -> the gate sends them to /join.
DELETE FROM "UserClub" WHERE "userId" IN (SELECT "userId" FROM _reset_target);

-- (2) Reset live "active context" + clear profile fields (name + gender) so the
--     /profile step replays. Email is intentionally KEPT: it stays as the
--     onboarding pre-fill AND keeps this script re-findable by email next time.
UPDATE "User"
SET "clubShortName"    = 'shuttlementor',
    "activeFacilityId" = NULL,
    "userType"         = 'STUDENT',
    "firstName"        = NULL,
    "lastName"         = NULL,
    "gender"           = NULL
WHERE "userId" IN (SELECT "userId" FROM _reset_target);

-- (3) Verify (by userId, since email is now null): memberships should be 0.
SELECT u."userId", u."clubShortName", u."activeFacilityId", u."userType",
       (SELECT COUNT(*) FROM "UserClub" uc WHERE uc."userId" = u."userId") AS memberships
FROM "User" u WHERE u."userId" IN (SELECT "userId" FROM _reset_target);

DROP TABLE IF EXISTS _reset_target;
