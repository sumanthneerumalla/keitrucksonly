import dayjs from "~/lib/dayjs-config";

/**
 * Phase 10a — pure calendar-term date helper (WP2).
 *
 * Given a membership's start date and its plan's billing period
 * (`billingUnit` × `billingInterval`), returns the calendar term this sale
 * covers: `{ periodStart, periodEnd }`. NVBC is **signup-anchored** with full
 * calendar-period terms, so every 10a sale is one full period — there is **no
 * proration** here (the deferred `calendar`-anchor + first-term proration would
 * slot in as an alternate branch later; see phase10-memberships.md).
 *
 * Semantics (CALENDAR arithmetic, not 30-day/365-day fixed windows):
 *   - monthly (unit "month", interval 1): Feb 15 → Mar 14
 *   - quarterly (unit "month", interval 3): Feb 15 → May 14
 *   - yearly (unit "year", interval 1): Feb 15 '26 → Feb 14 '27
 *
 * The term runs from `periodStart` up to the day BEFORE the next anchor:
 * `nextAnchor = startDate + (interval × unit)`, then `periodEnd = nextAnchor − 1
 * day`. This makes the next period begin exactly on the anchor day-of-month
 * (renewals land on the signup day).
 *
 * **Preserve-anchor day-of-month clamp** (matches Stripe; decision 2026-05-26):
 * when the next anchor month is too short for the anchor day, clamp to that
 * month's last day (Jan 31 monthly → next anchor Feb 28/29 → periodEnd Feb
 * 27/28). Because every term is computed from the literal `startDate` (which
 * carries the true anchor day), this is preserve-anchor, NOT clamp-and-stick:
 * the clamp never erodes the original day across successive sales. dayjs's
 * `.add(n, "month" | "year")` performs exactly this end-of-month clamp, so a
 * single add from the anchor is correct. Anchor days 1–28 never clamp.
 *
 * Day units ("day"/"week") are linear — no clamping needed; e.g. a 10-day term
 * Feb 15 → Feb 24, a 2-week term Feb 15 → Feb 28.
 *
 * Timezone: when a `timezone` is supplied the arithmetic is anchored in that
 * zone (mirrors the package `endDate` tz handling, #49) and the end is snapped
 * to end-of-day so the term is inclusive of its final calendar day. Without a
 * timezone the math runs in the supplied date's local frame.
 *
 * Pure: no DB, no clock reads — fully unit-testable.
 */
export function computeMembershipTerm(
	startDate: Date,
	billingUnit: string,
	billingInterval: number,
	timezone?: string | null,
): { periodStart: Date; periodEnd: Date } {
	if (!Number.isInteger(billingInterval) || billingInterval < 1) {
		throw new Error(
			`computeMembershipTerm: billingInterval must be a positive integer (got ${billingInterval})`,
		);
	}

	// dayjs add() accepts these unit strings directly. Normalize to the singular
	// dayjs units; reject anything unexpected so a typo can't silently produce a
	// zero-length (or wrong-length) term.
	const unit = normalizeUnit(billingUnit);

	// Anchor in the facility timezone when one is given (mirrors the package
	// endDate computation, decision #49); otherwise operate in the date's frame.
	const start = timezone ? dayjs(startDate).tz(timezone) : dayjs(startDate);

	// Next period's anchor = startDate + (interval × unit). dayjs clamps the
	// day-of-month to the target month's last day when needed (Jan 31 + 1 month
	// → Feb 28), which is exactly the preserve-anchor rule for a single term.
	const nextAnchor = start.add(billingInterval, unit);

	// The term covers up to the day BEFORE the next anchor. End-of-day so the
	// final calendar day is fully inside the term (a same-day expiry check at
	// any time on periodEnd's date still reads "active").
	const end = nextAnchor.subtract(1, "day").endOf("day");

	return { periodStart: startDate, periodEnd: end.toDate() };
}

type DayjsUnit = "day" | "week" | "month" | "year";

/**
 * Maps a plan's `billingUnit` string to the dayjs unit. Accepts the canonical
 * singular forms stored on `MembershipPlan.billingUnit` ("day"/"week"/"month"/
 * "year") plus their plural variants for resilience. Throws on anything else so
 * a bad value surfaces loudly instead of yielding a silently wrong term.
 */
function normalizeUnit(billingUnit: string): DayjsUnit {
	switch (billingUnit) {
		case "day":
		case "days":
			return "day";
		case "week":
		case "weeks":
			return "week";
		case "month":
		case "months":
			return "month";
		case "year":
		case "years":
			return "year";
		default:
			throw new Error(
				`computeMembershipTerm: unsupported billingUnit "${billingUnit}" (expected day | week | month | year)`,
			);
	}
}
