-- seed-demo-club.sql — populate a NEW club with demo data via the SQL console.
--
-- No SSH / node needed: paste this into /database/console (PLATFORM_ADMIN only),
-- WRITE mode → Preview (runs in a rolled-back transaction so you see counts first)
-- → Commit. The console wraps the whole file in ONE transaction, so do NOT add
-- BEGIN/COMMIT here (that would break the preview/rollback).
--
-- Prereq: create the club + first admin via "Create Client → new club" (that also
-- makes the first facility). Then set the club shortName in the SET line below.
--
-- Creates: a 2nd facility, ~42 users (30 students + 12 coaches, with gender + DOB),
-- StudentProfile DOB blobs, coach profiles, 3-4 random tags per user, 3 memberships,
-- a product category + 3 products, and 3 packages. Idempotent-ish (NOT EXISTS
-- guards). Scale the user count via the generate_series(0,N) bounds.

-- ============ set the club once: ============
SET LOCAL myapp.club = 'NEW_CLUB_SHORTNAME';

-- 1) Second facility (the button made the first)
INSERT INTO "ClubFacility" ("facilityId","clubShortName","name","position","updatedAt")
SELECT gen_random_uuid()::text, current_setting('myapp.club'), 'Annex Courts', 1, now()
WHERE NOT EXISTS (SELECT 1 FROM "ClubFacility" WHERE "clubShortName"=current_setting('myapp.club') AND name='Annex Courts')
RETURNING "name";

-- 2) 30 students (names from the seed) — gender alternates, DOB spread (~ages 10-18), split across facilities
WITH facs AS (
  SELECT (SELECT "facilityId" FROM "ClubFacility" WHERE "clubShortName"=current_setting('myapp.club') ORDER BY "position","createdAt" LIMIT 1) f1,
         (SELECT "facilityId" FROM "ClubFacility" WHERE "clubShortName"=current_setting('myapp.club') AND name='Annex Courts') f2 ),
s(i,first,last) AS (
  SELECT i,
    (ARRAY['Ari','Blake','Cal','Dana','Eli','Fern','Gio','Hope','Ian','Joy','Kit','Lea','Milo','Nell','Owen','Pia','Quinn','Reed','Sky','Tess','Uri','Val','Wes','Xena','Yael','Zara','Ash','Bria','Clay','Drew'])[i+1],
    (ARRAY['Frost','Grant','Heath','Irwin','Joyce','Klein','Lowe','Marsh','Noble','Ortiz','Price','Quinn','Reese','Stone','Tyler','Upton','Vance','Walsh','Young','Zane','Bloom','Craig','Dunn','Ellis','Ford','Glenn','Hyde','Kane','Lloyd','Miles'])[i+1]
  FROM generate_series(0,29) i )
INSERT INTO "User" ("userId","clerkUserId","email","firstName","lastName","userType","gender","dateOfBirth","clubShortName","activeFacilityId","updatedAt")
SELECT gen_random_uuid()::text, 'seedclient_'||current_setting('myapp.club')||'_s'||s.i,
       lower(s.first)||s.i||'@'||current_setting('myapp.club')||'.test',
       s.first, s.last, 'STUDENT'::"UserType",
       (CASE WHEN s.i%2=0 THEN 'FEMALE' ELSE 'MALE' END)::"Gender",
       (DATE '2008-01-01' + ((s.i*211)%3000)), current_setting('myapp.club'),
       CASE WHEN s.i%2=0 THEN f.f1 ELSE f.f2 END, now()
FROM s CROSS JOIN facs f
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."clerkUserId"='seedclient_'||current_setting('myapp.club')||'_s'||s.i)
RETURNING "firstName","lastName","gender","dateOfBirth";

-- 3) 12 coaches (adult DOBs)
WITH facs AS (
  SELECT (SELECT "facilityId" FROM "ClubFacility" WHERE "clubShortName"=current_setting('myapp.club') ORDER BY "position","createdAt" LIMIT 1) f1,
         (SELECT "facilityId" FROM "ClubFacility" WHERE "clubShortName"=current_setting('myapp.club') AND name='Annex Courts') f2 ),
c(i,first,last) AS (
  SELECT i,
    (ARRAY['Ryan','Nina','Max','Priya','Leo','Sara','Tom','Jade','Kai','Luna','Omar','Isla'])[i+1],
    (ARRAY['Lee','Pham','Roy','Das','Xu','Soto','Gill','Ito','Cole','Diaz','Fong','Hart'])[i+1]
  FROM generate_series(0,11) i )
INSERT INTO "User" ("userId","clerkUserId","email","firstName","lastName","userType","gender","dateOfBirth","clubShortName","activeFacilityId","updatedAt")
SELECT gen_random_uuid()::text, 'seedclient_'||current_setting('myapp.club')||'_c'||c.i,
       lower(c.first)||'c'||c.i||'@'||current_setting('myapp.club')||'.test',
       c.first, c.last, 'COACH'::"UserType",
       (CASE WHEN c.i%2=0 THEN 'MALE' ELSE 'FEMALE' END)::"Gender",
       (DATE '1980-01-01' + ((c.i*389)%6000)), current_setting('myapp.club'),
       CASE WHEN c.i%2=0 THEN f.f1 ELSE f.f2 END, now()
FROM c CROSS JOIN facs f
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."clerkUserId"='seedclient_'||current_setting('myapp.club')||'_c'||c.i)
RETURNING "firstName","lastName","gender";

-- 4) StudentProfile blob (the DOB the profile card reads)
INSERT INTO "StudentProfile" ("studentProfileId","userId","profileData","updatedAt")
SELECT gen_random_uuid()::text, u."userId", jsonb_build_object('dateOfBirth', to_char(u."dateOfBirth",'YYYY-MM-DD')), now()
FROM "User" u
WHERE u."clubShortName"=current_setting('myapp.club') AND u."userType"='STUDENT' AND u."clerkUserId" LIKE 'seedclient%'
  AND NOT EXISTS (SELECT 1 FROM "StudentProfile" sp WHERE sp."userId"=u."userId")
RETURNING "userId";

-- 5) CoachProfile (shows on /coaches)
INSERT INTO "CoachProfile" ("coachProfileId","userId","displayUsername","bio","specialties","teachingStyles","rate","updatedAt")
SELECT gen_random_uuid()::text, u."userId",
       'coach_'||lower(u."firstName")||'_'||substr(md5(u."userId"),1,8),
       'Experienced badminton coach', ARRAY['Footwork','Tactics']::text[], ARRAY['Patient','Analytical']::text[],
       25 + (abs(hashtext(u."userId"))%55), now()
FROM "User" u
WHERE u."clubShortName"=current_setting('myapp.club') AND u."userType"='COACH' AND u."clerkUserId" LIKE 'seedclient%'
  AND NOT EXISTS (SELECT 1 FROM "CoachProfile" cp WHERE cp."userId"=u."userId")
RETURNING "userId","displayUsername","rate";

-- 6) UserClub rows
INSERT INTO "UserClub" ("id","userId","clubShortName","facilityId","role")
SELECT gen_random_uuid()::text, u."userId", current_setting('myapp.club'), u."activeFacilityId", u."userType"
FROM "User" u
WHERE u."clubShortName"=current_setting('myapp.club') AND u."clerkUserId" LIKE 'seedclient%' AND u."activeFacilityId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "UserClub" uc WHERE uc."userId"=u."userId" AND uc."facilityId"=u."activeFacilityId")
RETURNING "userId","role";

-- 7) Tags (8, from the seed)
INSERT INTO "Tag" ("tagId","clubShortName","name","bgColor","textColor","updatedAt")
SELECT gen_random_uuid()::text, current_setting('myapp.club'), t.name, t.bg, t.tc, now()
FROM (VALUES ('beginner','#dbeafe','#1e40af'),('intermediate','#dcfce7','#166534'),('advanced','#f3e8ff','#6b21a8'),
             ('junior','#fef9c3','#854d0e'),('tournament player','#fee2e2','#991b1b'),('drop-in regular','#ccfbf1','#134e4a'),
             ('membership active','#d1fae5','#065f46'),('vip','#fce7f3','#9d174d')) AS t(name,bg,tc)
WHERE NOT EXISTS (SELECT 1 FROM "Tag" tg WHERE tg."clubShortName"=current_setting('myapp.club') AND tg.name=t.name)
RETURNING "name";

-- 8) Assign 3-4 RANDOM tags per seeded user
INSERT INTO "UserTag" ("id","userId","tagId")
SELECT gen_random_uuid()::text, r."userId", r."tagId"
FROM (
  SELECT u."userId", t."tagId",
         row_number() OVER (PARTITION BY u."userId" ORDER BY random()) rn,
         3 + (abs(hashtext(u."userId"))%2) keep
  FROM "User" u CROSS JOIN "Tag" t
  WHERE u."clubShortName"=current_setting('myapp.club') AND u."clerkUserId" LIKE 'seedclient%'
    AND t."clubShortName"=current_setting('myapp.club')
) r
WHERE r.rn <= r.keep
  AND NOT EXISTS (SELECT 1 FROM "UserTag" ut WHERE ut."userId"=r."userId" AND ut."tagId"=r."tagId")
RETURNING "userId","tagId";

-- 9) Membership types + plans
INSERT INTO "MembershipType" ("membershipTypeId","clubShortName","name","sortOrder","updatedAt")
SELECT gen_random_uuid()::text, current_setting('myapp.club'), t.name, t.ord, now()
FROM (VALUES ('Adult Monthly',10),('Junior Monthly',20),('Annual',30)) t(name,ord)
WHERE NOT EXISTS (SELECT 1 FROM "MembershipType" mt WHERE mt."clubShortName"=current_setting('myapp.club') AND mt.name=t.name)
RETURNING "name";

INSERT INTO "MembershipPlan" ("membershipPlanId","clubShortName","membershipTypeId","description","billingFrequency","billingInterval","billingUnit","feePerTermInCents","updatedAt")
SELECT gen_random_uuid()::text, current_setting('myapp.club'),
       (SELECT "membershipTypeId" FROM "MembershipType" WHERE "clubShortName"=current_setting('myapp.club') AND name=pl.tname LIMIT 1),
       pl.descr, pl.freq, pl.intv, pl.unit, pl.fee, now()
FROM (VALUES ('Adult Monthly','$75/month, unlimited court access','monthly',1,'month',7500),
             ('Junior Monthly','$55/month, juniors under 18','monthly',1,'month',5500),
             ('Annual','$720/year, unlimited (best value)','annually',1,'year',72000)) pl(tname,descr,freq,intv,unit,fee)
WHERE NOT EXISTS (SELECT 1 FROM "MembershipPlan" mp WHERE mp."clubShortName"=current_setting('myapp.club') AND mp.description=pl.descr)
RETURNING "description","feePerTermInCents";

-- 10) Product category + products (createdBy = the club's first user = the admin)
INSERT INTO "ProductCategory" ("categoryId","clubShortName","name","sortOrder","updatedAt")
SELECT gen_random_uuid()::text, current_setting('myapp.club'), 'Pro Shop', 10, now()
WHERE NOT EXISTS (SELECT 1 FROM "ProductCategory" WHERE "clubShortName"=current_setting('myapp.club') AND name='Pro Shop')
RETURNING "name";

INSERT INTO "Product" ("productId","clubShortName","categoryId","name","priceInCents","createdByUserId","updatedAt")
SELECT gen_random_uuid()::text, current_setting('myapp.club'),
       (SELECT "categoryId" FROM "ProductCategory" WHERE "clubShortName"=current_setting('myapp.club') AND name='Pro Shop' LIMIT 1),
       pr.name, pr.price,
       (SELECT "userId" FROM "User" WHERE "clubShortName"=current_setting('myapp.club') ORDER BY "createdAt" LIMIT 1), now()
FROM (VALUES ('Yonex Shuttlecocks (tube)',3000),('Overgrip 3-pack',800),('Club T-Shirt',2500)) pr(name,price)
WHERE NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."clubShortName"=current_setting('myapp.club') AND p.name=pr.name)
RETURNING "name","priceInCents";

-- 11) Packages (general drop-in)
INSERT INTO "PackagePlan" ("packagePlanId","clubShortName","isGeneralDropIn","name","sessionCount","priceInCents","sortOrder","updatedAt")
SELECT gen_random_uuid()::text, current_setting('myapp.club'), true, pk.name, pk.sessions, pk.price, pk.ord, now()
FROM (VALUES ('Day Pass',1,2000,10),('10-Session Pass',10,15000,20),('20-Session Pass',20,26000,30)) pk(name,sessions,price,ord)
WHERE NOT EXISTS (SELECT 1 FROM "PackagePlan" pp WHERE pp."clubShortName"=current_setting('myapp.club') AND pp.name=pk.name)
RETURNING "name","sessionCount","priceInCents";
