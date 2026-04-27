import type { Prisma, PrismaClient } from "@prisma/client";
import { buildRuleSetFromEvent } from "~/server/utils/rrule";

type TxClient = Prisma.TransactionClient | PrismaClient;

/**
 * One conflicting event/occurrence on a resource. The shape is intentionally flat
 * so callers can format error messages directly without joining back to anything.
 *
 * For non-recurring events: `start` and `end` are the event's stored times.
 * For recurring events: `start` and `end` are the OCCURRENCE that conflicts (NOT the
 * series anchor). `eventId` is still the base series — callers who need to navigate
 * back to the row can do so, but they should display occurrence times in errors.
 *
 * `isRecurringOccurrence` lets callers decide whether to include a date in the
 * error message: a single occurrence on, say, "Tue May 5" is ambiguous without
 * the date when the conflict source is a weekly recurring class. CR-c.2.
 */
export type ResourceConflict = {
	eventId: string;
	title: string;
	start: Date;
	end: Date;
	isRecurringOccurrence: boolean;
};

/**
 * Returns blocking-event conflicts on a resource for a given time range.
 *
 * Covers three categories of blocking event:
 *   1. Non-recurring events (rrule null, parentEventId null) that overlap [start, end].
 *   2. Modified instances (parentEventId not null) that overlap [start, end] —
 *      these have rrule null themselves so they fall through (1).
 *   3. Recurring base events (rrule not null, parentEventId null) whose expanded
 *      occurrences overlap [start, end].
 *
 * History (CR-a → CR-c Tier A):
 *   Pre-CR-c, this query had `rrule: null` and silently ignored category 3.
 *   That meant a member could book a court during a recurring class because the
 *   class was invisible to the conflict checker. See HANDOFF decision #46 and the
 *   CR-c design doc (designFiles/roadmap/cr-c-server-side-rrule-expansion.md).
 *
 * Modified-instance handling (CR-c.3):
 *   When a recurring base has a non-deleted modified-instance child (a one-off
 *   override at a specific date), that occurrence is OVERRIDDEN by the child. We
 *   add the child's `recurrenceId` to the combined exdates so the parent's
 *   occurrence on that date is excluded from expansion. The child itself, having
 *   `rrule = null`, gets caught by the non-recurring branch instead.
 *
 *   Soft-deleted children DO NOT get added to exdates — they "reappear" the parent's
 *   original occurrence. This matches the calendar's render behavior (ilamy expands
 *   client-side from base.exdates only; soft-deleted children just don't render
 *   themselves and the parent's occurrence shows through).
 *
 * Performance:
 *   - Recurring bases bounded by `start: { lt: end }` at SQL — series whose dtstart
 *     is in the future are filtered cheaply (CR-c.9).
 *   - Modified-instance children fetched in ONE batched query (CR-c.10), not per-base.
 *   - Per-base expansion: each call to `RRuleSet.between(start - durationMs, end)` is
 *     bounded by the caller's window, naturally tiny (a 1-hour booking yields 0–1
 *     occurrence per series).
 *
 * Tier B (separate function `checkRecurringEventConflicts`, not yet built) layers on
 * top of this for the case where the NEW event being created is itself recurring;
 * see the design doc for that scope.
 */
export async function checkResourceConflicts({
	db,
	resourceId,
	start,
	end,
	excludeEventId,
}: {
	db: TxClient;
	resourceId: string;
	start: Date;
	end: Date;
	excludeEventId?: string;
}): Promise<ResourceConflict[]> {
	// ─── Branch 1: non-recurring + modified-instance children ──────────────────
	// `rrule: null` matches both genuinely non-recurring events AND modified
	// instances of recurring events (since modifications are stored as their own
	// row with parentEventId set and rrule null). Both should block bookings.
	const nonRecurringMatches = await db.calendarEvent.findMany({
		where: {
			resourceId,
			isDeleted: false,
			isBlocking: true,
			rrule: null,
			eventId: excludeEventId ? { not: excludeEventId } : undefined,
			start: { lt: end },
			end: { gt: start },
		},
		select: {
			eventId: true,
			title: true,
			start: true,
			end: true,
		},
	});

	// ─── Branch 2: recurring base events ───────────────────────────────────────
	// Fetch recurring base events on the resource. The `start: { lt: end }` filter
	// is the cheapest way to exclude series that haven't even started yet relative
	// to the query window (CR-c.9). The actual occurrence-overlap check happens in
	// app code below via RRuleSet.between().
	const recurringBases = await db.calendarEvent.findMany({
		where: {
			resourceId,
			isDeleted: false,
			isBlocking: true,
			rrule: { not: null },
			parentEventId: null,
			eventId: excludeEventId ? { not: excludeEventId } : undefined,
			start: { lt: end },
		},
		select: {
			eventId: true,
			title: true,
			start: true,
			end: true,
			rrule: true,
			exdates: true,
			parentEventId: true,
		},
	});

	// One batched fetch for ALL modified-instance children of the bases above
	// (CR-c.10). Avoids N+1 of one-query-per-base. Only non-deleted children
	// count as override-exdates (CR-c.3).
	const baseIds = recurringBases.map((b) => b.eventId);
	const modifiedChildren =
		baseIds.length > 0
			? await db.calendarEvent.findMany({
					where: {
						parentEventId: { in: baseIds },
						isDeleted: false,
					},
					select: {
						parentEventId: true,
						recurrenceId: true,
					},
				})
			: [];

	// Index children by parent for O(1) lookup during expansion.
	// `recurrenceId` is stored as an ISO timestamp string (schema.prisma line 458);
	// parse to Date so it round-trips through RRuleSet.exdate() correctly.
	const childrenByParent = new Map<string, Date[]>();
	for (const c of modifiedChildren) {
		if (!c.parentEventId || !c.recurrenceId) continue;
		const recDate = new Date(c.recurrenceId);
		if (Number.isNaN(recDate.getTime())) {
			console.warn(
				`[checkResourceConflicts] Invalid recurrenceId on child of ${c.parentEventId}: ${c.recurrenceId}`,
			);
			continue;
		}
		const list = childrenByParent.get(c.parentEventId) ?? [];
		list.push(recDate);
		childrenByParent.set(c.parentEventId, list);
	}

	const recurringMatches: ResourceConflict[] = [];
	for (const base of recurringBases) {
		// Defensive (CR-c.11): a row with both parentEventId AND rrule set shouldn't
		// exist (modifications are single-occurrence overrides), but the schema
		// doesn't forbid it. If we encounter one, log + skip the recurring branch
		// for it. The non-recurring branch above won't have caught it either since
		// it filters rrule:null, so it'd be silently invisible — but that's strictly
		// better than risking a bad expansion.
		if (base.parentEventId !== null) {
			console.warn(
				`[checkResourceConflicts] Event ${base.eventId} has both parentEventId and rrule — skipping recurring expansion.`,
			);
			continue;
		}
		if (!base.rrule) continue; // Type guard; query already enforces this.

		// Per-base duration (CR-c.8) — each series may have a different occurrence
		// length. We look back by *this* base's duration when calling .between() so
		// we catch occurrences that started before `start` but extend into the window.
		const durationMs = base.end.getTime() - base.start.getTime();

		// Combined exdates: stored exdates ∪ non-deleted children's recurrenceIds.
		const childExdates = childrenByParent.get(base.eventId) ?? [];
		const combinedExdates: Date[] = [...base.exdates, ...childExdates];

		let ruleSet: ReturnType<typeof buildRuleSetFromEvent>;
		try {
			ruleSet = buildRuleSetFromEvent(base.rrule, combinedExdates, base.start);
		} catch {
			// Malformed rrule string in the DB — skip rather than fail the whole
			// query. Better to have a (rare) silent gap than to break every
			// conflict check on the resource.
			console.warn(
				`[checkResourceConflicts] Failed to parse rrule on event ${base.eventId} — skipping.`,
			);
			continue;
		}

		// `.between(after, before, inclusive=true)` yields occurrence start dates.
		// We pull back by durationMs so an occurrence that began before `start` but
		// extends into [start, end] still gets considered.
		const occurrenceStarts = ruleSet.between(
			new Date(start.getTime() - durationMs),
			end,
			true,
		);

		for (const occStart of occurrenceStarts) {
			const occEnd = new Date(occStart.getTime() + durationMs);
			// Final overlap check: the occurrence's [occStart, occEnd] must overlap
			// [start, end]. The look-back above is permissive; this prunes occurrences
			// that didn't actually reach into the window.
			if (occStart < end && occEnd > start) {
				recurringMatches.push({
					eventId: base.eventId,
					title: base.title,
					start: occStart,
					end: occEnd,
					isRecurringOccurrence: true,
				});
			}
		}
	}

	return [
		...nonRecurringMatches.map((e) => ({
			eventId: e.eventId,
			title: e.title,
			start: e.start,
			end: e.end,
			isRecurringOccurrence: false,
		})),
		...recurringMatches,
	];
}
