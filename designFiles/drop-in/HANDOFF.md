# Drop-In — Implementation HANDOFF / Resume

**Updated:** 2026-06-03. Read this first, then [README.md](./README.md) (decisions + phases) and [open-questions.md](./open-questions.md) (all A–G decisions). The full feature design lives in this folder; this file tracks *build progress + open threads* so any session can resume.

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

## Immediate next step: **DI-1c** (finishes DI-1 = MANUAL end-to-end)

Build `DropInEventDetails` and branch into it from `EventDetailClient` (`src/app/(app)/events/[eventId]/EventDetailClient.tsx`) when `event.eventType === 'DROP_IN'` (sibling to the existing `BookableEventDetails` branch). The event page already passes `userId` + `userType`.

- **Staff (facility+):** "Start drop-in session" (calls `dropIn.startSession`), end session, check a member in (`dropIn.checkIn` — needs a member picker; consider reusing `AddStudentPopover`), waitlist/cancel/mark-left (`dropIn.setCheckInStatus`).
- **Member (authed):** see the roster + their own status.
- **Logged-out (G8):** the event page renders for logged-out users (`userId===""`) — so **degrade gracefully**: do NOT call the protected `dropIn.getSession` when `userId===""`; show a read-only placeholder + "sign in to join" CTA. (Full public read lands in DI-4/5.)
- **Polling** for live updates (reuse the admin-checkin ~3s pattern; D1/G5).
- Data: `dropIn.getSession({ eventId, occurrenceDate })`. For a non-recurring DROP_IN event, `occurrenceDate` = the event's start.

Then **DI-1d**: `npm run typecheck` (host) + `npx biome check --write` the touched files. (Migration already applied; no new migration in DI-1c.)

---

## Phase roadmap (detail in [README.md](./README.md))

- **DI-1** Foundations + MANUAL — DI-1a ✅, DI-1b ✅, **DI-1c ▶ next**, DI-1d.
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

**Deferred / revisit:**
- **B5** consent/privacy/ToS for auto-creating GBR ghost players + public name display — owner deferred; revisit before public launch.
- A4 fairness-ordering made configurable later; A8 all matches submit (no opt-out); C3 rating-only (no position) v1.

---

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
