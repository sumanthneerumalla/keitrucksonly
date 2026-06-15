# ⚠️ INCOMPLETE — Multi-court conflict detection (partial fix shipped; comprehensive fix still open)

**Status:** **PARTIAL / NOT DONE.** A first slice landed in `triaged-items` (`9bf086f`) that fixes the
*non-recurring* path, but the recurring path, regression tests, and the data-model unification are still
outstanding. **Do not close this TODO until the acceptance criteria at the bottom are all met.**

> History note: an earlier triage pass marked this file "✅ DONE" after `9bf086f`. That was premature — it
> only covered `checkResourceConflicts` (the non-recurring branch). The recurring path was not converted and
> no tests were added. Reverted to OPEN on 2026-06-15.

## Context

Casual drop-in / "open play" is modeled as a **normal `BOOKABLE` `CalendarEvent` that reserves multiple courts**
(primary `resourceId` + additional `resourceIds`) — see the drop-in decision in [README.md](./README.md) /
[HANDOFF.md](./HANDOFF.md). Bookable events are **blocking** (`isBlocking = true`), so reserving N courts should
prevent anyone else from booking those courts in the same window.

## ✅ What landed so far (`9bf086f`, non-recurring path only)

`checkResourceConflicts` in `src/server/utils/resourceConflicts.ts` now matches an existing event that holds the
court as **either** its primary `resourceId` **or** an extra court in `resourceIds[]`, on **both** query branches:

```ts
OR: [{ resourceId }, { resourceIds: { has: resourceId } }]   // lines ~105 and ~131
```

Combined with the caller looping the check over every court the *new* event holds (`[resourceId, ...resourceIds]`
in `createEvent` / `updateEvent`), a **non-recurring** multi-court Bookable event now correctly conflicts against
another event's **additional** courts. That specific double-book hole is closed.

## ❌ What is still broken / unverified (this is why the TODO stays open)

1. **Recurring path not converted.** `checkRecurringEventConflicts`
   (`src/server/utils/resourceConflicts.ts`, ~line 315) accepts a **single `resourceId`** and calls
   `checkResourceConflicts` once per occurrence with that single court (line ~380). It was **not** widened to
   accept `resourceIds[]`. So a **recurring** multi-court event is only conflict-checked on whichever single
   court the caller passes. Until the caller is confirmed to loop `[resourceId, ...resourceIds]` over
   `checkRecurringEventConflicts` (audit `createEvent`/`updateEvent` for the RECURRING branch), recurring
   multi-court events can still double-book on their extra courts.
   - **Fix:** either widen `checkRecurringEventConflicts` to take `resourceIds[]` and loop internally, or
     have the recurring caller loop the per-court call the same way the non-recurring caller does — then prove it.

2. **No regression tests.** The acceptance cases below are unverified by CI. The module is hardened and
   widely used (CR-c), so the fix needs tests for: single-court vs multi-court, recurring vs non-recurring,
   and the "existing event holds the court as an *extra*" case — in both the recurring and non-recurring paths.

3. **Caller audit incomplete.** Every caller of both functions (createEvent, updateEvent, rentals, drop-in)
   should be re-checked for the single-court assumption, especially the recurring-occurrence expansion.

## The proper (comprehensive) fix

- Convert **`checkRecurringEventConflicts`** to the same `OR`-match / multi-court loop as the non-recurring path.
- Audit **every caller** + the recurring-occurrence expansion logic for the single-court assumption.
- Add **regression tests** covering all four quadrants (single/multi × recurring/non-recurring) plus the
  extra-court-on-existing-event case.
- Then (separately) the data-model unification below.

## Acceptance for closing this TODO (NOT yet met)

- [x] Non-recurring multi-court event conflicts against another event's **additional** courts.
- [ ] **Recurring** multi-court event conflicts against another event's additional courts (recurring path widened **or** caller-loop proven).
- [ ] Existing single-court behavior unchanged — **regression-tested**.
- [ ] Tests cover single/multi × recurring/non-recurring + extra-court-on-existing-event.

---

## Future: unify event→court storage (deferred 2026-06-07, owner)

Today an event holds courts in **two** fields: `resourceId` (FK-backed primary, indexed, `resource` relation) +
`resourceIds` (`String[]`, additional). We'd like one source of truth, but **not** a bare `resourceIds[]` — a
`String[]` has no foreign key, so dropping `resourceId` loses referential integrity (dangling IDs when a court is
deleted) and breaks the ~20 `include: { resource }` sites + ~15 `where: { resourceId }` filters.

**Preferred path:** add a `CalendarEventResource(eventId, resourceId)` **join table** (real FKs + cascade,
many-to-many); backfill from `resourceId` ∪ `resourceIds`; migrate reads/queries/conflict-checks + move facility
filters to `event.facilityId`; then drop `resourceId` + `resourceIds`. Deferred — touches ~10 files and is
integrity-sensitive; do as its own project. (The conflict-detection fix above is independent and can land first.)
