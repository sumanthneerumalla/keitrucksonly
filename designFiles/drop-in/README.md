# Drop-In Sessions — Master Design Document

This is the entry point for the **drop-in** feature design. It captures the concept, decisions, the FP↔GBR division of labor, and links to the sub-documents. This feature also **initiates the stitching of ShuttleMentor (FP / "facility presence") and Global Badminton Ranking (GBR)** — see [gbr-integration.md](./gbr-integration.md).

**Status:** Design (2026-06-02). Investigated against both codebases; not yet implemented.
**Dependencies:** Calendar/events (`CalendarEvent`, `ClubResource`, `resourceIds`), check-in (Phase 6/7), credits/packages (Phase 8a), GBR Supabase backend.
**Priority:** High — addresses a live club-owner pain point (peak-hour court squatting).

---

## Overview

During peak hours a club fills with walk-in/drop-in players. The owner won't turn them away, so today players take a court in 20-30 min increments — but they **overstay**, courts don't rotate, and play time is unfair. We need a **managed, fair, self-service court-assignment system** that players prefer over squatting.

A **Drop-In Session** reserves a set of designated courts for a time window and runs one of three modes:

| Mode | What it does | GBR involvement |
| :--- | :--- | :--- |
| **TIMED** | Named groups hold a court for N minutes; a countdown + **audio horn** ends the slot; the next group rotates on from the waiting pool. Pure play-time fairness. | None |
| **MATCH** | Matchups are assigned to courts (FIFO / skill-based / rotating doubles). Players submit + confirm scores; confirmed results post to GBR as **self-reported (1.0×)** matches and nudge global TrueSkill ratings. | Identity + rating |
| **MANUAL** | Register / check-in / cancel / waitlist only. **No digital match records.** For clubs that self-police their drop-in rules. | None |

The squatting problem is solved structurally: **designated drop-in courts are only reachable through the queue**, and a **public board + horn** make fairness visible. The competitive draw (global rankings via GBR) makes managed play *more* attractive than squatting.

> **Naming note:** "daily league" = a recurring (RRULE) drop-in event running each day at peak hours. The recurring series is the template; each day's occurrence is a **session** with its own live state.

---

## Division of Labor (FP / Shared module / GBR)

| Concern | Owner | Notes |
| :--- | :--- | :--- |
| Court reservation (multi-court hold) | **FP** | Reuses `CalendarEvent.resourceIds` + `isBlocking` + conflict checks |
| Check-in, player pool, waitlist/queue | **FP** | New live-ops layer (GBR has no pool/queue concept) |
| Court assignment + rotation orchestration | **FP** | GBR's tournament model is round-locked — a poor fit for continuous rotation |
| Pairing algorithms (round-robin, rotating doubles, skill ladder, standings) | **Shared package** | **Extracted** from GBR's pure `src/lib/round-robin-utils.ts` (+ `draw-schedule.ts`); imported by FP. Zero Supabase/React deps. |
| Score submit/confirm, drop-in leaderboard | **FP** | Per-session/club standings live on FP |
| Player identity & rating (TrueSkill) | **GBR** | System of record; FP auto-links members and submits self-reported matches |
| Global ranking display | **GBR (read)** | FP reads/embeds global rank; never recomputes ELO/TrueSkill |

This split is the result of three code investigations (2026-06-02): FP already supports multi-court events; GBR's schema was built for external identity + match import; GBR's pairing logic is cleanly extractable but its tournament court-assignment machinery is not a fit.

---

## Design Decisions

| Decision | Choice | Rationale |
| :--- | :--- | :--- |
| Event modeling | **New `DROP_IN` `EventType`** (sibling of `BOOKABLE`), reusing CalendarEvent scaffolding | Distinct live lifecycle (check-in/queue/rotation/matches); still reuses `resourceIds`, recurrence, `maxParticipants`, `creditCost`. *(Open: subtype-flag on BOOKABLE is the alternative — see Open Decisions.)* |
| Modes | `TIMED` / `MATCH` / `MANUAL` via `dropInMode` | Covers time-based rotation, skill/round-robin play, and self-policed clubs |
| Session granularity | One `DropInSession` per event **occurrence** (day) | Recurring series = template; each day = live session. Materialized when staff start (or first check-in). |
| Player pool / queue | Derived from `DropInCheckIn` rows (`status = WAITING`), fairness-ordered | No separate queue table; order by `gamesPlayed ↑, lastPlayedAt ↑, queuedAt ↑` |
| Match participants | **Join table** (`DropInAssignmentParticipant`), not `String[]` arrays | Per-player standings, match history, win attribution, and fairness counters need FK rows + `GROUP BY` |
| TIMED vs MATCH storage | **One consolidated `DropInAssignment`** table for both modes | Shared lifecycle (court occupied by players for a slot); mode-specific fields nullable |
| Court rotation | **FP-native** (pool → assign on court-free) | GBR has no continuous queue; round-locked model is a poor fit |
| Matchmaking algorithms | **Extract GBR's pure modules** into a shared workspace package | `round-robin-utils.ts` etc. are zero-dep pure functions; avoids reimplementing rotating-doubles ladder |
| Rating / scoring | **GBR (TrueSkill)**; drop-in = **self-reported 1.0×** weight | Offload ELO; casual play moves ratings lightly (vs league 1.5× / tournament 2.0×) |
| Match → GBR | **Standalone matches**, *not* GBR leagues/seasons | Keep session/series grouping + drop-in leaderboard on FP; GBR only nudges global rating |
| Identity link | `external_player_identities(source='facilitypresence', external_id=<FP memberId>)` + `gbrPlayerId` cached on FP; **email = dedup heuristic only** | Stable key (emails change); coexists with `tournament_software` source; bidirectional lookups |
| Provisioning | **Lazy** — create GBR ghost player on first check-in/registration | Less churn; player later claims via existing `claim-ghost-account` |
| Submit / confirm | First submit **frees the court + gates rejoining the queue**; opponent confirm → **then** push to GBR; staff can set/cancel | Keeps courts moving while staying "self-reported confirmed"; courts never get stuck |
| GBR dependency | **No local rating fallback**; idempotent submit (`external_match_id`) + retry queue; rotation runs independent of GBR | Simpler; play never blocks on GBR uptime — only rating updates are delayed |
| Board | **FP-native** on the event page (`/events/[id]`); embed GBR only for **global rank** | Per GBR maintainer, `/live/:sessionId` isn't relevant here; FP renders per-user real-time status + interactions |
| Singles & doubles | Support both; **default doubles** | Throughput during peak hours; GBR `teams.team_type` supports both natively |
| Doubles pairing (v1) | **Self-formed editable pairs**; Americano/Mexicano/Ladder are **future** modes | A12 |
| Session lifecycle | **Time-driven** — active during the event window, lazy materialize, soft end (stop new matchups, let in-progress finish & report) | E2 |
| Staff overrides | Full set (cancel/score/dispute/rotate/remove/courts/pause/end), role **Facility+** | E1 |
| Score reporting surface | Both players on their phones (one reports → other confirms) **and** staff | Self-service; minimizes staff load |
| Drop-in fee | The event's own cost — drop-in behaves like a normal event (optional linked product; register+pay via Stripe or manual front-desk) | A5 — reuses existing event product/registration/payment; no new billing |
| Match format | Single game to 21, **best 2-of-3** (configurable later) | A11 |
| Match auto-start | Next matchup **auto-forms & starts** when a court frees (no dwell in `ASSIGNED`) | A15 |
| GBR submission | **All** MATCH results submit to GBR (1.0×) with **per-set scores** (GBR rating uses margin-of-victory); no opt-out in v1 | A8 / A14 |
| Drop-in status | A dedicated status, **fully separate** from `EventRegistration`/`Attendance` | A3 — register/pay is orthogonal to in-session play state |
| Board & kiosk | The board **is** the event page; a "kiosk mode" button = fullscreen + audio-unlock (no separate app) | D2/D4 |
| Profile gender | `gender` becomes a **required** FP profile field (onboarding), passed to GBR | B1 — GBR requires it on a player |
| Account by mode | **TIMED & MATCH require FP login**; **MANUAL** = front-desk check-in only (no login) | G1 |
| Live updates | **Polling** of the event page for assignments + standings; "your turn/report/confirm" are polled board states (no sockets/push v1) | G5 |
| TIMED rotation | Staff-configurable: **15 min default, max 30, 5-min steps** | G6 |

---

## Sub-Documents

| Document | Description |
| :--- | :--- |
| [data-model.md](./data-model.md) | Prisma: `DROP_IN` event type, `DropInSession`, `DropInCheckIn`, `DropInAssignment` (match/timed slot) + `DropInAssignmentParticipant` join table, enums, GBR-sync fields |
| [rotation-engine.md](./rotation-engine.md) | TIMED + MATCH state machines, pool/queue + fairness ordering, submit/confirm flow, staff overrides, where-logic-lives verdict, shared pairing package |
| [gbr-integration.md](./gbr-integration.md) | Identity sync, auth & data flow, the 2-3 edge functions, submission loop + idempotency, rankings read, embed boundary |
| [gbr-edge-functions.md](./gbr-edge-functions.md) | Illustrative skeletons for `sync-player-identity` / `submit-match-result` / `get-rankings` (HMAC verify + service-role writes) + deployment checklist |
| [open-questions.md](./open-questions.md) | Gaps & discussion points to fill — priority, default, who decides |

---

## Technology Stack

- **Host app (FP):** Next.js 15 (App Router), tRPC, Prisma/PostgreSQL, Clerk auth.
- **Realtime board:** FP-native on `/events/[id]`; transport TBD (polling like admin check-in's 3s, or websockets). See rotation-engine.md.
- **Pairing:** shared package extracted from GBR `src/lib/round-robin-utils.ts` (pure TS).
- **Rating engine (GBR):** Vite/React SPA on Supabase; TrueSkill via `supabase/functions/calculate-ratings`.
- **FP↔GBR transport:** GBR edge functions called from FP backend with a secret key (preferred), or direct Supabase service-role/PostgREST (we own both; keys available).

---

## Implementation Phases (staged)

> Ordering delivers value early: MANUAL proves the scaffolding, **TIMED solves the core squatting pain**, then MATCH + GBR add the competitive draw.

### DI-1 — Foundations (casual drop-in needs NO new feature)
> **FINAL 2026-06-06 (owner):** casual drop-in = **just a multi-court `BOOKABLE` event** (owners title it "Drop-In"). Registration, payment, member self-check-in, and front-desk all come free from a normal Bookable event. So there is **no `DROP_IN` event type for casual, no "Rotation Play" option, and no DI-1c.** The `DROP_IN` type + `DropInSession` + `dropIn` router (DI-1a/DI-1b, shipped) are reserved **strictly** for the live-rotation feature (DI-2/DI-4) — the one thing a Bookable event can't be. See [open-questions.md](./open-questions.md) "Resolved (owner, 2026-06-06)".

1. ✅ `DROP_IN` `EventType`; `DropInSession`, `DropInCheckIn` models + enums (migration) — DI-1a. *(Reserved for TIMED/MATCH; unused by casual.)*
2. ✅ tRPC `dropIn` router: start/end session; check-in / waitlist / cancel — DI-1b. *(Reserved for TIMED/MATCH.)*
3. ✅ **Multi-court on Bookable** (2026-06-06, uncommitted, quick version): BOOKABLE events use a flat "Courts" multi-select (same picker as Rental Window) and can reserve several courts; first court → `resourceId`, full set → `resourceIds`; `calendar.ts` conflict check loops every court. Known conflict-detection gap documented in [multi-court-conflict-TODO.md](./multi-court-conflict-TODO.md).
4. ~~DI-1c casual UI~~ — **CANCELLED**; not needed.

### DI-2 — TIMED rotation + board + audio
1. Group formation from the waiting pool; per-court countdown + **audio horn** on expiry.
2. Public board on the event page: court → assigned group, time remaining, "up next."
3. Staff controls: start/advance/skip/extend/cancel a court.

### DI-3 — *(Deferred / Future)* Algorithmic pairing modes
Not in v1 (v1 doubles = self-formed pairs, A12). When wanted: **vendor-copy** GBR's pure pairing modules (`round-robin-utils.ts`, bits of `draw-schedule.ts`) into FP (F3, option c) to add **Americano / Mexicano / Ladder** as selectable session modes. Owner flagged this as a **follow-up after core functionality**.

### DI-4 — MATCH rotation (local scoring)
1. Matchups from the pool via **FIFO**; **doubles = self-formed editable pairs** (A12). No shared pairing code needed.
2. Court assignment on freedom; **auto-start** next matchup (A15); submit/confirm **state machine**; rejoin-queue gate.
3. FP-side drop-in leaderboard. Scores (per-game) stored locally; GBR sync **stubbed**.

### DI-5 — GBR stitch
1. Identity sync (`external_player_identities` + `gbrPlayerId`, lazy ghost, email dedup).
2. `submit-match-result` (idempotent via `external_match_id` + retry); turn on 1.0× self-reported submission.
3. `get-rankings` read + global-rank display alongside the FP leaderboard.

### DI-6 — Polish / follow-ups
1. Push notification nudging the opponent to confirm.
2. Optional per-match **time limit** for MATCH mode.
3. Self-serve kiosk/QR check-in.
4. Expanded staff manual-adjust actions.

---

## Open Decisions

Most A–D decisions are **resolved** (owner, 2026-06-02) — captured in the decisions table above and the Resolved section of [open-questions.md](./open-questions.md). Resolved highlights: `DROP_IN` is its own event type; TIMED = FIFO; no-show handling (A2); Lovable Cloud → **edge functions** with `SHUTTLEMENTOR_SHARED_SECRET` (HMAC, `verify_jwt=false`); fee = event cost; best 2-of-3; gender required.

**Still open** (see [open-questions.md](./open-questions.md)): **A–F are fully resolved.** Remaining are second-order **G2–G7** (mostly defaultable). **G1 is decided** — TIMED and MATCH both require FP accounts; the guest-user model that briefly shipped for this was cut 2026-06-11 (see [group-join-feature-plan.md](./group-join-feature-plan.md)). **F2** service account is created owner-side (auth user → `FP_SERVICE_USER_ID`); **F3 deferred** (v1 = self-formed pairs); future modes (Americano/Mexicano/Ladder) are a post-core follow-up. Leaderboard scope defaults to **per-session**.
