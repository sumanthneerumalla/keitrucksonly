import { RRule, RRuleSet } from "rrule";

/**
 * Build an RRuleSet from a stored rrule string + exdates + a fallback DTSTART.
 *
 * Why RRuleSet (not bare RRule):
 * `.between()` needs to honor exdates — without it, occurrences on excepted dates
 * incorrectly show up as still-valid. RRuleSet is the rrule.js construct that
 * combines an RRULE with EXDATEs.
 *
 * Why a fallback DTSTART:
 * Stored rrule strings in this codebase don't include `DTSTART:...` (the EventForm
 * RecurrenceEditor saves only freq/interval/byweekday/until/count). The DTSTART for
 * expansion is the event's own `start` field. This helper centralizes that fallback
 * so every caller doesn't reinvent it.
 *
 * Used by:
 *   - rentals.listRentalWindows: expand recurring rental windows for the day view.
 *   - rentals.updateRentalWindow: orphan-booking guard when staff edits the rrule.
 *   - resourceConflicts.checkResourceConflicts (CR-c Tier A): conflict detection
 *     against recurring blocking events.
 *
 * Combined exdate strategy (CR-c Tier A):
 * Callers wanting modified-instance support (where a child event with parentEventId
 * overrides the parent's occurrence on a specific date) should pass:
 *   exdates = base.exdates ∪ children.filter(c => !c.isDeleted).map(c => c.recurrenceId)
 * Soft-deleted children are NOT added to exdates — they reappear as the parent's
 * original occurrence, matching the calendar render behavior (ilamy expansion uses
 * only base.exdates client-side).
 */
export function buildRuleSetFromEvent(
	rruleString: string,
	exdates: Date[],
	fallbackDtstart: Date,
): RRuleSet {
	const parsed = RRule.fromString(rruleString);
	const rule = new RRule({
		...parsed.origOptions,
		dtstart: parsed.origOptions.dtstart ?? fallbackDtstart,
	});
	const set = new RRuleSet();
	set.rrule(rule);
	for (const d of exdates) set.exdate(d);
	return set;
}
