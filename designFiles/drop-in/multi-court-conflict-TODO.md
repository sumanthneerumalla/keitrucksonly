# ✅ DONE — Multi-court conflict detection fix (shipped 2026-06-09)

**Status:** Fixed in `triaged-items` branch. Both `resourceId` and `resourceIds` are now checked in `checkResourceConflicts` (Branches 1 + 2), so a court reserved as an "extra" court on a multi-court Bookable event correctly blocks conflicting bookings.

## Context

Casual drop-in / "open play" is modeled as a **normal `BOOKABLE` `CalendarEvent` that reserves multiple courts** (primary `resourceId` + additional `resourceIds`) — see the drop-in decision in [README.md](./README.md) / [HANDOFF.md](./HANDOFF.md). Bookable events are **blocking** (`isBlocking = true`), so reserving N courts should prevent anyone else from booking those courts in the same window.

## What was shipped (the quick version)

`createEvent` and `updateEvent` (`src/server/api/routers/calendar.ts`) now **loop the existing conflict check over every court** the event holds (`[resourceId, ...resourceIds]`, deduped) instead of only the primary `resourceId`. The modal (`EventFormModal.tsx`) shows the existing multi-court picker for BOOKABLE as optional "Additional courts."

## The gap

`checkResourceConflicts` (and `checkRecurringEventConflicts`) in `src/server/utils/resourceConflicts.ts` find **existing** events by matching their **single `resourceId` column only**:

```ts
where: { resourceId, isBlocking: true, ... }
```

They do **not** match events that hold a court via their `resourceIds[]` array. Consequence:

- ✅ A new multi-court event **is** checked against any event whose **primary** court overlaps.
- ❌ A new multi-court event is **NOT** checked against another event's **additional** (`resourceIds`) courts. So **two multi-court Bookable events that share an *extra* court can be double-booked** without a conflict error.

(This is why Rental Window — the original multi-court feature — sidesteps `createEvent`'s guard entirely and runs its own booking-time conflict logic; it leaves the primary `resourceId` null.)

## The proper fix (when prioritized)

Extend `checkResourceConflicts` + `checkRecurringEventConflicts` to match a court on **either** side:

```ts
where: {
  OR: [{ resourceId: court }, { resourceIds: { has: court } }],
  isBlocking: true,
  ...
}
```

…and audit every caller / the recurring-occurrence expansion logic (Tier B) for the same single-court assumption. This touches a hardened, widely-used module (CR-c), so it needs careful tests for: single-court vs multi-court, recurring vs non-recurring, and existing-event-holds-court-as-extra cases.

## Acceptance for closing this TODO

- Creating/editing a multi-court event conflicts correctly against another event's **additional** courts (not just its primary).
- Existing single-court behavior unchanged (regression-tested).

---

## Future: unify event→court storage (deferred 2026-06-07, owner)

Today an event holds courts in **two** fields: `resourceId` (FK-backed primary, indexed, `resource` relation) + `resourceIds` (`String[]`, additional). We'd like one source of truth, but **not** a bare `resourceIds[]` — a `String[]` has no foreign key, so dropping `resourceId` loses referential integrity (dangling IDs when a court is deleted) and breaks the ~20 `include: { resource }` sites + ~15 `where: { resourceId }` filters.

**Preferred path:** add a `CalendarEventResource(eventId, resourceId)` **join table** (real FKs + cascade, many-to-many); backfill from `resourceId` ∪ `resourceIds`; migrate reads/queries/conflict-checks + move facility filters to `event.facilityId`; then drop `resourceId` + `resourceIds`. Deferred — touches ~10 files and is integrity-sensitive; do as its own project. (The conflict-detection fix above is independent and can land first.)
