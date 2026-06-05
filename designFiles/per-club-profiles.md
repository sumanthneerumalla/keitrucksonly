# Per-Club Member Profile — Foundation Design (Models 1–3)

> Status: **COMPLETE** (2026-06-05) — `MemberClubProfile` table + migration
> `20260604222752_add_member_club_profile` (backfill lives **inside the migration SQL**, idempotent
> via deterministic ids + `ON CONFLICT`). **PR1 (DOB consolidation)**, **PR2 (per-club rebind)**,
> **PR3 cutover** (`20260605000000_drop_student_profile_data` drops the blob column), and the
> **full staff UI** (all per-club fields incl. address/emergency/referral) are done. The blob is
> gone; member data is per-club on `MemberClubProfile`, DOB global on `User`, skillLevel global on
> `StudentProfile`. Remaining future work: none required — Model 4 (waivers) and onboarding wizard
> stay out of scope. See §10.
> Scope: data-model foundation only. **No** waiver/consent/signature system and **no**
> onboarding wizard this round (both deferred — see "Out of scope").

---

## 1. Context

Each ShuttleMentor club is a separate LLC / data controller (own privacy policy, consent,
waivers, deletion scope). Today all member data is **global**:

- Identity lives on `User`.
- Club-specific + sensitive member data lives in a single global blob,
  `StudentProfile.profileData` (JSON) `= { phone, dateOfBirth, medicalNotes, allergies, generalNotes }`,
  shared across every club the member belongs to.

That shared blob is the legal-isolation risk: Club B's staff can see medical/behavior notes
Club A wrote. **Coaches are intentionally global** (one coach profile across all clubs — owner decision).

This design moves club-specific member data onto a per-`(userId, clubShortName)` record,
keeps identity and public role-profiles global, and retires the JSON blob.

---

## 2. The four data models (what each looks like + where stored)

The organizing rule: sort every field by **(a) who authors it** and **(b) is it the same human
everywhere**. That yields four homes.

### Model 1 — `User` (the person) · GLOBAL · **no change**

The immutable human. One row per person, shared across all clubs. Already complete — nothing to add.

| Field | Type | Notes |
|---|---|---|
| `userId` | String @id | |
| `firstName`, `lastName` | String? | |
| `email` | String? | |
| `profileImage` | String? | URL (global avatar) |
| `dateOfBirth` | DateTime? | Already a column (promoted out of the JSON blob for indexed age queries) |
| `gender` | Gender? (MALE/FEMALE) | Already added — set-once/immutable, required at onboarding, feeds GBR rating |
| `userType`, `clubShortName`, `activeFacilityId`, `timeZone` | — | active-context fields (unchanged) |

**Only edit:** add a back-relation `memberClubProfiles MemberClubProfile[]`.

### Model 2 — `StudentProfile` / `CoachProfile` (public role identity) · GLOBAL

The public-facing "who I am" in a role. One row per user (1:1). Stays global.

**`StudentProfile` (after)** — keeps identity/self-presentation; loses club-specific fields:

| Field | Keep? | Notes |
|---|---|---|
| `displayUsername` | ✅ keep | global URL slug |
| `bio` | ✅ keep | self-presentation (owner: both global) |
| `goals` | ✅ keep | (owner: both global) |
| `profileImage` / `profileImageType` | ✅ keep | Bytes avatar |
| `skillLevel` | ✅ **keep** (unchanged) | Stays **global + member-editable**, exactly as today. Scope cut (2026-06-04): not worth the app-logic churn to make it per-club; a skill rating isn't sensitive isolation data. |
| `profileData` (JSON) | ❌ **remove** | → exploded into typed columns on `MemberClubProfile` |

**`CoachProfile`** — **no change.** Stays fully global: `displayUsername`, `bio`, `experience`,
`specialties[]`, `teachingStyles[]`, `headerImage`, `profileImage`, `rate`, `isActive`, `isVerified`.

### Model 3 — `MemberClubProfile` (NEW) · PER `(userId, clubShortName)`

Everything a club specifically collects/knows about a member. **This is the legal-isolation
boundary.** One row per member per club. Empty until that club fills it in.

| Group | Fields |
|---|---|
| Contact (per-club — clubs collect/own independently, CourtReserve pattern) | `phone`, `streetAddress`, `city`, `state`, `zipCode`, `emergencyContactName`, `emergencyContactPhone`, `emergencyContactRelationship` |
| Marketing attribution (set at join) | `referralSource`, `howHeard` |
| Operational / sensitive (staff-authored) | `medicalNotes`, `allergies`, `generalNotes` |

`skillLevel` is **not** here — it stays global + member-editable on `StudentProfile` (scope cut).
Membership tier is **not** copied here either — it already lives per-club in Phase-10a
`MemberMembership` and is fetched by query when needed.

**Grain is club, not facility.** `UserClub` is per-`(userId, facilityId)` and only stores a
role; the legal/consent boundary is the **club** (the LLC). A club with multiple facilities
gets one `MemberClubProfile` per member, not one per facility.

### Model 4 — Consent / Waiver records · **OUT OF SCOPE (future)**

Signed legal artifacts per `(user, club, document)` — signature capture, timestamps, document
versioning. Documented here only so Model 3 isn't mistaken for the legal-signing home. Not built this round.

---

## 3. JSON vs typed columns — decision

**Drop the JSON blob. Use typed columns on `MemberClubProfile`.**

- The old `StudentProfile.profileData` JSON (TD-1) was always flagged "promote to typed columns
  later" — this is that moment.
- Every field is a discrete, staff-edited value; several are queried directly (`phone` on invoices,
  age via DOB). Typed columns remove the parse helpers (`phoneFromProfileData`,
  `StudentProfileData` in `src/lib/studentProfile.ts`) and give DB-level types/length limits.
- `dateOfBirth` is **not** recreated here — it stays the single source of truth on `User`. The
  stale JSON copy is dropped during backfill (see DOB fix-now below).
- **Caps match the app's existing validation** (`studentProfileDataSchema`, `user.ts:194-202`:
  phone 40→tightened to 32, medical 2000, allergies 1000, general 5000). Notes are **capped
  VarChar, not `@db.Text`** — `Text` would be a regression vs today's caps and inconsistent with
  the `CoachProfile.bio`/`experience` precedent. In Postgres `varchar(n)` is a constraint only
  (no storage cost), so caps exist purely to bound input.

---

## 4. New table (Prisma)

```prisma
model MemberClubProfile {
  memberClubProfileId String   @id @default(cuid())
  userId              String
  user                User     @relation(fields: [userId], references: [userId], onDelete: Cascade)
  clubShortName       String
  club                Club     @relation(fields: [clubShortName], references: [clubShortName], onDelete: Cascade)

  // Contact (per-club; staff- or member-editable)
  phone                        String? @db.VarChar(32)
  streetAddress                String? @db.VarChar(200)
  city                         String? @db.VarChar(100)
  state                        String? @db.VarChar(50)
  zipCode                      String? @db.VarChar(20)
  emergencyContactName         String? @db.VarChar(120)
  emergencyContactPhone        String? @db.VarChar(32)
  emergencyContactRelationship String? @db.VarChar(50)

  // Marketing attribution (set at join)
  referralSource      String?  @db.VarChar(120)
  howHeard            String?  @db.VarChar(120)

  // Operational / sensitive (staff-authored; legal-isolation boundary)
  // NOTE: skillLevel intentionally NOT here — stays global + member-editable on StudentProfile.
  medicalNotes        String?  @db.VarChar(2000)
  allergies           String?  @db.VarChar(1000)
  generalNotes        String?  @db.VarChar(5000)

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([userId, clubShortName])
  @@index([userId])
  @@index([clubShortName])
}
```

Back-relations to add: `User.memberClubProfiles MemberClubProfile[]`,
`Club.memberClubProfiles MemberClubProfile[]`.

---

## 4b. DOB de-duplication — **FIX NOW** (decoupled from this migration)

DOB lives in two places today and they **already diverge** — this is a live bug, not hypothetical:

- `User.dateOfBirth` (indexed column, `schema.prisma:155`) is what the email age-filter **prefers**
  (`emailGroups.ts:38-40`), but it has **no in-app writer except onboarding**.
- The clients-page card writes only the **blob copy** (`ProfileFieldsCard.tsx:81` →
  `updateStudentProfileData`). So any staff DOB edit after onboarding lands in the blob, and the
  age-filter (reading the column first) shows a stale/empty age. Displayed age ≠ filter age.

**Fix this now**, ahead of and independent of the `MemberClubProfile` work — ~15 lines, no schema
change (the column exists), no migration, reversible:

1. `updateStudentProfileData` (`user.ts`): when the blob carries `dateOfBirth`, **dual-write**
   `User.dateOfBirth` (parse `YYYY-MM-DD` → DateTime at **UTC-midnight** to avoid TZ off-by-one)
   while still writing the blob copy, so un-rebound readers stay valid.
2. Point `ProfileFieldsCard` age display + `getStudentDetail` at `User.dateOfBirth`.
3. Remove `dateOfBirth` from the Zod `studentProfileDataSchema` (`user.ts:192-204`) **and** from
   `type StudentProfileData` — note **two types share that name** (`src/lib/studentProfile.ts:9`
   and the `z.infer` at `user.ts:206`) plus a client-local `ProfileData` in `ProfileFieldsCard`;
   all three carry `dateOfBirth`. Edit all three together.

Deferred to this migration (blob deletion only): `emailGroups.getDateOfBirth` drops its blob
fallback + `profileData` include once the column is fully populated; backfill drops the blob's
`dateOfBirth`. **DOB never enters `MemberClubProfile`** — it stays GLOBAL on `User`.

---

## 5. Migration + backfill

1. **SQL migration:** create `MemberClubProfile`. (No `User.gender` add — already exists.)
2. **Backfill lives INSIDE the migration SQL** (`prisma/migrations/20260604222752_add_member_club_profile/migration.sql`)
   — not a separate script — so it runs automatically with `migrate deploy` in dev/prod, no manual
   container step. Two `INSERT … ON CONFLICT` statements, idempotent via deterministic ids
   (`'mcp:' || userId || ':' || clubShortName`; cuids contain no `:`, so collision-free) and no
   dependency on `gen_random_uuid()`/pgcrypto or any Postgres version:
   - **Step 1 — placeholders:** one empty row per `DISTINCT (userId, clubShortName)` from `UserClub`
     (`DISTINCT` collapses multi-facility duplicates; iterating `UserClub` means members with no
     `StudentProfile` still get rows). `ON CONFLICT DO NOTHING`.
   - **Step 2 — blob copy:** copy `phone`/`medicalNotes`/`allergies`/`generalNotes` from the legacy
     `StudentProfile.profileData` (jsonb `->>`) into the member's **primary** club row.
     `skillLevel` is **not** copied (stays on `StudentProfile`); the JSON `dateOfBirth` is
     **dropped** (lives on `User.dateOfBirth`). `LEFT(NULLIF(TRIM(…),''), cap)` trims, nulls blanks,
     and clamps to the column cap (so a stale 40-char phone can't fail the 32-char column). Only
     rows with at least one non-empty value are touched. Primary club = `User.clubShortName` when
     it's a real membership, else the lexicographically-first membership, else the active club
     (orphan). `ON CONFLICT DO UPDATE` fills the existing placeholder (or inserts for drift/orphan).
   - **Verified functionally on dev** (2026-06-04): planted a blob with a 40-char phone + DOB →
     phone clamped to 32, notes copied, generalNotes trimmed, DOB dropped, address null, routed to
     the right club. Fresh re-apply produced 104 deterministic-id rows; `migrate status` clean.
3. **Cutover cleanup (~2 weeks after stable):** drop `StudentProfile.profileData` only.
   `StudentProfile.skillLevel` is **kept** (stays global + member-editable).

---

## 6. Read/write-site audit

**Missing-row contract (REQUIRED):** every **reader** must treat a missing/NULL `MemberClubProfile`
as all-fields-null and never throw; **only writers create rows** (lazy via `upsert`). With no
onboarding wizard, the first staff edit is what mints a member's row — every read before that must cope.

- `src/server/api/routers/user.ts`
  - `updateStudentProfileData` (facility) → upsert `MemberClubProfile` for `(userId, ctx.user.clubShortName)`.
  - `getStudentDetail` (facility) → join `MemberClubProfile` for that club; return an **empty-shaped
    object when the row is null** (today returns `profileData ?? {}` — preserve that shape).
  - `updateStudentProfile` (self) → **no change** (still writes `skillLevel`/`bio`/`goals`/`displayUsername` globally).
  - `getOrCreateProfile` → load `MemberClubProfile` for the active club alongside globals; missing row = all-null.
- **`skillLevel` — NO CHANGE (scope cut 2026-06-04).** Stays global + member-editable on
  `StudentProfile`. All current sites are left alone: the self-serve writes in `updateStudentProfile`
  (`user.ts:698,715`), the auto-defaults (`:390,:424,:617,:640`), `formatUserForFrontend`
  (`utils.ts:341,386`), `getStudentDetail` (`:2118,:2155`), and the self-serve UI
  (`StudentProfile.tsx`). This removes the biggest chunk of churn — the migration touches only the
  blob fields, not skillLevel.
- `src/server/api/routers/emailGroups.ts` → age filter reads `User.dateOfBirth` (was `profileData.dateOfBirth`). Net simplification.
- `src/server/api/routers/billing.ts` + `src/server/services/invoiceRenderer/assemble.ts` → phone from `MemberClubProfile.phone` for the invoice's club (was `profileData.phone`); **return null when no row exists** (today `phoneFromProfileData(undefined)` is null-safe — preserve).
- `src/lib/studentProfile.ts` → retire `phoneFromProfileData` / `StudentProfileData` once the blob is gone.
- **UI — `MemberClubProfile` adds 8 fields never collected today** (streetAddress, city, state,
  zipCode, emergencyContactName/Phone/Relationship, referralSource, howHeard). **DECISION: columns
  now, UI later** — create the columns + migrate in this build, but **defer the new form inputs**
  for those 8 fields to a later pass. First build only rebinds the existing fields
  (phone/medical/allergies/generalNotes) onto `MemberClubProfile`; `ProfileFieldsCard.tsx`,
  `StudentDetailClient.tsx`, `InvoiceDetail.tsx` = rebind only this round.
- `src/server/api/routers/coaches.ts` → **no change**.

---

## 7. Out of scope (explicit)

- **Model 4** — waivers / consent / signature capture / document versioning. Future phase.
  (NB: the `gender` "required at onboarding (B1)" comment implies a parallel onboarding spec —
  when that lands it should write into `MemberClubProfile`.)
- Multi-step onboarding wizard.
- Consolidating the three `profileImage` locations (`User` URL, `StudentProfile` Bytes,
  `CoachProfile` Bytes) — tracked as tech-debt, not this change.

---

## 8. Verification

- `npx prisma generate && npm run typecheck`.
- Backfill on a DB copy: `MemberClubProfile` primary-club rows == students with non-null
  `profileData`; empty placeholders == distinct extra `(user, club)` pairs; spot-check 5 records.
- Manual: staff edits a member's profile in Club A → confirm invisible in Club B; invoice phone
  and email-group age filter still resolve.

---

## 9. Collision check

Independent of Phase 9a invoicing / 10a memberships / 12a Stripe — none touch
`StudentProfile`/`CoachProfile`. Only shared reads are invoice phone + email age filter, both
handled above. Safe to build post-stabilization.

---

## 10. Owner decisions (locked) + build sequence

**Decisions (2026-06-04):**
- **`skillLevel`:** **NO CHANGE** — stays global + member-editable on `StudentProfile`. Scope cut to
  avoid app-logic churn; a skill rating isn't sensitive isolation data (§2, §6).
- **New 8 fields:** **columns now, UI later** — migrate the columns, defer the form inputs (§6).
- **DOB:** **fix now as a standalone PR** ahead of the migration (§4b).

**Build sequence:**
1. ✅ **DOB fix (DONE — commit d00f4e1):** DOB written to `User.dateOfBirth` from
   `updateStudentProfileData`; card + `getStudentDetail` + email age-filter read the column. No migration.
2. ✅ **Per-club migration + rebind (DONE — migration `20260604222752`; rebind this commit):**
   `MemberClubProfile` created, backfill in-migration (§5). `updateStudentProfileData` upserts the
   per-club row; `getStudentDetail` returns top-level `profileData` from it (missing row → all-null);
   invoice phone (`billing.ts`, `assemble.ts`) reads `MemberClubProfile.phone` for the invoice's club.
   `phoneFromProfileData`/`src/lib/studentProfile.ts` retired. `skillLevel` untouched.
3. ✅ **PR3 cutover (DONE — migration `20260605000000_drop_student_profile_data`):** dropped the
   now-unused `StudentProfile.profileData` column. `StudentProfile.skillLevel` kept.
4. ✅ **Staff UI (DONE):** `ProfileFieldsCard` now edits all per-club fields, grouped into Contact /
   Address / Emergency contact / How they heard / Notes sections. Server schema, `updateStudentProfileData`,
   and `getStudentDetail` carry all fields.

**Carry-over to verify at build time:** every reader tolerates a NULL `MemberClubProfile`
(all-fields-null, no throw); backfill iterates `UserClub`, excludes primary from the placeholder
loop, anchors primary on a real membership (§5, §6).
