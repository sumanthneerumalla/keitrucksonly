# Drop-In — Rotation Engine

How the live session runs: the player pool, court assignment, the two rotation modes, the score submit/confirm state machine, staff overrides, and where the logic lives.

See [data-model.md](./data-model.md) for the rows referenced here.

---

## Where the logic lives (verdict)

**FP owns orchestration; pairing algorithms are a shared package extracted from GBR; GBR is the rating engine only.**

This is evidence-based (GBR code investigation, 2026-06-02):

- GBR's pairing/scheduling modules in `src/lib/` (`round-robin-utils.ts`, `draw-schedule.ts`, `event-schedule.ts`, `match-scheduler.ts`) are **pure functions with zero Supabase/React dependencies** → cleanly extractable into a shared workspace package FP can import.
  - `round-robin-utils.ts` provides exactly what we need: `generateSinglesRounds` (circle method), `generateFixedDoublesRounds`, **`generateRotatingDoublesRound1` / `…NextRound`** (DUPR-style ladder + pure rotation), `generateMixedDoublesRound1/NextRound`, and `calculateStandings` (matches-won → head-to-head → point-diff → points tiebreakers).
- GBR has **no continuous waiting pool or queue** — it pre-materializes rounds and assigns courts greedily within a **round-locked** model (`apply-reschedule.ts` → `rescheduleDraw`). Forcing continuous drop-in into rounds/brackets is wasteful and awkward.
- **Effort:** extract-algorithms-and-build-FP-queue ≈ 2-4 days; reuse-tournament-scaffold ≈ 3-5 days and wasteful. → **Option B (extract).**

**Boundary:** the shared package is *pure pairing math* — input `players + config`, output `matchups`. FP wraps it with the pool, court availability, persistence, and the board. GBR never sees the queue.

---

## The player pool & fairness ordering

The pool for a session = `DropInCheckIn` rows with `status = WAITING`.

**Ordering (next-up first):**
```
ORDER BY gamesPlayed ASC, lastPlayedAt ASC NULLS FIRST, queuedAt ASC
```
This favors players who've played least and waited longest → fair play time. No mutable queue table (see data-model.md). `IDLE` players (checked in, not queued) and `AWAITING_RESULT` players (owe a report/confirm) are excluded until they (re)join; `LEFT/DONE` are excluded permanently. **A1 (resolved): FIFO is the default; written to be toggleable later.**

---

## TIMED mode

Clock-driven; pure play-time fairness, no scores, no GBR.

**Loop (per court):**
1. **Form a group** of `playersPerCourt` (2 for singles, 4 for doubles/mixed) from the top of the pool.
2. Create a `DropInAssignment` + one `DropInAssignmentParticipant` per player (`side = null` — a TIMED group), `status = IN_PROGRESS`, `startedAt = now`, `expiresAt = now + rotationMinutes`. Mark those check-ins `PLAYING`.
3. **Countdown** renders on the board; at `expiresAt` an **audio horn** fires.
4. On expiry: `status = COMPLETED`; players → `IDLE` with `gamesPlayed += 1`, `lastPlayedAt = now`. They **rejoin manually** (re-forming a group, A12) — no auto-requeue.
5. Pull the next group onto the freed court.

**Group formation (A1):** strict FIFO from the ordered pool; skill-band / keep-winners are later toggles.

**No-show (A2):** when a group is called, **start the timer and notify** them it's their turn. If someone isn't there, the slot simply **runs and times out** (no auto-backfill). Staff can **end a timed slot early** from the event page.

---

## MATCH mode

Matchup-driven; produces self-reported (1.0×) results for GBR.

**Assignment:**
1. When a court is free and the pool has enough waiting players, form the next matchup. **v1 (A1/A12): FIFO over the pool**; in **doubles the queue unit is a self-formed pair** (players pick/edit a partner before joining the queue, A7/A12). Skill-based and algorithmic rotating-doubles (the shared `round-robin-utils` helpers) are later toggles, not v1.
2. Persist a `DropInAssignment` + `DropInAssignmentParticipant` rows (`side = A`/`B`), `status = IN_PROGRESS`, `externalMatchId = assignmentId`, `ratingWeight = 1.0`. Mark participants `PLAYING`.

**Future rotation modes (owner intent, post-v1):** Americano, Mexicano (skill-based), and Ladder / king-of-court — these use the shared GBR pairing helpers (F3, deferred) and replace self-formed pairing when a session enables them.

**Submit / confirm state machine** (the core of "keep courts moving" + "self-reported confirmed"):

```
(court frees + enough queued) ──auto-form & auto-start──▶ IN_PROGRESS   [ASSIGNED skipped/transient]
   IN_PROGRESS ──a player reports the score──▶ PENDING_CONFIRM   [COURT FREED → next matchup auto-starts here]
      PENDING_CONFIRM ──opponent confirms matching score──▶ CONFIRMED ──▶ enqueue GBR sync
      PENDING_CONFIRM ──opponent reports a different score──▶ DISPUTED ──▶ staff resolves
   (any) ──staff set/cancel──▶ CONFIRMED (staff-set) | CANCELLED
```

Key rules (A3):
- **First report frees the court → next matchup auto-starts.** On the first report, the engine **auto-forms and auto-starts** the next matchup (`IN_PROGRESS`, not left in `ASSIGNED`) from the waiting pool and notifies those players. The reported match moves to `PENDING_CONFIRM`; its players go to `AWAITING_RESULT` (off court, not yet able to rejoin) and are **not** part of the next match. If the pool is too thin to form a match, the court simply stays idle until enough players (re)join.
- **Dual gate to play again:** a player leaves `AWAITING_RESULT` only when the match is resolved — i.e. their side's score was **reported** AND the **opponent confirmed** it. Failing to report your own score, *or* to confirm the opponent's, keeps you locked out of the queue. On resolution → `IDLE`, then **press "rejoin"** (re-forming/editing a doubles partner, A12) → `WAITING` with `gamesPlayed += 1`, `lastPlayedAt = now`, `queuedAt = now`.
- **Dispute:** either side may reject the submitted score → `DISPUTED` → **both sides locked** until **staff resolve and record the final score** (counts at 1.0×, C2).
- **GBR push only on `CONFIRMED`** (or staff-resolved) → `gbrSyncStatus = PENDING` → submission loop. Ratings update only after that.
- **One actor per side (A13):** any one player on a side may report/confirm on the side's behalf (default).
- **Match time limit (DI-6, optional):** off in v1.

---

## Drop-in player state (displayed) — separate from event registration

A player's **drop-in** state is one of: `idle` (checked in, can join queue), `in queue` (`WAITING`), `playing` (`PLAYING`), `awaiting your score` / `awaiting opponent's confirmation` / `disputed` (all stored as `AWAITING_RESULT`; the precise label is derived from the open `DropInAssignment`), `done`, `left`. These are **independent of the member's `EventRegistration` status** (registered / paid / event-checked-in). A player must be event-checked-in **and** drop-in-checked-in to play.

## Session lifecycle (time-driven, soft)

**No mandatory "start" button.** A `DropInSession` is **active during the event's scheduled time window** and is materialized lazily (first check-in, or window open). At the window's **end**:
- **Stop forming new matchups** — the queue stops feeding courts; players still waiting simply don't get a new game.
- **In-progress matches may finish and report** — those results still sync to GBR.
- Anything **still unresolved** after a short grace **auto-cancels** (`CANCELLED`, not synced).

Optional staff overrides: **end now** (stop immediately) and **extend** (push the end time). Status: `SCHEDULED → ACTIVE → ENDED` (or `CANCELLED`).

## Staff / admin overrides (so courts never get stuck)

**Role: Facility+ (FACILITY & ADMIN).** All of these ship in v1 (E1); the state machines above are the contract they operate on:

- **End a timed slot early** / **start or advance the next match** manually.
- **Cancel a match** (`→ CANCELLED`): frees the court, returns present players to the pool, marks absentees `LEFT`. Not synced to GBR.
- **Enter or override a score** / **resolve a `DISPUTED` match** (`→ CONFIRMED`, staff-set, 1.0×; or `SKIPPED`/weight 0 for a walkover).
- **Remove, re-queue, or reorder a player.**
- **Add / remove drop-in courts** mid-session (A9) — re-snapshots `courtIds`.
- **Pause / resume**, **end the session**, and **manually check in a walk-in**.

---

## Realtime board (`/events/[id]`)

The drop-in event page renders **per-user** based on login + match status (**D2: the board IS the event page — no separate route**):

- **Everyone:** courts → assigned players, time remaining (TIMED) or status (MATCH), and the "up next" pool order.
- **A checked-in player:** a **join-queue** control (in doubles, pick/edit a partner first, A12); when up/playing, their court + opponents; **submit-score** and **confirm-score** controls; **rejoin** once their match resolves.
- **Staff/admin:** the override actions above (end a timed slot early, start the next round, resolve disputes, etc.).

**Kiosk mode (D4):** a button on the event page toggles **fullscreen + unlocks audio**, after which the **horn** plays from that device — so a TV-connected browser becomes the on-court board with sound. No separate kiosk app/route. (That same button-press satisfies browsers' requirement for a user gesture before audio may play.)

Transport: **polling** (D1/G5 — admin check-in already polls ~3s); simplest to ship. The **per-session leaderboard renders on this same page** (G3, ranked matches-won → head-to-head → point-diff via the shared `calculateStandings`), and the "your turn / report / confirm" prompts are just the polled board reflecting each user's state — **no sockets/push in v1**. **Account requirement (G1):** TIMED & MATCH players must be logged in; MANUAL is front-desk-only.

This board is **FP-native** — we do *not* embed GBR's `/live/:sessionId`. GBR is read only for a player's **global rank** (see gbr-integration.md).

**Public (logged-out) viewing (G8):** the event page is **already public-capable** — `EventDetailClient` (`/club/[shortName]/shop/events/[eventId]` + `/events/[eventId]`) renders for logged-out users with no redirect. So we **reuse the public event page, not an iframe embed**: when the event is `isPublic`, a spectator sees a **read-only** board (served by a `publicProcedure`, names per `showRegistrantNames`) with a "sign in to join / report" CTA; interaction stays on `protected`/`facility` procedures. Also add `DROP_IN` to the `calendar.getPublicEvents` filter so drop-ins list publicly. (Lands with standings in DI-4/DI-5; MANUAL has none.)

---

## Singles & doubles

- **Singles:** `playersPerCourt = 2`, one user per side.
- **Doubles / mixed (default):** `playersPerCourt = 4`, two users per side; mixed uses the gender-aware pairing helper.
- The shared module already distinguishes these (`generateSingles…` vs `generateFixed/RotatingDoubles…` vs `generateMixed…`).
- On GBR submission FP creates/reuses `teams` (1 or 2 players) matching the side composition; GBR's `teams.team_type` covers all three. **No GBR schema change.**
