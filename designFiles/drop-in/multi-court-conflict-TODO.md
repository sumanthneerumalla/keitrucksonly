# ⚠️ OPEN — Multi-court conflict detection is UNIMPLEMENTED (needs a comprehensive fix)

**Status:** **NOT DONE.** A quick `OR`-filter shortcut was tried (`9bf086f`) and then **reverted on 2026-06-15**
because it was a half-measure that masked the real problem (it only patched the non-recurring branch, left the
recurring path single-court, and shipped with no tests). `src/server/utils/resourceConflicts.ts` is back to its
original single-`resourceId` matching. **Do not re-apply the shortcut.** This gap is closed only by the
comprehensive fix described below.

> History: `9bf086f` added `OR: [{ resourceId }, { resourceIds: { has: resourceId } }]` to `checkResourceConflicts`
> and an earlier pass marked this file "✅ DONE". That was wrong on two counts — the recurring-path checker
> (`checkRecurringEventConflicts`) was never converted, and there were no regression tests. Reverted so the
> codebase doesn't carry a misleading partial implementation.

## Context

Casual drop-in / "open play" is modeled as a **normal `BOOKABLE` `CalendarEvent` that reserves multiple courts**
(primary `resourceId` + additional `resourceIds`) — see the drop-in decision in [README.md](./README.md) /
[HANDOFF.md](./HANDOFF.md). Bookable events are **blocking** (`isBlocking = true`), so reserving N courts should
prevent anyone else from booking those courts in the same window.

## The gap (current behavior)

`checkResourceConflicts` (and `checkRecurringEventConflicts`) in `src/server/utils/resourceConflicts.ts` find
**existing** events by matching their **single `resourceId` column only**:

```ts
where: { resourceId, isBlocking: true, ... }
```

They do **not** match events that hold a court via their `resourceIds[]` array. Consequence:

- ✅ A new multi-court event **is** checked against any event whose **primary** court overlaps.
- ❌ A new multi-court event is **NOT** checked against another event's **additional** (`resourceIds`) courts.
  So **two multi-court Bookable events that share an *extra* court can be double-booked** without a conflict error.

(This is why Rental Window — the original multi-court feature — sidesteps `createEvent`'s guard entirely and runs
its own booking-time conflict logic; it leaves the primary `resourceId` null.)

## Why the shortcut was not enough

The `OR`-filter on `checkResourceConflicts` alone is not a real fix because:

1. **The recurring path is separate.** `checkRecurringEventConflicts` (~line 315) accepts a single `resourceId`
   and calls `checkResourceConflicts` per occurrence. It was never widened for multi-court, so recurring
   multi-court events still double-book on extra courts.
2. **No tests.** The module is hardened and widely used (CR-c); a change with no regression coverage is unsafe.
3. **The data model is the root cause.** As long as courts live in two fields (`resourceId` + `resourceIds[]`),
   every reader/filter/conflict-check has to remember to handle both — the bug will keep recurring. The real
   fix unifies storage (see below).

## The comprehensive fix (do this, not the shortcut)

1. **Unify event→court storage first** (the "Future" section below): add a `CalendarEventResource(eventId, resourceId)`
   join table with real FKs + cascade, backfill from `resourceId ∪ resourceIds`, migrate reads/queries/filters, then
   drop `resourceId` + `resourceIds`. One source of truth removes the whole class of "forgot to check resourceIds" bugs.
2. **Rewrite both conflict checkers** (`checkResourceConflicts` and `checkRecurringEventConflicts`) against the join
   table so any court an event holds participates in conflict detection, recurring and non-recurring alike.
3. **Audit every caller** (createEvent, updateEvent, rentals, drop-in) + the recurring-occurrence expansion for the
   old single-court assumption.
4. **Add regression tests** covering all four quadrants (single/multi × recurring/non-recurring) plus the
   "existing event holds the court as an *extra*" case.

## Acceptance for closing this TODO (none met yet)

- [ ] Court storage unified behind a single FK-backed source of truth (join table).
- [ ] Non-recurring multi-court event conflicts against another event's additional courts.
- [ ] **Recurring** multi-court event conflicts against another event's additional courts.
- [ ] Existing single-court behavior unchanged — **regression-tested**.
- [ ] Tests cover single/multi × recurring/non-recurring + extra-court-on-existing-event.

---

## Future: unify event→court storage (deferred 2026-06-07, owner) — now a PREREQUISITE for the fix above

Today an event holds courts in **two** fields: `resourceId` (FK-backed primary, indexed, `resource` relation) +
`resourceIds` (`String[]`, additional). We'd like one source of truth, but **not** a bare `resourceIds[]` — a
`String[]` has no foreign key, so dropping `resourceId` loses referential integrity (dangling IDs when a court is
deleted) and breaks the ~20 `include: { resource }` sites + ~15 `where: { resourceId }` filters.

**Preferred path:** add a `CalendarEventResource(eventId, resourceId)` **join table** (real FKs + cascade,
many-to-many); backfill from `resourceId` ∪ `resourceIds`; migrate reads/queries/conflict-checks + move facility
filters to `event.facilityId`; then drop `resourceId` + `resourceIds`. Touches ~10 files and is integrity-sensitive;
do as its own project. The conflict-detection fix should be built on top of this, not bolted onto the dual-field model.
