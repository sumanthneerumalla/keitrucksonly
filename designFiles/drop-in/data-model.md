# Drop-In — Data Model

Prisma schema additions for the drop-in feature. Reuses the existing `CalendarEvent` / `ClubResource` scaffolding; adds a live-operations layer (session, check-in, court assignment).

See [README.md](./README.md) for decisions and [rotation-engine.md](./rotation-engine.md) for how these rows transition.

---

## What we reuse (no change)

| Existing primitive | Used for |
| :--- | :--- |
| `CalendarEvent.resourceIds: String[]` | The set of courts the drop-in session reserves |
| `CalendarEvent.isBlocking` + `checkResourceConflicts` | Keeps reserved courts from being double-booked |
| `CalendarEvent` RRULE recurrence | "Daily league" = recurring drop-in event |
| `CalendarEvent.maxParticipants` | Session capacity |
| `CalendarEvent.creditCost` + Phase 8a credits / `EventRegistration` | Drop-in fee: member uses credits, guest pays |
| `Attendance` (Phase 6/7 check-in log) | Optionally records the physical visit; `DropInCheckIn` is the session-scoped state |

---

## Schema Changes Required

### 1. Add `DROP_IN` to `EventType` enum

```prisma
enum EventType {
  BLOCK
  BOOKABLE
  COACHING_SLOT
  RENTAL_WINDOW
  RENTAL_BOOKING
  DROP_IN          // NEW: a managed drop-in session reserving N courts; mode set on DropInSession
}
```

> **Open (README #1):** alternatively keep `BOOKABLE` and add `dropInMode` there. Decision pending; the models below are mode-agnostic and work either way.

### 2. New enums

```prisma
enum DropInMode {
  TIMED            // clock-driven rotation, no scores
  MATCH            // matchup-driven; scores → GBR as self-reported 1.0×
  MANUAL           // register/check-in/cancel/waitlist only; no digital match records
}

enum DropInSessionStatus {
  SCHEDULED
  ACTIVE
  ENDED
  CANCELLED
}

enum DropInFormat {
  SINGLES          // open 1v1 — any gender vs any gender
  DOUBLES          // open 2v2 — any genders pair freely (app-level default for MATCH/TIMED)
  MIXED_DOUBLES    // strict 1 male + 1 female per pair (optional formal format; enforced via User.gender)
}
// SINGLES/DOUBLES are gender-OPEN (the ~95% casual case). On GBR submission (DI-4/5):
// open SINGLES -> team_type 'singles'; open DOUBLES (any genders) -> 'doubles'; MIXED_DOUBLES -> 'mixed_doubles'.
// GBR has no gender-composition constraints, so gender-mixed teams submit safely (verified 2026-06-03).

enum DropInSide {
  A
  B
}

enum DropInPlayerStatus {
  // Drop-in status — SEPARATE from EventRegistration.status / Attendance (which track register/pay/physical check-in).
  IDLE             // checked into the instance, not in the queue — must "join queue" to play (default on check-in)
  WAITING          // in the queue/pool, eligible for assignment ("in queue")
  PLAYING          // currently on a court
  AWAITING_RESULT  // off court; owes/awaits report or confirm — GATED from the queue. The precise label
                   //   (awaiting your report / awaiting opponent's confirm / disputed) is DERIVED from the open DropInAssignment.
  DONE             // finished for the session
  LEFT             // left / auto-removed
  CANCELLED        // check-in cancelled
}

enum DropInAssignmentStatus {
  ASSIGNED         // OPTIONAL/transient — staff pre-assignment, or the instant before auto-start. Happy path skips straight to IN_PROGRESS.
  IN_PROGRESS      // the current matchup on the court — auto-started the moment the court frees & enough players are queued
  PENDING_CONFIRM  // one side reported a score; court is FREED; awaiting opponent confirm (MATCH only)
  CONFIRMED        // both sides agree; eligible for GBR sync (MATCH only)
  DISPUTED         // score mismatch; needs staff resolution (MATCH only)
  COMPLETED        // TIMED slot ended by timer (no scores)
  CANCELLED        // staff-cancelled (e.g., a player left mid-match)
}

enum GbrSyncStatus {
  NOT_APPLICABLE   // TIMED / MANUAL — never synced
  PENDING          // confirmed, queued for submission
  SENT             // accepted by GBR
  FAILED           // submission errored; retry queue will re-attempt
  SKIPPED          // intentionally not scored (e.g., walkover / staff override)
}
```

### 3. `DropInSession` — one per event occurrence (day)

```prisma
model DropInSession {
  sessionId       String              @id @default(cuid())
  clubShortName   String
  club            Club                @relation(fields: [clubShortName], references: [clubShortName], onDelete: Cascade)
  eventId         String              // FK to CalendarEvent (DROP_IN type)
  event           CalendarEvent       @relation("DropInEvent", fields: [eventId], references: [eventId])
  occurrenceDate  DateTime            // which occurrence of a recurring series (date-only semantics)
  mode            DropInMode
  format          DropInFormat?       // null for MANUAL
  status          DropInSessionStatus @default(SCHEDULED)

  courtIds        String[]            // snapshot of event.resourceIds at session start (courts dedicated to drop-in)
  rotationMinutes Int?                // TIMED: slot length, staff-configurable — default 15, max 30, 5-min steps (G6); null for MATCH/MANUAL
  matchTimeLimitMinutes Int?          // MATCH (DI-6): optional hard cap per match; null = none
  bestOf          Int?      @default(3)   // MATCH: games per match (best-of-N); default best 2-of-3. null for TIMED/MANUAL
  pointsPerGame   Int?      @default(21)  // MATCH: points to win one game

  startedAt       DateTime?
  endedAt         DateTime?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  checkIns        DropInCheckIn[]
  assignments     DropInAssignment[]

  @@unique([eventId, occurrenceDate])   // one live session per day per series
  @@index([clubShortName])
  @@index([status])
}
```

> **Session lifecycle (time-driven, E2):** `status` follows the event's scheduled window — `ACTIVE` during it, materialized lazily on first check-in. At window end: stop new matchups, let in-progress finish + report, auto-cancel lingering unresolved ones. Optional staff end-now/extend. See rotation-engine.md.

### 4. `DropInCheckIn` — pool membership + per-player state

```prisma
model DropInCheckIn {
  checkInId     String             @id @default(cuid())
  sessionId     String
  session       DropInSession      @relation(fields: [sessionId], references: [sessionId], onDelete: Cascade)
  userId        String             // FP member
  user          User               @relation(fields: [userId], references: [userId])

  status        DropInPlayerStatus @default(IDLE)

  // Fairness ordering inputs (queue is derived, not a separate table)
  queuedAt      DateTime           @default(now())  // when (re)joined the WAITING pool
  gamesPlayed   Int                @default(0)
  lastPlayedAt  DateTime?

  // GBR linkage resolved lazily at/after check-in (see gbr-integration.md)
  gbrPlayerId   String?

  // Billing hook (reuse Phase 8a): which registration/credit usage covered the fee, if any
  registrationId String?

  checkedInAt   DateTime           @default(now())
  leftAt        DateTime?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  @@unique([sessionId, userId])    // one active check-in per player per session
  @@index([sessionId, status])     // pool query: WAITING players for a session
  @@index([userId])
}
```

> **Separate from registration.** `DropInCheckIn.status` is the **drop-in** status only. Whether a member is registered/paid for the event lives in the existing `EventRegistration`/`Attendance` models and is independent — a player can be `REGISTERED`+`CHECKED_IN` (event) while `IDLE`/`WAITING`/`PLAYING`/`AWAITING_RESULT` (drop-in). Playing requires **both** an event check-in and a drop-in check-in.

> **Queue is derived, not stored.** The "pool" = `DropInCheckIn` where `status = WAITING`, ordered by `gamesPlayed ASC, lastPlayedAt ASC NULLS FIRST, queuedAt ASC`. This gives play-time fairness without a mutable queue table. An explicit `queuePosition` can be added later if manual reordering is needed. (`gamesPlayed` counts rotations in TIMED, matches in MATCH.)

### 5. `DropInAssignment` — a court occupied by players for a slot

One model serves both modes. In **TIMED** mode it's a timed group occupancy (no scores). In **MATCH** mode it carries two sides, scores, and GBR-sync fields.

```prisma
model DropInAssignment {
  assignmentId   String                 @id @default(cuid())
  sessionId      String
  session        DropInSession          @relation(fields: [sessionId], references: [sessionId], onDelete: Cascade)
  courtId        String                 // ClubResource id (one of session.courtIds)
  format         DropInFormat
  status         DropInAssignmentStatus @default(ASSIGNED)

  // Participants are rows in DropInAssignmentParticipant (join table, §5b).
  // TIMED: a group with side=null. MATCH/SINGLES: 1 per side. MATCH/DOUBLES|MIXED_DOUBLES: 2 per side.
  participants   DropInAssignmentParticipant[]

  // Timing
  startedAt      DateTime?
  endedAt        DateTime?
  expiresAt      DateTime?              // TIMED: startedAt + rotationMinutes; MATCH (DI-6): optional time limit

  // Scores (MATCH only) — best-of-N per DropInSession.bestOf
  reportedByUserId  String?
  reportedScoreA    Int?                // games won by side A (e.g. 2 in a 2-of-3) — summary/winner
  reportedScoreB    Int?                // games won by side B
  gameScores        Json?               // per-game scores [{a:21,b:18},{a:19,b:21},{a:21,b:15}] — REQUIRED for MATCH;
                                        //   submitted to GBR's `match_sets` (GBR's rating uses margin-of-victory, A14)
  winnerSide        DropInSide?         // null until decided
  confirmedByUserId String?
  confirmedAt       DateTime?

  // GBR sync (MATCH only)
  externalMatchId   String?             @unique  // idempotency key sent to GBR; == assignmentId
  gbrSyncStatus     GbrSyncStatus       @default(NOT_APPLICABLE)
  gbrSyncedAt       DateTime?
  gbrSyncError      String?
  ratingWeight      Float?              // 1.0 for self-reported drop-in matches

  createdAt      DateTime               @default(now())
  updatedAt      DateTime               @updatedAt

  @@index([sessionId, status])
  @@index([courtId])
  @@index([gbrSyncStatus])              // retry queue scan: PENDING/FAILED
}
```

**Notes**
- **Participants live in a join table (`DropInAssignmentParticipant`, §5b), not `String[]` arrays.** Unlike `CalendarEvent.resourceIds` (courts, rarely queried per-court), players are the unit we aggregate — per-session standings, match history, and the `gamesPlayed`/`lastPlayedAt` fairness counters all need per-player rows with FK integrity, which makes those `GROUP BY` queries trivial.
- `externalMatchId == assignmentId` gives GBR a stable idempotency key — retries never double-count (`matches.external_match_id` is GBR's dedup column).
- TIMED rows: `gbrSyncStatus = NOT_APPLICABLE`, scores null, ended via `expiresAt`.

### 5b. `DropInAssignmentParticipant` — per-player rows (the unit we aggregate)

```prisma
model DropInAssignmentParticipant {
  id                 String           @id @default(cuid())
  assignmentId       String
  assignment         DropInAssignment @relation(fields: [assignmentId], references: [assignmentId], onDelete: Cascade)
  sessionId          String           // denormalized from the assignment for fast per-session aggregation
  userId             String
  user               User             @relation(fields: [userId], references: [userId])
  gbrPlayerId        String?          // GBR player id used at submission time
  side               DropInSide?      // A / B for MATCH; null for a TIMED group
  isWinner           Boolean?         // stamped when the assignment is CONFIRMED (MATCH); null for TIMED
  ratingAtAssignment Float?           // optional: GBR display rating used for skill-band pairing (audit/debug)
  createdAt          DateTime         @default(now())

  @@unique([assignmentId, userId])    // a player appears once per assignment
  @@index([sessionId, userId])        // "all of player X's results this session" → standings/leaderboard
  @@index([userId])                   // cross-session player history
}
```

This join table is why the per-session leaderboard and the fairness counters are cheap: **standings** = aggregate `DropInAssignmentParticipant` by `sessionId` (fed into the shared `calculateStandings` helper); `DropInCheckIn.gamesPlayed` / `lastPlayedAt` are cached counters with these rows as the source of truth. It also gives clean win attribution (`isWinner`) and a place to snapshot the rating used for skill-band pairing.

### 6. Back-relations on existing models

```prisma
// CalendarEvent
dropInSessions  DropInSession[]  @relation("DropInEvent")

// Club, User — add the inverse relations referenced above
// (User also gains DropInCheckIn[] and DropInAssignmentParticipant[]).
```

> **Prereq (B1):** add a **required `gender`** column to FP `User`, and add it to the onboarding required-fields flow (the redirect-to-profile flow that already collects first/last/email). It's passed to GBR at provision; align allowed values with GBR's `players.gender` (B6).

> Add `gbrPlayerId String?` to the FP member profile (e.g., `User` or the per-club student profile) for the reverse lookup and global-rank display. Exact home depends on the per-club-profile decision (see memory `project_per_club_profile_pending`). `DropInCheckIn.gbrPlayerId` is a per-session cache of the resolved id.

---

## Status flows (summary)

- **Drop-in status (SEPARATE from EventRegistration / Attendance):** `IDLE → WAITING (join queue) → PLAYING → AWAITING_RESULT → IDLE (rejoin)`; `→ DONE/LEFT` from most states; `CANCELLED` on cancel. **MATCH gate:** a player can't leave `AWAITING_RESULT` until their match is resolved — they've reported AND the opponent confirmed (a dispute locks both until staff resolves + records). **TIMED** has no `AWAITING_RESULT` (no scores) — players return to `IDLE` and rejoin.
- **Assignment (MATCH):** `ASSIGNED → IN_PROGRESS → PENDING_CONFIRM → CONFIRMED → (GBR sync)`; `PENDING_CONFIRM → DISPUTED` on mismatch; any → `CANCELLED` by staff.
- **Assignment (TIMED):** `ASSIGNED → IN_PROGRESS → COMPLETED` (timer); any → `CANCELLED`.

Full transition rules, guards, and staff overrides are in [rotation-engine.md](./rotation-engine.md).
