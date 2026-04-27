# Conflict Checking and RRULE Expansion

**Audience:** future engineers and AI agents reading this codebase fresh.
**Purpose:** explain how the system detects scheduling conflicts on shared resources (courts, rooms), with particular attention to how recurring events are expanded into concrete occurrences for conflict checks.

---

## TL;DR

When code asks "is this resource available from `start` to `end`?", `checkResourceConflicts()` returns conflicts from **both**:
1. Non-recurring blocking events that overlap the window.
2. Occurrences of recurring blocking events whose expanded instance overlaps the window.

The expansion uses **rrule.js's `RRuleSet`** (not bare `RRule`) so exception dates and modified-instance overrides are honored. The function is called by every flow that places something on a resource: court bookings, calendar event creation, calendar event updates.

If a conflict is found, callers throw a `TRPCError` with a human-readable message naming the conflicting event and its time. **The frontend forms catch these errors and show toasts** — see "How errors surface to the user" below.

---

## Why this design exists

Originally, `checkResourceConflicts` filtered `WHERE rrule IS NULL` — recurring events were invisible. That meant a member could book a court during a recurring class, and staff could schedule a one-off on top of a weekly class. See `designFiles/calendaring/recurrence-strategy.md` for the original recurrence model and `HANDOFF` decision #46 (gitignored, local) for the deferral note.

The fix shipped in two tiers:
- **Tier A (current state, 2026-04-23):** single-occurrence checks see recurring events. Covers the high-frequency member-facing scenarios (booking a slot, creating a one-off event).
- **Tier B (planned, not yet shipped):** the *new* event being created can itself be recurring; we expand its rrule and check each occurrence. Covers the staff-side recurring-vs-recurring case.

Full design and decisions: `designFiles/roadmap/cr-c-server-side-rrule-expansion.md` (gitignored).

---

## Files involved

### Core utilities

| File | Role |
|---|---|
| `src/server/utils/rrule.ts` | Single source of truth for parsing a stored rrule string + exdates into an `RRuleSet`. Exports `buildRuleSetFromEvent(rruleString, exdates, fallbackDtstart)`. |
| `src/server/utils/resourceConflicts.ts` | The `checkResourceConflicts()` function. Two-branch design: non-recurring SQL match + recurring expansion in app code. Returns `ResourceConflict[]`. |
| `src/server/utils/dateUtils.ts` | `formatEventTimeInZone()` — formats start/end times in a facility's timezone for error messages. Optionally includes the date (used when the conflict is a recurring occurrence and "6 PM" alone is ambiguous about which day). |

### Callers (where conflict checking is triggered)

| File:Line | Flow | What it does on conflict |
|---|---|---|
| `src/server/api/routers/rentals.ts` `validateAndCreateBooking` | Member books a court rental slot. | Throws `TRPCError({ code: "CONFLICT" })` with the new message format. Caught by `RentalBookingForm.tsx` mutation → toast. |
| `src/server/api/routers/rentals.ts` `getRentalAvailability` | Public availability lookup for a rental window. | Returns conflicts as part of `blockingEvents`; per-slot loop marks slots as `isAvailable: false`. No toast (display-only). |
| `src/server/api/routers/calendar.ts` `createEvent` | Staff creates any calendar event (BLOCK / BOOKABLE / COACHING_SLOT). | Throws `TRPCError({ code: "CONFLICT" })`. Caught by `EventFormModal.tsx` and `CalendarClient.tsx` mutation `onError` → toast. |
| `src/server/api/routers/calendar.ts` `updateEvent` | Staff edits a calendar event (drag/drop or modal save). | Same as createEvent. |

### Schema fields involved

In `prisma/schema.prisma`:
- `CalendarEvent.rrule String?` — the RFC 5545 rule string (without DTSTART; we anchor to `start` instead).
- `CalendarEvent.exdates Date[]` — list of dates explicitly excluded from the rule.
- `CalendarEvent.recurrenceId String?` — on a *modified instance* (i.e. a one-off override of a recurring occurrence), this is the ISO timestamp of the original occurrence date this row replaces.
- `CalendarEvent.parentEventId String?` — modified instances point to their recurring parent via this FK.
- `CalendarEvent.isBlocking Bool` — only `true` events block other events. RENTAL_WINDOW = false (it's an availability container, not a blocker). RENTAL_BOOKING = true. COACHING_SLOT = false (per `calendar.ts:1047`, hardcoded so coaches sharing a court don't block each other).
- `CalendarEvent.isDeleted Bool` — soft-delete flag. Conflict checker skips `isDeleted: true` events.

---

## How recurring expansion works

Conceptually, a recurring blocking event is a series anchored at `(start, end)` that repeats according to `rrule`. To check "does this series have an occurrence overlapping `[queryStart, queryEnd]`?", we:

1. Parse the rrule string with `RRule.fromString()`.
2. Build a fresh `RRule` with the parsed options + `dtstart = base.start` (the event's own start time, since stored rrule strings don't include `DTSTART`).
3. Wrap that `RRule` in an `RRuleSet`.
4. Add **combined exdates** to the set:
   - `base.exdates` (explicit exceptions stored on the base event)
   - The `recurrenceId` of every **non-deleted** modified-instance child (events with `parentEventId = base.eventId, isDeleted: false`)
5. Call `set.between(queryStart - durationMs, queryEnd, inclusive=true)` to get occurrence start dates that may overlap the window. The look-back by `durationMs` catches occurrences that started *before* `queryStart` but extend *into* the window.
6. For each candidate, compute `occurrenceEnd = occurrenceStart + durationMs` and final-overlap-check against `[queryStart, queryEnd]`.

`durationMs` is computed **per base event** as `base.end - base.start`. Each series may have a different occurrence length.

### Why combined exdates?

Two distinct things produce "skip this date in the parent series":

- **Explicit exclusion** — staff "deletes this occurrence" via scope=THIS in the calendar UI. Code in `calendar.ts` (search "exdates" — adds `instanceDate` to `base.exdates`).
- **Modification** — staff drags a single occurrence to a new time. The system creates a child row with `parentEventId = base.eventId` and `recurrenceId = <original date>`. The parent's expansion *should not* yield that occurrence (the child takes its place). Adding the child's `recurrenceId` to the exdate set for expansion accomplishes this.

### Why only **non-deleted** children count?

The calendar's client-side render (in `CalendarClient.tsx`) uses only `base.exdates` for ilamy expansion. If a modified-instance child is soft-deleted, the calendar shows the parent's original occurrence at the original time — the deletion just removes the *override*, not the underlying occurrence. The conflict checker matches that behavior: soft-deleted children fall away, the parent's occurrence becomes visible to the checker again.

### Defensive guard

A row with both `parentEventId != null` AND `rrule != null` shouldn't exist — modifications are single-occurrence overrides — but the schema doesn't forbid it. If `checkResourceConflicts` encounters one, it logs a warning and skips the recurring-expansion branch for it. See decision CR-c.11 in the design doc.

---

## How errors surface to the user

**Yes, all conflict errors result in toast notifications on the frontend.** Specifically:

| Backend mutation | Frontend file | onError handler |
|---|---|---|
| `rentals.bookRentalSlot` | `src/app/(app)/rentals/RentalBookingForm.tsx` (`bookMutation`) | `toast(err.message, "error")` |
| `calendar.createEvent` | `src/app/(app)/calendar/EventFormModal.tsx` (`createMutation`) and `CalendarClient.tsx` (`createEventMutation`) | `toast(err.message, "error")` |
| `calendar.updateEvent` | Same two files (drag/drop in CalendarClient, slide-over save in EventFormModal) | `toast(err.message, "error")` |

The error message format is one of:
- `Blocked by "Beginner Clinic" (6:00 – 8:00 PM)` for non-recurring conflicts (date is implied by what staff was creating).
- `Blocked by "Beginner Clinic" on Tue, May 5 (6:00 – 8:00 PM)` for recurring conflicts (date is essential — "6 PM" alone doesn't say *which* Tuesday).

Times render in the facility's timezone (`ClubFacility.timezone`, default `America/New_York`).

For `getRentalAvailability` (the public availability page at `/rentals`), there's no error — conflicts simply mark slots as unavailable in the dropdown UI.

---

## Performance notes

- **Tier A is naturally bounded.** A single-event check (e.g. a 1-hour booking) expands each existing recurring series only within that 1-hour window — at most a handful of occurrences per series. Even with dozens of weekly classes on the same court, each `RRuleSet.between()` call is small.
- **`getRentalAvailability` is the hot path.** It calls `checkResourceConflicts` once per court for the *entire window* (e.g. 5 hours). The per-slot loop intersects in-memory afterward — no per-slot DB calls.
- **Modified-instance children are batched** in `checkResourceConflicts`: one `findMany({ parentEventId: { in: [...] } })` rather than N queries (one per base). Avoided the N+1 from day one.
- **Series whose dtstart is in the future** are filtered out at the SQL layer via `start: { lt: end }` — they can't possibly have occurrences overlapping a past-or-current window.

---

## When you'd touch this code

- **Adding a new event type that should block resources:** ensure `isBlocking: true` is set when creating the event. The conflict checker will pick it up automatically.
- **Adding a new caller** (a new mutation that places something on a resource): import `checkResourceConflicts`, call with `db, resourceId, start, end`, throw the same `Blocked by "..."` style error if `conflicts.length > 0`. Use `formatEventTimeInZone` for the message.
- **Changing how exdates are stored or how modifications work:** update both the calendar's UI render path (`CalendarClient.tsx` ilamy props) AND the conflict checker's combined-exdate logic. The two must stay in sync — if the calendar shows an occurrence as "live" but the conflict checker treats it as "excluded", you get silent double-bookings.
- **Implementing Tier B (recurring-event-vs-existing-events check):** add a `checkRecurringEventConflicts(...)` function alongside `checkResourceConflicts`. Wire into `createEvent` / `updateEvent` / `createRentalWindow` / `updateRentalWindow` when a rrule is set or changes. See `designFiles/roadmap/cr-c-server-side-rrule-expansion.md` for the full plan.

---

## Related docs

- `designFiles/calendaring/recurrence-strategy.md` — how recurring events are stored and rendered (client-side rrule expansion via ilamy).
- `designFiles/calendaring/database-schema.md` — full CalendarEvent schema reference.
- `designFiles/calendaring/api-design.md` — calendar router endpoint reference.
- `designFiles/roadmap/cr-c-server-side-rrule-expansion.md` (gitignored) — the design doc that drove the Tier A implementation, including all locked decisions (CR-c.1 through CR-c.13) and Tier B plans.
