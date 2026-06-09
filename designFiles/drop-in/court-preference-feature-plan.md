# Drop-In — Per-Court Queue (Court Preference)

**Status:** Plan (2026-06-08). Owner decisions locked (below); no code written yet.
**Branch:** TBD off `dev` (suggest `feature/drop-in-court-preference`).
**Dependencies:** Existing drop-in models (`DropInSession`, `DropInCheckIn`, `DropInParty`, `DropInAssignment`), the party-aware picker `src/server/services/dropIn/pickNextOccupants.ts`, router `src/server/api/routers/dropIn.ts`, board UI `DropInEventDetails.tsx` + `dropin-ui.tsx`. Builds directly on the Group-Join feature ([group-join-feature-plan.md](./group-join-feature-plan.md)).
**Priority:** Medium — requested so players who prefer a specific court (location, show court, near the door) can queue for *that* court rather than the general pool.

---

## Overview

Today there is **one global waiting pool per session**. When a court frees up —
staff "Start next" (`formNext`, which already receives a `courtId`) or the TIMED
auto-rotation (`tickTimed`, which knows the expired `slot.courtId`) — the
party-aware picker `pickNextOccupants(parties, capacity)` selects the next
eligible group from that single pool, **court-agnostic**. Players never choose a
court.

This feature lets a **party** pin itself to **one specific court** (a "hard
lock"): that party is then only ever pulled onto that court. A party with no
preference (`preferredCourtId = null`) keeps today's behavior — eligible for any
court. It is purely additive and backward-compatible.

The change is small in surface but precise in the picker: when filling court `X`,
the candidate set is `parties WHERE preferredCourtId IS NULL OR preferredCourtId = X`,
and the existing fairness/fill logic runs unchanged on that filtered set. Hard
lock then falls out naturally — a party locked to court 1 is simply never a
candidate when court 3 frees.

---

## Locked decisions (owner, 2026-06-08)

| ID | Decision | Detail |
| :--- | :--- | :--- |
| **CP1** | **Hard lock**, not a soft preference. | A party pinned to court X is *only* pulled onto court X. It is never auto-pulled to any other court, even if that court is open and the party is next. |
| **CP2** | Preference is **party-level**, single value. | One `preferredCourtId` per party (a solo is a party of 1). Not per-member. |
| **CP3** | **Any party member** can set/change it. | Last write wins (it's a single party field). Guarded by `assertCallerInParty`, same as other party ops. |
| **CP4** | **One court, or "any."** | `preferredCourtId` is a single court id or `null` (= any court = today). No multi-court list in v1 (see Phase 2 / open questions). |
| **CP5** | **Players self-serve.** | Chosen at join time and changeable afterward from the party card. (Staff override is a possible later add — not in v1.) |
| **CP6** | **Any-court players can top up a locked court.** | When court X frees, a court-X-locked head can be filled by `openToFill` parties whose preference is `null` OR `X`. A party locked to a *different* court is never a filler for X. |
| **CP7** | **Starvation is accepted, surfaced in UI.** | A court-locked party can wait indefinitely if its court runs long / is monopolized. No auto-promotion in v1. The join UI states "You'll only be called for Court N." (Anti-starvation is Phase 2.) |
| **CP8** | **Court removed mid-session → reset to any.** | `removeCourt` sets `preferredCourtId = null` for any party pinned to the removed court, so they fall back to the general pool instead of being stranded. |
| **CP9** | **Set the court by tapping the court card, not a dropdown.** | Each court card gets a player-facing "Queue for Court N" button (a 3-state toggle, §4). "Join queue" stays = join the **general** (any-court) queue. No `<Select>` in the join flows; no court selector in the group popover. |

---

## 1. Schema changes

One migration: `add_drop_in_party_preferred_court`.

Add a single nullable column to `DropInParty`:

```prisma
model DropInParty {
  // ... existing fields ...
  // Hard court lock (court-preference feature). null = any court (default,
  // == today's behavior). When set, this party is ONLY eligible for the named
  // court in pickNextOccupants. Must be one of session.courtIds; reset to null
  // by removeCourt if that court leaves the session (CP8). Plain string, not a
  // relation — mirrors DropInSession.courtIds / DropInAssignment.courtId, which
  // are also plain ClubResource ids.
  preferredCourtId String?
}
```

- **Nullable, no backfill, no new enum.** Fully additive: existing parties and
  `joinQueue`/`createParty` callers default to `null` (any court).
- Not modeled as an FK relation, consistent with the existing `courtId` /
  `courtIds` columns (they reference `ClubResource.resourceId` by value).

---

## 2. Picker changes (`pickNextOccupants` + callers)

### 2.1 `PartySummary` gains the field

```ts
export interface PartySummary {
  // ... existing ...
  /** Hard court lock; null = any court. Filtered against the freeing court. */
  preferredCourtId: string | null;
}
```

`loadPartySummaries(tx, sessionId)` (in `party.ts`) selects `preferredCourtId`
and includes it on each summary.

### 2.2 `pickNextOccupants` takes the freeing court

```ts
pickNextOccupants(parties, capacity, courtId)   // courtId: the court being filled
```

As the **first step**, filter candidates to court-eligible parties:

```
eligible = parties.filter(p => p.preferredCourtId === null || p.preferredCourtId === courtId)
```

Then run the **existing** head/skip/fill/overshoot algorithm on `eligible`
unchanged. Ordering (pure FIFO by `queuedAt`, rule X) is preserved because the
filter keeps order. No other internal logic changes.

> Rationale for filtering inside the picker (vs. at the call site): keeps the
> "who can play court X right now" rule in one place and keeps the fill step from
> ever combining an ineligible party into a court-X game.

### 2.3 Callers pass the court (both already have it)

- `formNext` → `pickNextOccupants(parties, capacity, input.courtId)`
- `tickTimed` → `pickNextOccupants(parties, capacity, slot.courtId)`

No other rotation entry points exist.

---

## 3. API changes (`dropIn.ts`)

| Procedure | Change |
| :--- | :--- |
| **`setPartyPreferredCourt`** (new, `protectedProcedure`) | Input `{ partyId, courtId: string \| null }`. Guard `assertCallerInParty` (CP3) + `assertSessionAcceptsPartyOps` (ACTIVE only). Validate `courtId` is `null` or ∈ `session.courtIds` (reject otherwise). Update `party.preferredCourtId`. |
| **`createParty`** | **No change** under CP9 — the group is formed any-court, then locked via a court-card tap (`setPartyPreferredCourt`). (Skipped vs. the earlier dropdown design.) |
| **`joinQueue`** | Add optional `preferredCourtId`; set it on the solo party it creates. This is what the "Queue for Court N" button calls when the viewer isn't in the queue yet (CP9). Validate ∈ courtIds or null. |
| **`removeCourt`** | After removing the court, `updateMany` parties in the session with `preferredCourtId = removedCourtId` → set `null` (CP8). |
| **`getBoard` / `getPublicBoard`** | Include `preferredCourtId` in each entry of the returned `parties[]` (already derived via the shared `deriveBoardView`) so the UI can render the lock + selectors. |

Note: `getBoard`/`getPublicBoard` share `boardSessionInclude` + `deriveBoardView`
(added with the kiosk feature). `preferredCourtId` is a scalar on `DropInParty`,
so it's already loaded; just surface it in the mapped party object.

---

## 4. UI changes

**Primary interaction (CP9): tap the court card to lock to it.** Each court card
in `DropInEventDetails` gets a player-facing button whose label/action depends on
the viewer's current state:

| Viewer state | Button | Action |
| :--- | :--- | :--- |
| Not in queue | "Queue for Court N" | `joinQueue({ preferredCourtId: N })` (creates the solo party locked to N) |
| In queue, pref is `null` or another court | "Prefer Court N" | `setPartyPreferredCourt({ partyId, courtId: N })` |
| In queue, pref **is** N (active) | highlighted "Queued for Court N ✓" | tap again → `setPartyPreferredCourt({ partyId, courtId: null })` (toggle back to any) |
| Viewer currently `PLAYING` | (hidden) | — |

Court titles come from the existing `getResources` query already loaded by the
board. The button shows on **every** court card, occupied or empty (you can
queue for a court that's mid-game — you'll be called when it frees).

Other surfaces:

| Surface | Change |
| :--- | :--- |
| **Join queue (general)** — `DropInEventDetails` | Unchanged button = join the **any-court** pool (`joinQueue()` with no `preferredCourtId`). This is the explicit "I don't care which court" path. |
| **Join queue as a group** — `JoinPartyPopover` (`dropin-ui.tsx`) | **No court selector.** Form the group (any-court); then any member taps a court card to lock the whole party (CP3). Keeps the popover simple. |
| **Your party card** — `YourPartyCard` (`dropin-ui.tsx`) | Show the current lock ("Court 3 only" / "Any court"). Changing it is done via the court-card buttons above; the card just reflects state (optionally a "clear" link). |
| **Queue list** — `QueueByParty` (`dropin-ui.tsx`) | Render a **"Court N only"** chip on rows where `preferredCourtId` is set, next to the existing "open to anyone" / "needs N more" chips. |
| **Copy** | A one-line hint near the court buttons: "You'll only be called for this court" (CP7). |

Kiosk (`KioskBoard.tsx`) is read-only — it just renders the new chip via the
shared `QueueByParty`; no court buttons.

---

## 5. Edge cases & how they resolve

- **Court-locked party can't fill alone** (e.g. 2 people want court 3, DOUBLES
  needs 4): the picker tops up from `openToFill` parties whose preference is
  `null` or `3` (CP6). If everyone else is locked to a *different* court, court 3
  **sits empty** until the queue shape changes — the next tick retries. (Same
  "court stays empty if no clean fill" rule already in the picker.)
- **Starvation** (CP7): a locked party waits indefinitely if its court is
  monopolized. Accepted in v1; surfaced in copy. Phase 2 may auto-promote to
  "any" after N minutes or alert staff.
- **Court removed** (CP8): `removeCourt` resets pinned parties to `null`.
- **SINGLES** (capacity 2): unaffected — the eligibility filter is independent of
  capacity; the existing capacity rules still apply within the filtered set.
- **Preference set while PLAYING**: harmless — the picker only considers WAITING
  parties; the new value simply applies the next time the party is in the pool.
- **Interaction with `openToFill`**: orthogonal. `openToFill` decides whether a
  party can be *combined*; `preferredCourtId` decides *which court* it's eligible
  for. A `null`-court open party combining into a court-3 head ends up playing on
  court 3 — acceptable, since "any court" includes court 3.

---

## 6. Field registry (for cross-file consistency)

| Field | Type | Where | Meaning |
| :--- | :--- | :--- | :--- |
| `preferredCourtId` | `String?` | `DropInParty` (schema, DB) | Hard court lock; `null` = any court. One of `DropInSession.courtIds` when set. |
| `preferredCourtId` | `string \| null` | `PartySummary` (`pickNextOccupants.ts`) | Same value, carried into the picker. |
| `preferredCourtId` | `string \| null` | `getBoard`/`getPublicBoard` `parties[]` | Surfaced to the client for chips + selectors. |
| `courtId` | `string \| null` | input of `setPartyPreferredCourt`, `joinQueue` | The court the caller is pinning to (or `null` to clear / "any"). |

> Single canonical name **`preferredCourtId`** everywhere it's stored/returned;
> the mutation *inputs* use `courtId` (the thing being chosen). Keep these two
> distinct so a grep for `preferredCourtId` finds the stored field only.

---

## 7. Phasing

- **Phase 1 (this plan):** schema column + migration; picker filter + caller
  wiring; `setPartyPreferredCourt`; optional `preferredCourtId` on
  `joinQueue`/`createParty`; `removeCourt` reset; board payloads; UI selectors +
  chip; picker tests.
- **Phase 2 (later, see open questions):** multiple preferred courts ("any of
  2 & 3"); per-court "N waiting for this court" counts under each court card;
  anti-starvation (auto-promote after N minutes or staff alert); staff override
  of a party's court.

---

## 8. Test plan (extends `pickNextOccupants.test.ts`)

- Court-locked party is **excluded** when filling a different court.
- Court-locked party is **selected** when filling its court.
- `null`-court (any) party is selected for **any** court.
- Court X frees, only other-court-locked parties remain → **empty** (returns
  `null`).
- Court-X head of 2 + a `null`-court open solo → **filled** on court X (CP6).
- Court-X head of 2 + only a court-Y-locked open solo → **not** filled (empty).
- Ordering preserved: among eligible parties, FIFO by `queuedAt` (rule X).

---

## 9. Open questions for owner

1. **Anti-starvation:** leave as pure hard-lock (CP7) for now, or add a Phase-2
   auto-promote-to-any after N minutes? (Affects whether we add a `pinnedAt`
   timestamp now to avoid a later migration.)
2. **Per-court waiting visibility:** do players/staff want a "3 waiting for
   Court 2" readout under each court card, or is the per-row chip enough for v1?
3. **Staff override:** should staff be able to set/clear a party's court (e.g.
   to unstick a starved queue), or is self-serve-only fine for v1?
