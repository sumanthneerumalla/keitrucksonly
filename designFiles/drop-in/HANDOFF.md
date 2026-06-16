# Drop-In — Implementation HANDOFF / Resume

**Updated:** 2026-06-11. Read this first, then [README.md](./README.md) (decisions + phases) and [open-questions.md](./open-questions.md) (all A–G decisions). The full feature design lives in this folder; this file tracks *build progress + open threads* so any session can resume.

---

## 2026-06-11 — Post-demo cleanup (parties kept, guests cut)

The group-join feature ([group-join-feature-plan.md](./group-join-feature-plan.md), merged + demoed 2026-06-08) was cleaned up on `dev`:
- **Guest-user model removed entirely** (User.isGuest/guestCreatedBy columns dropped via `20260611000000_drop_guest_columns`; createGuest/searchGuests procedures, hasGuest/ratingEligible plumbing, and "guest" UI labels deleted). Drop-in players are logged-in club members only (G1).
- **Parties now re-queue as a unit** — "Requeue group (N)" calls `requeueParty`; the individual `rejoin` procedure was deleted. Individuals re-queue solo by leaving the party first.
- **Staff party controls wired** — club staff can `removePartyMember` / `disbandParty` on any party in their club (✕ on member pills / "Disband" on party rows).
- `ratingWeight` is now purely mode-based (TIMED → null, MATCH → 1.0).
- **TIMED rotation = server-side read-repair** (2026-06-11, later same day): `rotateExpiredSlots` (service) runs inside `getBoard`/`getPublicBoard` when a slot is past `expiresAt` — ANY polling viewer (incl. the logged-out kiosk) keeps courts rotating; the `tickTimed` procedure and all client-side tick logic were deleted. Zero-viewer rotation still needs the R3 Track C scheduler (it would just call `rotateExpiredSlots`).

---

## CURRENT STATUS (2026-06-08) — supersedes the dated "Status" section below

**Built + committed on `dev` (a 3-pass code review passed: 0 blocker, 0 high):**
- **DI-1 (casual)** — reframed: casual drop-in = a **multi-court Bookable event** (NOT the DROP_IN type). Multi-court enabled on Bookable (quick conflict-check; see [multi-court-conflict-TODO.md](./multi-court-conflict-TODO.md)). The `DROP_IN` type is reserved for rotation.
- **DI-2 (TIMED) + DI-4 (MATCH) rotation — BUILT.** Schema (`DropInAssignment`/`DropInAssignmentParticipant` + enums, migration), full `dropIn` router (board/pool/formNext/tickTimed auto-rotate/report/confirm/dispute/staffSetScore/cancel/addCourt/removeCourt/pause-resume/standings/recentResults), and the live board (`DropInEventDetails.tsx` + `dropin-ui.tsx`, branched from `EventDetailClient` on `eventType==='DROP_IN'`). "Rotation Play" is a create-event-modal option.
- **R3 hardening done:** Track A (score validation, opposing-side confirm + dispute, court-assignment race fix), Track B (cancel game, add/remove court w/ conflict-confirm, remove player, pause/resume [PAUSED migration], override confirmed score), Track D (split the board → `dropin-ui.tsx`). Plus review fixes (swap restricted to IN_PROGRESS, `externalMatchId` set on confirm, soft end-session E2).

**Intentional shortcuts still open (see open-questions + memory):** doubles auto-pairs from queue order (A12 self-formed pairs deferred); **A15 auto-start-next-on-report NOT implemented for MATCH** (court idle until staff "Start next"); **GBR sync stubbed** (gbrSyncStatus=PENDING only; DI-5); TIMED auto-rotation is **board-driven** (needs an open board; no cron); **occurrenceDate=event.start** (no recurring/daily-league); **G7 not enforced** ("joining moves you" recorded, unbuilt); **joinQueue has no registration/payment gate**; **soft-end has no auto-grace** (staff cancel stragglers). `ASSIGNED` status is reserved/unused; `DISPUTED` locks players until staff resolve (by design).

**What's left (R3 backlog):** **Track C** lifecycle (G7, headless cron rotation, window-driven sessions, recurring, join gating), **Track E** tests (skipped for now per owner), **Track F** (self-formed pairs, public spectator board G8, **DI-5 GBR stitch** + owner action items). Plus a deliberate **browser-verification** pass and the operational **push + apply migrations on deploy** (`add_dropin_assignment`, `add_dropin_session_paused`).

---

## Status

**Committed on `dev`** (NOT pushed; cron auto-deploys `dev` — see infra memory):
| Commit | What |
| :-- | :-- |
| `2962623` | **B1** — required set-once `gender` on FP profile + Create Client |
| `c576661` | **DI-1a** — `DROP_IN` event type + `DropInSession`/`DropInCheckIn` schema + 2 migrations |
| `6c672a6` | drop-in design docs (committed in parallel) |
| `3465cb5` | **DI-1b** — `dropIn` tRPC router (MANUAL session + check-in) |

**Dev DB:** migrations applied (`add_user_gender`, `add_dropin_session_checkin`, `rename_dropin_format_mixed_doubles`).

**Uncommitted that is NOT ours — DO NOT touch/commit** (parallel work in this tree): `SideNavigation.tsx`, `prisma/seeds/`, `src/app/(app)/database/console/`, `src/app/api/db-console/` (and previously `MemberMembershipsCard.tsx`, `AuthedLayout.tsx`, `NavBar.tsx`).

---

## 2026-06-06 FINAL decision (owner) — casual drop-in is JUST a multi-court Bookable event; DI-1c CANCELLED

> Supersedes the 2026-06-05 "Rotation Play / DI-1c" framing below. After working it through, the owner concluded: since casual drop-in already gets registration + payment + member self-check-in + front-desk from a normal **Bookable** event, it doesn't need a `DROP_IN` event type, a "Rotation Play" option, or DI-1c **at all**. The only thing a Bookable event couldn't do was reserve **multiple courts** — so that's the only thing we built.

- **⭐ Casual drop-in = a normal `BOOKABLE` event** (owners just title it "Drop-In"). No `DROP_IN` type, no `DropInSession`, no `dropIn` router for casual. **`DROP_IN` + `DropInSession` + the `dropIn` router (DI-1a/DI-1b, shipped & pushed) are reserved STRICTLY for the future live-rotation feature** (DI-2 TIMED / DI-4 MATCH) — that's the only thing a Bookable event genuinely can't be.
- **DI-1c is CANCELLED** (no casual-specific UI/event-type to build). The "Rotation Play" name is shelved until the rotation feature actually exists.
- **Multi-court on Bookable — BUILT 2026-06-06 (quick version, uncommitted):**
  - `EventFormModal.tsx`: BOOKABLE now uses a **single flat "Courts" multi-select** (the same picker as RENTAL_WINDOW — the old single "Resource" selector is hidden for BOOKABLE). Under the hood: first selected court → `resourceId` (single-court consumers still read it), and the **full set → `resourceIds`** only when 2+ courts (the calendar lib renders on `resourceIds` when present, so it must hold every reserved court). Single-court BOOKABLE keeps the legacy shape (`resourceId` set, `resourceIds` empty). Hydrated on edit; on update sends `resourceIds: []` for single-court so deselections clear stale extras.
  - `calendar.ts`: `updateEventSchema` accepts `resourceIds`; both conflict guards (create + update) now **loop over every court** `[resourceId, ...resourceIds]` instead of only the primary.
  - ⚠️ **KNOWN GAP (quick version):** `checkResourceConflicts` only matches *existing* events by their single `resourceId` column, so two multi-court events sharing an **extra** court won't conflict-detect. Documented in [multi-court-conflict-TODO.md](./multi-court-conflict-TODO.md). Proper fix = match `resourceId` OR `resourceIds` on both sides.
  - Verified: `npm run typecheck` clean; biome formatted (remaining diagnostics are pre-existing repo conventions — `noNonNullAssertion`/`noLabelWithoutControl`/`noDelete`). **NOT committed.**

**Decisions still standing from 2026-06-05** (unchanged by the above):
- **Payment (loop #1):** drop-in is a normal event with an optional **Product** — register/pay via the normal flow or front-desk. ✅ (now literally just "a Bookable event").
- **Check-in (loop #3):** members self-check-in to any registration they own (`checkin.selfCheckin`); front-desk too. ✅
- **occurrenceDate (loop #2):** club-local calendar day — only relevant once `DropInSession` is used (rotation). ✅
- **Admin gender display (loop #4):** SKIP. ✅
- **Gender required + onboarding gate (loop #5):** gender becomes a HARD requirement + gate participation on completed onboarding — **separate work thread** (see Open threads). ✅
- **a11y (loop #6):** FIXED 2026-06-06 (18 `noLabelWithoutControl` warnings in `profile/page.tsx` + `ClientsList.tsx`; uncommitted). ✅

---

## ~~Immediate next step: DI-1c~~ (CANCELLED 2026-06-06 — see FINAL decision above)

The text below is the superseded 2026-06-05 plan, kept for history. Casual drop-in needs **no** dedicated event type — it's a multi-court Bookable event (built above). The next real drop-in work is **DI-2 (TIMED rotation)**, the first thing that actually requires the `DROP_IN` type + `DropInSession`. Confirm scope with the owner before starting it.

---

## Phase roadmap (detail in [README.md](./README.md))

- **DI-1** Foundations — DI-1a ✅, DI-1b ✅ (schema + router, parked for rotation). **DI-1c CANCELLED** (casual = multi-court Bookable event, built 2026-06-06). Next real work = **DI-2**.
- **DI-2** TIMED rotation + public board + **audio horn** + **kiosk mode** (fullscreen+audio-unlock button, D4). Adds `DropInAssignment` (+ its enums `DropInAssignmentStatus`/`DropInSide`/`GbrSyncStatus`) — deferred from DI-1.
- **DI-3** *(deferred / future)* Algorithmic pairing modes (Americano/Mexicano/Ladder) — **vendor-copy** GBR's `src/lib/round-robin-utils.ts` into FP (F3). v1 doubles = self-formed pairs, so not needed until owner wants these.
- **DI-4** MATCH rotation (local): FIFO + self-formed pairs (A12), auto-start on report (A15), submit/confirm state machine (A3), best-2-of-3 per-game scores, FP drop-in leaderboard. GBR sync stubbed.
- **DI-5** GBR stitch: identity sync + the 3 edge functions + per-set match submission. See [gbr-integration.md](./gbr-integration.md) + [gbr-edge-functions.md](./gbr-edge-functions.md).
- **DI-6** Polish: push-notify confirm, match time limits, kiosk/QR check-in.

---

## Open threads / work items

**Build (FP):**
- DI-1c + DI-1d (above), then DI-2 → DI-4.
- **DI-2 schema add:** `DropInAssignment` + `DropInAssignmentParticipant` (join table) + enums — see [data-model.md](./data-model.md) (§5/§5b, currently documented but NOT migrated).
- **G8 public viewing** (DI-4/5): add `DROP_IN` to `calendar.getPublicEvents` filter (currently `[BOOKABLE, COACHING_SLOT]`); add a `publicProcedure` board read gated by `isPublic` (names per `showRegistrantNames`); `EventDetailClient` renders read-only public board + interactive authed; global rankings via GBR's public pages. **Reuse the public event page — NOT an iframe embed.**

**GBR-side (owner has repo access; F5 = owner maintains):**
- Create the **ShuttleMentor service account** in GBR — `matches.submitted_by` references `auth.users(id)`, so make an auth user (sign it up via GBR signup+ProfileSetup, or Dashboard Add-user); its id → the `FP_SERVICE_USER_ID` Saved Secret (F2).
- Generate `SHUTTLEMENTOR_SHARED_SECRET`, set it in GBR's Saved Secrets **and** FP backend env (HMAC auth; mirror `STRIPE_WEBHOOK_SECRET`).
- Build the 3 edge functions (`sync-player-identity`, `submit-match-result`, `get-rankings`) — skeletons in [gbr-edge-functions.md](./gbr-edge-functions.md). Verify a *new* edge function deploys on Lovable Cloud (F1) — owner will manually deploy if git push doesn't auto-pick-up.

**Separate work thread — Onboarding completeness gate (owner, 2026-06-05):**
- Make `gender` a **hard requirement** (today it's set-once on profile + Create Client, but guest-registered + legacy users have `gender = null`).
- **Gate Rotation Play participation on completed onboarding:** a user can't register for / check into / play a Rotation Play (`DROP_IN`) event until onboarding (gender + any other required fields) is complete; if incomplete, prompt them to finish first.
- Scoped as its **own thread** (self-contained, independently shippable) — NOT part of DI-1c. Spin into its own task/session when ready to build.

**Deferred / revisit:**
- **B5** consent/privacy/ToS for auto-creating GBR ghost players + public name display — owner deferred; revisit before public launch.
- A4 fairness-ordering made configurable later; A8 all matches submit (no opt-out); C3 rating-only (no position) v1.

---

## ⚠ Open loops surfaced in audit (2026-06-03)

> **STATUS 2026-06-05:** loops **#1–#6 RESOLVED** by the owner (see "2026-06-05 onboarding-session decisions" block above). #1→event Product + reuse register/checkout; #2→club-local day; #3→reuse `selfCheckin` + front-desk; #4→skip; #5→gender required + separate onboarding-gate thread; #6→agent fixing a11y labels. **#7 (DI-2 schema)** and **#8 (GBR stitch)** remain future-phase threads.

Things we touched but did NOT fully close while moving fast. Resolve as part of the phase noted.

1. **Drop-in registration + FEE are not wired (DI-1c/DI-4).** A5 = a drop-in pays like any event (optional linked product; register+pay via Stripe or front-desk). But today: (a) the existing "Register" UI + `calendar.getPublicEvents` filter are **`BOOKABLE`-only**, so a `DROP_IN` event isn't registrable/payable through the normal flow; (b) `dropIn.checkIn` only records *presence* — it doesn't charge and doesn't set `DropInCheckIn.registrationId`. **To close:** reuse the bookable registration/checkout for `DROP_IN` (add `DROP_IN` to the register-button branch + the public-list filter — overlaps G8), and **decide whether play check-in requires a paid registration** (then link `registrationId`) or whether front-desk handles payment out-of-band and check-in is presence-only.
2. **`occurrenceDate` normalization (DI-1c).** `DropInSession`'s unique key is `(eventId, occurrenceDate: DateTime)`. A RECURRING "daily league" event must compute a **consistent** occurrenceDate (date-only / facility-tz normalized) or you'll create duplicate sessions. Non-recurring = `event.start`. Pin the rule in DI-1c (the page passes occurrenceDate to `dropIn.getSession`/`startSession`).
3. **Member self-check-in vs staff-only (DI-1c).** `dropIn.checkIn` is `facilityProcedure` (front-desk, per G2). MANUAL has no member self-check-in; TIMED/MATCH (G1) add member self-join (logged in). Confirm DI-1 is staff-only and note it's a SEPARATE system from the existing Phase-6 member self-check-in (`checkin` router) — don't conflate them.
4. **Admin user-detail page doesn't show gender (B1 gap, low pri).** B1 added gender to the self-profile form + Create Client, but `clients/[userId]` (`ProfileFieldsCard`/`StudentDetailClient`) doesn't display it. Add a read-only gender display (admins edit via DB per B7).
5. **Guest-registered users get `gender = null` (known, OK).** `shop.guestRegisterForFreeEvent` doesn't collect gender; those users fill it at onboarding (consistent with the hard cutover). Just known behavior, not a bug.
6. **a11y `noLabelWithoutControl` (+2, accepted).** The new gender `<label>`s match the file's existing bare-label convention (16 pre-existing). Left as-is; do a broader a11y pass only if desired.
7. **DI-2 schema not migrated.** `DropInAssignment` + `DropInAssignmentParticipant` (+ enums `DropInAssignmentStatus`/`DropInSide`/`GbrSyncStatus`) are documented in [data-model.md](./data-model.md) §5/§5b but NOT in the schema/DB — they land with DI-2 (TIMED) / DI-4 (MATCH).
8. **Broader GBR↔FP stitch (original ask #1) — keep the thread.** The "embed GBR in FP" investigation concluded: **3 channels** — URL+postMessage for embedded views, server-to-server edge functions for identity/results, and GBR's own public pages for rankings — NOT a generic iframe. DI-5 is the first concrete stitch. Full context: memory `project_fp_gbr_stitching` + [gbr-integration.md](./gbr-integration.md).

## Gotchas (carry into every session)

- **Migrations run INSIDE the dev container:** `docker exec shuttlementor-app-dev npx prisma migrate dev --name X` (or hand-write SQL + `migrate deploy` for enum renames — `migrate dev` needs a TTY and balks at enum-value removal). DB is only reachable as `db:5432` from inside the container, **not from the host**. Run `npx prisma generate` on the **host** after a schema change, and `docker restart shuttlementor-app-dev` after migrating.
- **Bash cwd drifts mid-session** — prefix prisma/npm/git with `cd /Users/sumanth/Desktop/shuttlementorWorkspace/shuttlementor &&` or use absolute paths.
- **Don't auto-commit** — wait for the owner's explicit say-so. Stage files **by name** (the tree has constant parallel work). Commit messages reference the phase (e.g. `DI-1c`), no Co-Authored-By.
- **Biome `noLabelWithoutControl`** warnings on `profile/page.tsx` + `ClientsList.tsx` are a PRE-EXISTING file convention, not new.
- **FP auth is opt-in per page** — `(app)` is NOT globally auth-gated; event pages render for logged-out users (`userId ?? ""`). Public viewing = `isPublic` + `EventDetailClient`, not embed. *(This invariant is the root-cause fix for the bad "use embed" suggestion — see memory.)*

---

## Pointers
- Decisions: [open-questions.md](./open-questions.md) (A–G, all resolved/decided).
- Data model: [data-model.md](./data-model.md). Rotation/board/state machines: [rotation-engine.md](./rotation-engine.md). GBR: [gbr-integration.md](./gbr-integration.md) + [gbr-edge-functions.md](./gbr-edge-functions.md).
- Cross-session memory: `project_fp_dropin_features.md` + `project_fp_gbr_stitching.md` (auto-loaded).
