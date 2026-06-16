# Drop-In — Group Join (Parties)

**Status:** SHIPPED + cleaned up (2026-06-11). This doc describes what is live
on `dev`, not a proposal.
**History:** Built on `feature/drop-in-group-join` (merged 2026-06-08, demoed
same week). The original plan also shipped a guest-user model (User rows with
`isGuest=true`, GBR suppression, createGuest/searchGuests procedures); it never
got a UI entry point and was **cut entirely on 2026-06-11** — schema columns
dropped (`20260611000000_drop_guest_columns`), procedures and plumbing deleted.
Drop-in players are logged-in club members, full stop.
**Dependencies:** Drop-in models (`DropInSession`, `DropInCheckIn`,
`DropInAssignment`), router `src/server/api/routers/dropIn.ts`, services in
`src/server/services/dropIn/`. Court preference is layered on top
([court-preference-feature-plan.md](./court-preference-feature-plan.md)).

---

## Overview

A **party** is a group of 1+ players who hold a single queue slot together.
Every `DropInCheckIn` belongs to exactly one party (`partyId` NOT NULL — a solo
is a party of 1). Parties are either:

- **Closed** (`openToFill = false`): plays only when its WAITING-member count
  equals the court's capacity. Incomplete → holds its position.
- **Open** (`openToFill = true`): combinable with other open parties at
  court-assignment time. Solo `joinQueue` creates an open party of 1.

Selection is pure party-FIFO by `party.queuedAt` (rule X). `gamesPlayed` /
`lastPlayedAt` fairness does not order parties.

## Who can be added to a party

Adding requires only: target has an account, **same club** as the caller,
session ACTIVE, party under capacity. The target does **not** need to be
registered for the event or already checked in — `addPartyMember` creates a
fresh check-in for first-timers. The member search (`searchPartyMembers`) is
**club-wide** (originally roster-scoped; widened during demo prep because you
couldn't add a friend who hadn't independently joined).

**Accepted divergence from the original plan:** if the target is already in
another party, `addPartyMember` **moves** them (original plan said reject).
Adds are idempotent — re-adding an existing member is a no-op, not an error.

## Settled decisions (still binding)

| ID | Decision |
| :--- | :--- |
| A1 | Head party not ready (member mid-game) → skip; party keeps its position. |
| B2 | Adding a solo who queued earlier snaps `party.queuedAt = MIN(party, member)`. |
| C1 | Party larger than court capacity → reject at create/add time. |
| D1 | Held parties wait indefinitely; manual removal only. |
| X | Party ordering is pure FIFO by `party.queuedAt`. |
| — | No party leader; any member can add/remove/toggle/leave. Staff can manage any party in their club. |
| — | Parties are atomic — never split across courts. Overshoot → skip & scan. No clean fill → court stays empty. |
| — | PAUSED sessions reject all party mutations. |
| — | **Parties re-queue as a unit** (owner, 2026-06-11): after a game, one tap on "Requeue group" re-queues every IDLE member under one fresh queue position. Individuals re-queue solo only by leaving the party first. |

## Schema (live)

- `DropInParty`: `partyId`, `sessionId` (cascade), `openToFill`, `queuedAt`,
  `preferredCourtId` (court-preference feature), `createdByUserId`, timestamps.
  **No status column** — party state is derived at read time from members'
  `DropInCheckIn.status` (WAITING / PLAYING / AWAITING_RESULT / DEFUNCT).
- `DropInCheckIn.partyId` NOT NULL, `onDelete: Restrict`. Disband = flip
  members to LEFT (party row stays for audit; defunct once no live members).
- Migrations: `20260608010000_add_drop_in_party_and_guest` (backfilled one
  open party per pre-existing check-in), `20260608170000_..._preferred_court`,
  `20260611000000_drop_guest_columns` (guest cut).

## tRPC surface (live, with UI callers)

| Procedure | Auth | UI |
| :--- | :--- | :--- |
| `joinQueue` | member | "Join queue" — upserts check-in; fresh solo open party if none. |
| `createParty` | member | "Join queue as a group" popover (default **closed**). |
| `addPartyMember` | member | Add-member search (club-wide). Creates target's check-in if needed; moves between parties; idempotent. |
| `joinExistingParty` | member | One-click "Join this group" on open incomplete parties. |
| `leaveParty` | member | "Leave party" on the Your Party card. |
| `setPartyOpenToFill` | member | "Lock party" / "Open to fill" toggle. |
| `setPartyPreferredCourt` | member | Court-lock chip (court-preference plan). |
| `requeueParty` | member | "Requeue group (N)" after a game + "Rejoin queue" (AWAITING_RESULT). Flips all IDLE members → WAITING, `party.queuedAt = now`. |
| `removePartyMember` | member **or club staff** | Staff ✕ on a party-row member pill (member self-removal UI is leaveParty). |
| `disbandParty` | member **or club staff** | Staff "Disband" button on party rows. |
| `searchPartyMembers` | member | Typeahead behind the add flows (club-wide, names only). |
| `addToQueue` | facility | Staff bulk walk-in add — one open solo party per userId. |

Staff access to remove/disband = `isClubStaff()` bypass of the
party-membership guard (same-club still enforced). Added 2026-06-11; before
that the two procedures existed but had no callers.

`rejoin` (individual IDLE→WAITING) was **deleted** 2026-06-11 — superseded by
`requeueParty`, which is identical for a party of 1.

## Selection: `pickNextOccupants`

Pure function in `src/server/services/dropIn/pickNextOccupants.ts`, shared by
`formNext`, `rotateExpiredSlots` (TIMED read-repair on board reads), and MATCH auto-start. Walks parties in FIFO order
(optionally pre-filtered by `preferredCourtId` for the target court):

- Head not ready (member PLAYING/AWAITING_RESULT, or no WAITING members) →
  **skip, try next head** (temporal blocker — time fixes it).
- Closed head: WAITING-count must equal capacity exactly, else hold + try next.
- Open head: greedily fill with later open ready parties, skipping overshoots.
  Exact fill → pick. No clean fill → **return null, court stays empty**
  (combinatorial stall — only a queue-shape change fixes it; do NOT punish the
  head by advancing past it).

Callers claim atomically (`updateMany WHERE status=WAITING`, verify count) and
re-read party member counts post-claim to catch a concurrent `addPartyMember`
(abort + retry next tick). `ratingWeight` is mode-based: TIMED → null (never
synced to GBR), MATCH → 1.0.

## Tests

- Unit: `pickNextOccupants.test.ts` (host vitest) — selection matrix incl.
  court preference.
- Integration: `dropIn.party.integration.itest.ts` — DB-coupled procedure
  tests (B2 snap, C1, disband/leave, requeueParty, PAUSED guards, addToQueue).
  Runs via `npm run test:integration` (docker-execs into the dev app
  container). **Not part of the host `npm test` run.**

## Known gaps / non-goals

- MIXED_DOUBLES gender enforcement: out of scope (owner).
- No notification when someone adds you to a party.
- Guests / non-account players: **cut** (see History). If walk-ins ever come
  back, prior art is in git history at `d574e52` and earlier on this doc.
