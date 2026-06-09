# Drop-In — Group Join (Parties + Auto-Fill + Guests)

**Status:** Plan (2026-06-07). Pending owner sign-off; no code written yet.
**Branch:** `feature/drop-in-group-join` off `dev`.
**Dependencies:** Existing drop-in models (`DropInSession`, `DropInCheckIn`, `DropInAssignment`, `DropInAssignmentParticipant`), router `src/server/api/routers/dropIn.ts`, GBR sync (gated separately per [gbr-integration.md](./gbr-integration.md)).
**Priority:** High — closes a recurring player request to queue as a group instead of forcing solo sign-ups.

---

## Overview

Today, drop-in queueing is strictly per-individual: `DropInCheckIn` rows go into a pool ordered by `(gamesPlayed, lastPlayedAt, queuedAt)`, and `formNext` / `tickTimed` `slice(0, playersPerCourt)` players off the top onto a freed court. There's no concept of a group that wants to stay together.

This feature adds a **party**: a group of 1+ players who hold a single queue slot together. Parties can be:
- **Closed** (`openToFill = false`): the party plays only when it has exactly the court's capacity (e.g. 4 for DOUBLES) AND every member is ready. If incomplete or someone is still on another court, the party **holds its position**.
- **Open** (`openToFill = true`): the party can be filled by other open parties at court-assignment time. A solo who clicks **Join others** is just a party-of-1 with `openToFill = true`.

Guests (non-account players) are first-class: they exist as `User` rows with `isGuest = true`, can be added to parties by name, but any assignment containing a guest is **not eligible for GBR / leaderboard**.

This is purely additive — solo `joinQueue` keeps working (it becomes `createParty(self only)` under the hood). The selection algorithm in both `formNext` and `tickTimed` is replaced by a single shared `pickNextOccupants` helper.

---

## Settled decisions

Captured here so they're not re-litigated later. References are to questions in `open-questions.md` where applicable.

| ID | Decision | Detail |
| :--- | :--- | :--- |
| **A1** | Head party not ready → skip; party keeps its position. | Court goes to the next ready entry. |
| **B2** | Adding an existing solo to a party snaps the party to the solo's earlier `queuedAt`. | Modeled as `party.queuedAt = MIN(party.queuedAt, member.queuedAt)` on every member-add. |
| **C1** | Party larger than court capacity → reject the join. | E.g. party of 4 can't join a SINGLES session. |
| **D1** | Held parties wait indefinitely. | No auto-demotion; manual removal only. |
| **X** | Party ordering is pure FIFO by `party.queuedAt`. | `gamesPlayed`/`lastPlayedAt` fairness applies only to the secondary fill pool (deciding which open solos get pulled to fill a head party). Owner rationale: stay time + arrival time are too variable to enforce a hybrid fairly. |
| **G2** | Guests are persistent, club-scoped. | Searchable in an "Add player" modal; reusable across sessions. |
| **—** | No party leader. Any member can add/remove/disband. | Last-member-leaves → party auto-disbands. |
| **—** | No gender enforcement in rotation. | MIXED_DOUBLES gender check is documented but stays unimplemented; not part of this feature. |
| **—** | Composition: parties are atomic. | Never split a party across courts. |
| **—** | Composition overshoot → skip & scan. | If the next openToFill entry would overshoot the court, skip it (it keeps its place), scan further for a cleanly-fitting entry. |
| **—** | Court stays empty if no clean fill. | Head party + available fillers can't reach exact capacity → head waits, court is left for the next queue change. |
| **—** | Multi-court frees in the same tick → sequential allocation. | One court at a time; consumed parties leave the pool between assignments. |
| **—** | Mode scope (v1) | TIMED + MATCH. MANUAL has no auto-allocation so the feature is moot there; party model still lets MANUAL players list themselves as a group for staff visibility. |
| **—** | PAUSED sessions | Reject party create / member add / openToFill toggle. Existing parties stay in place; no rotation runs (consistent with existing PAUSED semantics, `dropIn.ts:647`). |

---

## 1. Schema changes

One migration: `add_drop_in_party_and_guest`.

### 1.1 No new enum

Earlier draft proposed a `DropInPartyStatus` enum. After review, the party's state is derived at read time from its members' `DropInCheckIn.status` (see §1.2). No new enum needed in the schema.

### 1.2 New model

```prisma
model DropInParty {
  partyId       String              @id @default(cuid())
  sessionId     String
  session       DropInSession       @relation(fields: [sessionId], references: [sessionId], onDelete: Cascade)
  openToFill    Boolean             @default(false)
  queuedAt      DateTime            @default(now())  // MIN across members; B2 snap target
  // Audit / display
  createdByUserId String?           // who clicked "Create party"
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt

  members       DropInCheckIn[]

  @@index([sessionId, queuedAt])
}
```

No leader column — any member can manage.

**No `status` column on `DropInParty`** (revised after review). A party's effective state is *derived* at read time from its members' `DropInCheckIn.status`: WAITING iff every member is `WAITING`/`IDLE`; PLAYING iff any member is `PLAYING`; etc. Source of truth stays single. This avoids drift across the many sites that mutate check-in status (`endSlot`, `cancelAssignment`, `confirmScore`, `staffSetScore`, `tickTimed`, `endSession`) — none of them have to remember to also flip a redundant party column. Cancellation/disband is modeled by flipping member check-ins to `LEFT`/`CANCELLED`; a party with zero remaining "live" members is treated as defunct and excluded from selection.

The `DropInPartyStatus` enum (§1.1) is removed from the schema. The plan keeps it as a TS-only union used by `pickNextOccupants` for clarity.

### 1.3 `DropInCheckIn` change

```prisma
model DropInCheckIn {
  // ...existing fields...
  partyId   String      // NOT NULL after backfill (see §1.5)
  party     DropInParty @relation(fields: [partyId], references: [partyId], onDelete: Restrict)
  @@index([sessionId, partyId])
}
```

- **NOT NULL after backfill** (revised after review). The migration is two-step: add nullable column → backfill (§1.5) → `ALTER ... SET NOT NULL`. Every check-in is in exactly one party (a solo is a party of one). Eliminates an entire class of "is this a loose check-in or a real party?" branches in selection / display / re-queue code.
- `onDelete: Restrict` so a party cannot be deleted while members reference it. Disband is modeled as flipping member check-ins to `LEFT` (their `partyId` stays for audit), not as deleting the party row. Sessions ending still cascade-delete via `DropInSession → DropInParty → DropInCheckIn`.

### 1.4 `User` change

```prisma
model User {
  // ...existing fields...
  isGuest          Boolean  @default(false)
  guestCreatedBy   String?
  guestCreator     User?    @relation("GuestCreator", fields: [guestCreatedBy], references: [userId], onDelete: SetNull)
  createdGuests    User[]   @relation("GuestCreator")
}
```

- `clerkUserId` stays NOT NULL. Guests get a synthetic `guest_<cuid2>` value generated at create time using `createId()` from `@paralleldrive/cuid2` (already a transitive dependency; if not directly imported, add it). Prisma's `@default(cuid())` can't compose a prefix, so generation happens in the procedure body.
- Self-relation on `guestCreatedBy` is explicit so Prisma can include "who created this guest" in admin views.
- All "real user" filters add `WHERE NOT isGuest`. The Clerk webhook flow (`src/server/utils/createUserAccount.ts:74` `findOrCreateClerkUserId`) only ever fires from Clerk-driven signups, so it never sees guests — no additional filter needed there.

### 1.5 Backfill / migration safety

Migration runs three SQL statements in one transaction:

1. **Add nullable `partyId` column** + indexes + the `DropInParty` table.
2. **Backfill** — for every existing `DropInCheckIn` row (regardless of status — LEFT/CANCELLED check-ins keep their audit trail and get a defunct party row too), create a `DropInParty` row with `openToFill = true` and `queuedAt = checkIn.queuedAt`. Set `checkIn.partyId = newParty.partyId`. Idempotent (`WHERE partyId IS NULL`).
3. **`ALTER ... SET NOT NULL`** on `DropInCheckIn.partyId`.

`openToFill = true` for ALL backfilled parties is intentional: it matches today's de facto behavior. Today's solo check-ins are *implicitly* mixable — `formNext` slices the pool indiscriminately. A backfilled `openToFill = true` solo party is the precise model of that existing behavior. The new default `openToFill = false` applies only to parties created via the new procedures (where the caller explicitly opted into "we'll find our own people").

If a session is *live* at deploy time, the backfill is still safe: the next call into `pickNextOccupants` will treat existing WAITING check-ins as their own openToFill parties of 1, which is exactly how `slice(0, N)` selects them today.

---

## 2. tRPC procedures (new)

All live in `src/server/api/routers/dropIn.ts`, near `joinQueue` ([dropIn.ts:318](src/server/api/routers/dropIn.ts:318)).

| Procedure | Helper | Purpose |
| :--- | :--- | :--- |
| `createParty` | `protectedProcedure` | Caller creates a party of 1 (themselves). Returns `partyId`. Replaces `joinQueue` semantics under the hood. |
| `addPartyMember` | `protectedProcedure` | Add a real user (by `userId`) or a guest (by `guestUserId`) to caller's party. Implements B2 snap. |
| `removePartyMember` | `protectedProcedure` | Remove someone from a party. Allowed for any member. Last-member-removed → party CANCELLED. |
| `leaveParty` | `protectedProcedure` | Caller leaves their own party. Equivalent to `removePartyMember(self)` but also flips their check-in to LEFT. |
| `disbandParty` | `protectedProcedure` | Any member can disband; all members revert to solo IDLE (not auto-requeued). |
| `setPartyOpenToFill` | `protectedProcedure` | Toggle the `openToFill` flag. Allowed for any member. Re-validated against current size + court capacity. |
| `createGuest` | `protectedProcedure` | Create a guest `User` row in the caller's club. Returns the guest `userId`. Validates uniqueness within club (firstName + lastName), allows duplicates only with explicit confirm. |
| `searchGuests` | `protectedProcedure` | Lookup guests in caller's club by name prefix. Returns up to 20 matches. |
| `joinQueue` (existing, augmented) | `protectedProcedure` | Stays as the existing endpoint name. Behavior preserved: it **upserts** `DropInCheckIn` keyed on `(sessionId, userId)`, refreshing `queuedAt`/`leftAt` and preserving `gamesPlayed`/`lastPlayedAt`. New: on upsert, if the caller has no existing party in this session, a new `DropInParty` (size 1, `openToFill = true`) is created and the check-in points to it. If they already have a party, they re-enter via that party. Zero client churn. |
| `addToQueue` (existing, augmented) | `facilityProcedure` | Staff bulk-add. Today accepts up to 8 userIds with staggered `queuedAt` ([dropIn.ts:580](src/server/api/routers/dropIn.ts:580)) — used to walk a line of unrelated walk-ins through check-in. The "8" is the batch-size cap for the API call, **not** a party size. Each walk-in becomes its own party of 1 with `openToFill = true`. Staff who want to create a multi-person party use the standard `createParty` + `addPartyMember` flow instead. Behavior is identical to today (each entry is solo and mixable). |

**Validation rules common to add/create:**
- Session must be ACTIVE (PAUSED/ENDED/CANCELLED rejected).
- Target user must be in the same club (`user.clubShortName === session.clubShortName`).
- Target user must not already be in another party in this session (FK-unique enforcement via `DropInCheckIn @@unique([sessionId, userId])`, already in schema).
- Target user's current check-in status must NOT be `LEFT` or `CANCELLED` (re-add via separate `rejoinAsParty` flow if needed — out of scope for v1).
- A user currently `PLAYING` *can* be added to a party (they become "not ready" until their current game ends).
- If party would exceed format capacity (size > playersPerCourt) → reject with `BAD_REQUEST` (C1).

**Authorization** is "any member of the party can manage." Implemented as a single helper `assertCallerInParty(partyId, callerUserId)` reused by every party-manipulation procedure.

**Concurrent `setPartyOpenToFill`** from two members flipping in opposite directions: last-write-wins under Prisma's default isolation level. Acceptable — the flag affects future selections only; both states are valid and either user can flip again.

**Race: `addPartyMember` mid-selection.** If `loadPartySummaries` snapshots the pool, then `addPartyMember` lands before the `updateMany` claim, the new member's `WAITING` row is not in the claim's `userId` set → the party plays without them. To prevent this silent drop:
- The `pickNextOccupants` transaction re-reads party member counts after the claim attempt.
- If a party's expected member count (from snapshot) doesn't match the actual claim count for that party, the transaction aborts with `CONFLICT` and retries on the next tick.
- Effect: a just-added member either makes it onto the same court (next tick) or starts their queue position with the party's existing `queuedAt`.

---

## 3. The selection algorithm: `pickNextOccupants`

Pure function extracted into `src/server/services/dropIn/pickNextOccupants.ts`. Used by both `formNext` ([dropIn.ts:629](src/server/api/routers/dropIn.ts:629)) and `tickTimed` ([dropIn.ts:1354](src/server/api/routers/dropIn.ts:1354)).

### Signature

```ts
type PartySummary = {
  partyId: string;
  openToFill: boolean;
  queuedAt: Date;
  memberUserIds: string[];                  // members in DropInCheckIn
  memberStatuses: Record<string, DropInPlayerStatus>;  // userId → status snapshot
  hasGuest: boolean;
};

type Pick = {
  partyIds: string[];      // parties that will get assigned together
  userIds: string[];       // flattened, in display order
  ratingEligible: boolean; // false if any party.hasGuest
};

function pickNextOccupants(
  parties: PartySummary[],   // already sorted by queuedAt ASC
  capacity: number,          // 2 (SINGLES) or 4 (DOUBLES / MIXED_DOUBLES)
): Pick | null;
```

### Two distinct "head can't serve this court" cases

The algorithm distinguishes between two reasons a head party may not be assignable, and they have **different** behaviors:

- **(A1) Temporal blocker — head is not ready.** A member is currently `PLAYING` or `AWAITING_RESULT` on another court. This will resolve naturally when that game ends; the head's "first-place position" is sacred per the spec ("they hold their position until everyone is free"). **Behavior: skip head, try the next head.** When the head later becomes ready, it will again be at the front of the FIFO order.
- **Combinatorial blocker — open head but no clean fill.** Head is open and ready, but the pool's remaining open parties don't combine to exactly the capacity (e.g. head of 2 + only a closed-3 + a closed-4 remaining). The blocker only resolves when the queue *shape* changes (someone joins, leaves, becomes openToFill, etc.). **Behavior: stop — court stays empty until the pool changes.** Do NOT advance to the next head; that would let an open-but-small head be skipped on the very court they earned by waiting.

Both behaviors are intentional and don't contradict. A1 advances because *time alone* will fix it. Combinatorial-stall holds because *no amount of waiting* will, on its own, fix it.

### Algorithm (pseudocode)

```
function pickNextOccupants(parties, capacity):
  for i in 0..parties.length-1:
    head = parties[i]

    # A1: skip head if any member is not "ready" — try next head
    if not isReady(head):
      continue

    # Closed party — must be exactly capacity
    if not head.openToFill:
      if head.memberUserIds.length == capacity:
        return { partyIds: [head.partyId], userIds: head.memberUserIds, ratingEligible: !head.hasGuest }
      # Incomplete closed party — held in place; try next head.
      continue

    # Defensive: C1 should make this unreachable. If we get here, log and skip
    # (do not stall the rotation on corrupt data).
    if head.memberUserIds.length > capacity:
      reportInvariantViolation('party larger than capacity', { partyId: head.partyId })
      continue

    # Open party — fill from later open parties
    chosen = [head]
    chosenSize = head.memberUserIds.length

    for j in i+1..parties.length-1:
      if chosenSize == capacity: break
      candidate = parties[j]
      if not candidate.openToFill: continue
      if not isReady(candidate): continue
      if chosenSize + candidate.memberUserIds.length > capacity:
        continue   # overshoot — skip & scan further
      chosen.push(candidate)
      chosenSize += candidate.memberUserIds.length

    if chosenSize == capacity:
      return {
        partyIds: chosen.map(p => p.partyId),
        userIds: chosen.flatMap(p => p.memberUserIds),
        ratingEligible: chosen.every(p => !p.hasGuest),
      }
    # Combinatorial stall — court stays empty until queue shape changes.
    return null

  return null   # nothing in the pool can play

function isReady(party):
  for u in party.memberUserIds:
    s = party.memberStatuses[u]
    # IDLE: just checked in or just finished a game (today's normal "ready" state).
    # DONE: only set by endSession today — defensive, not normally reachable here.
    if s != IDLE and s != DONE: return false
  return true
```

### Caller integration

Both `formNext` and `tickTimed` follow this pattern (inside their existing transaction):

```ts
const parties = await loadPartySummaries(tx, sessionId);
const pick = pickNextOccupants(parties, playersPerCourt);
if (!pick) {
  // formNext: throw BAD_REQUEST("no ready group can fill this court")
  // tickTimed: return false; court stays empty until pool changes
  return ...;
}

// Atomically claim — same updateMany pattern as today
const claim = await tx.dropInCheckIn.updateMany({
  where: { sessionId, userId: { in: pick.userIds }, status: 'WAITING' },
  data: { status: 'PLAYING' },
});
if (claim.count !== pick.userIds.length) throw new Error('CONTENDED');

// Race guard: re-read each picked party's WAITING-member count post-claim.
// If a party gained a member between snapshot and claim, its expected
// membership doesn't match what we just claimed — abort and retry.
const postCounts = await tx.dropInCheckIn.groupBy({
  by: ['partyId'],
  where: { sessionId, partyId: { in: pick.partyIds }, status: 'PLAYING' },
  _count: { userId: true },
});
for (const p of pick.partyIds) {
  const expected = pick.userIds.filter(u => /* belongs to p in snapshot */).length;
  const actual = postCounts.find(c => c.partyId === p)?._count.userId ?? 0;
  if (actual !== expected) throw new Error('PARTY_CHANGED');  // retry
}

await tx.dropInAssignment.create({
  data: {
    sessionId, courtId, format,
    status: 'IN_PROGRESS',
    startedAt: now,
    expiresAt,
    ratingWeight: pick.ratingEligible && mode === 'MATCH' ? 1.0 : null,
    participants: { create: pick.userIds.map((uid, i) => ({ ... })) },
  },
});
```

Atomicity guarantees:
- The `updateMany` row-level claim still gates assignment (concurrent ticks both seeing the same head party race; only one wins).
- `pickNextOccupants` reads a snapshot inside the same `$transaction`.
- The post-claim party-count re-read catches `addPartyMember` landings between snapshot and claim. The caller retries on the next tick; the added member's `queuedAt` (inherited from the party) keeps the party at the same front-of-queue position.
- Party state is **derived**, never written here. No drift across the many state-mutation sites listed in §4.

---

## 4. Party state is derived from member status

Since `DropInParty` has no `status` column, party state is computed at read time inside `loadPartySummaries`. The mapping:

| Party state (derived) | Condition |
| :--- | :--- |
| **WAITING** | At least one member has `status ∈ {WAITING, IDLE}` AND no member has `status = PLAYING`. |
| **PLAYING** | Any member has `status = PLAYING`. |
| **AWAITING_RESULT** | Any member has `status = AWAITING_RESULT` AND no member is `PLAYING`. (MATCH mode only; the party is between a court-end and a score-confirm.) |
| **DEFUNCT** | All live members are `LEFT` or `CANCELLED`. Excluded from selection. |

`isReady(party)` (from §3) is "no member is `PLAYING` or `AWAITING_RESULT`."

### Member-level (`DropInCheckIn.status`) — unchanged enum

The existing enum and existing mutation sites stand. No site needs to also flip a party-level column. Sites that mutate member status today:

- `joinQueue` / `rejoin` ([dropIn.ts:406](src/server/api/routers/dropIn.ts:406), [:486](src/server/api/routers/dropIn.ts:486)) — set `WAITING`.
- `leaveQueue` / `setCheckInStatus → LEFT` — set `LEFT`.
- `formNext` / `tickTimed` selection — set `PLAYING`.
- `endSlot` / `tickTimed` expiry / `cancelAssignment` — set `IDLE`.
- `reportScore` — set `AWAITING_RESULT` mid-game.
- `confirmScore` / `staffSetScore` — set `IDLE` after score confirmation.
- `endSession` — set `DONE` for everyone present.

None need party-related code changes beyond §5 (re-queue) and the auth guard for `disbandParty` rejecting mid-PLAYING parties.

### Disband / last-member-leaves

- `disbandParty` flips every live member's check-in to `LEFT` (audit-preserved `partyId`). The party row stays for history; it's just defunct at selection time. Rejected if any member is currently `PLAYING`.
- `leaveParty` for the *last* live member is equivalent to `disbandParty` (idempotent — the party already has nobody live).

---

## 5. Re-queue after a game

When a `DropInAssignment` completes (`COMPLETED` / `CONFIRMED`), the existing code path runs unchanged:

1. Members go to `IDLE` (`gamesPlayed += 1`, `lastPlayedAt = now`). Existing behavior in [tickTimed line 1404](src/server/api/routers/dropIn.ts:1404), [endSlot](src/server/api/routers/dropIn.ts:752), [confirmScore](src/server/api/routers/dropIn.ts:1048), [staffSetScore](src/server/api/routers/dropIn.ts:1198).
2. Party derived state (per §4) becomes WAITING-ish-but-not-queued: members are IDLE, not WAITING. The party is not in the selection pool until someone explicitly re-queues.

**Re-queue is explicit, party-level.** Any member can click "Re-queue our group"; a new procedure `requeueParty`:

- Filters members: only those currently `IDLE` rejoin. Members who `LEFT` mid-game stay LEFT; members who are `AWAITING_RESULT` (rare — implies a deferred report) wait for their previous result to confirm before any re-queue applies.
- If no `IDLE` members → party is effectively dissolved by attrition; the procedure is a no-op (returns `{requeued: 0}`).
- Otherwise: flip those members' check-ins to `WAITING` with a fresh `queuedAt = now`. Update `party.queuedAt = now` so party FIFO position is fresh too (consistent with pure party FIFO).
- `gamesPlayed` and `lastPlayedAt` are preserved (already incremented at game end). These don't affect party order under rule X but do affect the secondary fill pool — players who've played more recently sit lower in the secondary sort when their party is openToFill and being matched with other openToFill parties' members.

A "Quick rejoin solo" link is also available for individual members who want to leave the party and re-queue alone (`leaveParty` + `joinQueue`).

---

## 6. GBR / leaderboard suppression for guests

`DropInAssignment.ratingWeight` is the existing knob: `null` means "do not sync to GBR" (currently used for TIMED mode, [dropIn.ts:729](src/server/api/routers/dropIn.ts:729)).

**New rule applied at assignment creation:** if any participant has `isGuest = true`, set `ratingWeight = null` regardless of mode. The `ratingEligible` flag computed in `pickNextOccupants` (§3) drives this.

**REQUIRED additional code change (this PR):** `confirmScore` ([dropIn.ts:1048](src/server/api/routers/dropIn.ts:1048)) and `staffSetScore` ([dropIn.ts:1198](src/server/api/routers/dropIn.ts:1198)) currently set `gbrSyncStatus = 'PENDING'` **unconditionally**. Without a gate, a guest-containing assignment with `ratingWeight = null` would still get queued for sync. Add the gate:

```ts
// In confirmScore + staffSetScore, before setting gbrSyncStatus = 'PENDING':
if (assignment.ratingWeight === null) {
  // TIMED mode or guest-containing — do not sync to GBR.
  // gbrSyncStatus stays at its default (NOT_APPLICABLE).
} else {
  // existing behavior: gbrSyncStatus = 'PENDING'
}
```

This is treated as part of this feature, not a separate ticket — the new guest path silently leaks to GBR without it.

---

## 7. Board / `getBoard` data contract

`getBoard` ([dropIn.ts:258](src/server/api/routers/dropIn.ts:258)) currently returns `{ session, pool, viewerUserId }`. New shape (purely additive — existing fields including `viewerUserId` preserved):

```ts
{
  session: ...,           // unchanged
  viewerUserId: string,   // unchanged — client uses this for "is this me?" rendering
  pool: Array<{
    // existing per-checkin fields...
    partyId: string;
    isPartyHead: boolean;        // first member by createdAt — for display grouping only
  }>;
  parties: Array<{                // NEW: deduped party list in FIFO order, includes
                                  // WAITING + non-WAITING parties whose members are
                                  // visible on the board (e.g. members PLAYING on
                                  // another court — needed to render
                                  // "Alice waiting, Bob playing on court 2").
    partyId: string;
    openToFill: boolean;
    queuedAt: string;
    memberCount: number;
    members: Array<{ userId: string; firstName: string; lastName: string; isGuest: boolean; status: DropInPlayerStatus }>;
    hasGuest: boolean;
    isReady: boolean;             // computed: no member PLAYING/AWAITING_RESULT
    derivedState: 'WAITING' | 'PLAYING' | 'AWAITING_RESULT' | 'DEFUNCT';
  }>;
}
```

Note: `parties[].members` includes members who are *not* currently `WAITING` (e.g. one is mid-game on another court). This is so the board can render a party row like "Party of 4: Alice + Bob queued, Charlie on Court 2, Diana on Court 3" while the party is held. Today's `pool` filter (`status === 'WAITING'`) stays the same so existing renderings don't break.

Client decides whether to render parties as a single collapsed row or expanded. No layout decisions in this plan — that's a UI ticket. Existing consumer `src/app/(app)/events/_components/dropin-ui.tsx` continues to read `pool` as before; the new `parties` array is opt-in.

---

## 8. Test matrix (vitest, under `src/server/services/dropIn/__tests__/`)

Each fixture builds a party graph + capacity and asserts `pickNextOccupants` output. Plus integration tests for the procedures.

| # | Scenario | Expected |
| :--- | :--- | :--- |
| T1 | Closed party of 4 at head, all IDLE → DOUBLES court | Assigned. ratingEligible = true. |
| T2 | Closed party of 3 at head (incomplete), DOUBLES court | Skipped (held); algo returns null if pool empty after. |
| T3 | Closed party of 4 at head, one member PLAYING | Skipped; returns null (A1). |
| T4 | Open solo at head, queue = [open solo, open party of 3] | Assigned together. (User's verified scenario.) |
| T5 | Open solo + open party of 3 + open party of 3 | Solo + first 3-party assigned; second 3-party untouched (overshoot avoided). |
| T6 | Open party of 2 + open party of 3 + open solo + open solo | Party-of-2 + the two solos assigned (skips 3-party as overshoot). |
| T7 | Open head + no fillers reachable | Returns null. Court stays empty. |
| T8 | B2 snap: Alice solo at t=5, Bob's party of 2 (t=10) adds Alice | Bob's party.queuedAt = 5 after add. |
| T9 | Closed party of 5 attempts to join SINGLES (cap=2) | Rejected at create/add time (C1). |
| T10 | Party member is a guest; party plays a match | Assignment ratingWeight = null; GBR sync skipped. |
| T11 | Concurrent `formNext` + `tickTimed` on same court | Only one succeeds (claim races; the other gets `CONFLICT` / retries). |
| T12 | Disband while WAITING | All live members' check-ins → LEFT; party derived state = DEFUNCT. |
| T13 | Disband while any member PLAYING | Rejected (BAD_REQUEST — can't disband mid-game). |
| T14 | Last member leaves WAITING | `leaveParty` is idempotent — party defunct after the last leave. |
| T15 | requeueParty after one member LEFT mid-game | Party re-queues with surviving IDLE members; LEFT member stays LEFT. |
| T16 | PAUSED session — try to createParty / addMember / setOpenToFill | All rejected (`BAD_REQUEST` "Session paused"). |
| T17 | Open solo head NOT ready (PLAYING) + open party of 3 at #2 | A1: skip the solo (temporal blocker), advance to party-of-3 as new head. Incomplete closed party → `null`. If party-of-3 were `openToFill` and combinable, it would assemble. |
| T18 | addPartyMember mid-selection race | The selection transaction's post-claim party-count check fails; transaction retries on next tick; new member's queued position inherits the party. |
| T19 | Guest in assignment + MATCH mode confirmScore | `ratingWeight = null`; `gbrSyncStatus` stays NOT_APPLICABLE (per §6 gate); GBR sync never queued. |
| T20 | Backfill on a session with live WAITING check-ins | Every existing check-in ends up with `partyId` pointing to a fresh `openToFill = true` party of 1. Behavior identical to pre-deploy. |
| T21 | Staff `addToQueue` with 6 unrelated walk-ins | 6 separate parties of 1 created, each `openToFill = true`, with staggered `queuedAt` preserved. They'll auto-mix into courts via the standard fill logic. |
| T22 | Composition: open head of 2 + open closed-3 + open closed-2 in DOUBLES | Skip closed-3 (overshoot of 5), combine head-2 + closed-2 = 4. Closed-3 keeps its place. |

---

## What this plan deliberately does NOT do

- Pixel-level UI design — that's a separate ticket once the data contract here lands.
- MIXED_DOUBLES gender enforcement (still documented but unimplemented; per owner decision).
- Persistent guest reconciliation (merging duplicate guests via the staff page).
- Cross-session guest analytics.
- Notification on being added to a party (deferred — UI ticket).
- The "Add guest" search UI affordances (deferred — UI ticket).

---

## Notes from adversarial review (2026-06-07)

An agent reviewed the first draft of this plan against the actual code on `dev`. Material changes applied:

- **Dropped `DropInPartyStatus` enum + `DropInParty.status` column.** State is derived from member `DropInCheckIn.status` at read time. Eliminates drift risk across the many existing sites that mutate member status (`endSlot`, `cancelAssignment`, `confirmScore`, `staffSetScore`, `tickTimed`, `endSession`).
- **`DropInCheckIn.partyId` is NOT NULL after backfill.** Removes a class of "loose check-in vs. party-of-1" branches everywhere.
- **`joinQueue` stays as the existing endpoint name** and continues to upsert. No silent breakage of the LEFT→re-join flow.
- **`addToQueue` wrapper creates one solo party per walk-in** (clarified: the "8" is a batch-size cap, not a party size). Behavior identical to today.
- **GBR sync gating in `confirmScore`/`staffSetScore` is a REQUIRED code change in this PR** (was a parenthetical "to verify"). Without it, guests leak to GBR.
- **`pickNextOccupants` distinguishes A1 (temporal blocker → advance) from combinatorial stall (→ leave court empty)**; both behaviors are explicit in §3 prose.
- **Race guard for `addPartyMember` mid-selection** added via post-claim party-count re-read.
- **Synthetic guest `clerkUserId` generation** specified: `` `guest_${createId()}` `` from `@paralleldrive/cuid2`.
- **`User.guestCreatedBy` has explicit `@relation`** (self-relation, opposite side `createdGuests`).
- **`getBoard.viewerUserId` preserved** in §7 (would have been a silent client break).
- **`tickTimed` is client-driven** (not a cron) — explicitly noted so future contributors don't expect server-side scheduling.

## Open questions for the owner

None right now — every fork has been resolved. Anything that arises during implementation will be added to `open-questions.md` against this feature ID before the PR is opened.

---

## Sign-off checklist

- [ ] Schema migration name + shape (§1) approved.
- [ ] tRPC procedure surface (§2) approved.
- [ ] `pickNextOccupants` algorithm (§3) approved.
- [ ] Party status transitions (§4) approved.
- [ ] Re-queue policy (§5) approved.
- [ ] GBR-suppression rule (§6) approved.
- [ ] `getBoard` shape change (§7) approved.
- [ ] Test matrix coverage (§8) approved.

Once checked, implementation proceeds on this branch. PR opens against `dev` per repo workflow.
