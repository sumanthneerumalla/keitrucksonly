import { describe, expect, it } from "vitest";
import dayjs from "~/lib/dayjs-config";
import { computeMembershipTerm } from "~/server/utils/membershipTerm";

/**
 * WP2 unit tests for the calendar-term date helper. All assertions pin an
 * explicit timezone so they're deterministic regardless of the CI runner's
 * local zone: the start date is built at local-noon in `TZ`, and the resulting
 * `periodEnd` calendar day is read back in the same `TZ`. Noon avoids any
 * DST/midnight edge from shifting the calendar day under us.
 */
const TZ = "America/New_York";

/** Build a Date at noon on the given calendar day in TZ (stable anchor). */
function dayAtNoon(isoDate: string): Date {
	return dayjs.tz(`${isoDate} 12:00`, TZ).toDate();
}

/** The periodEnd's calendar day (YYYY-MM-DD) as seen in TZ. */
function endDay(end: Date): string {
	return dayjs(end).tz(TZ).format("YYYY-MM-DD");
}

describe("computeMembershipTerm — monthly", () => {
	it("Feb 15 → Mar 14 (mid-month, no clamp)", () => {
		const { periodStart, periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-02-15"),
			"month",
			1,
			TZ,
		);
		expect(periodStart).toEqual(dayAtNoon("2026-02-15"));
		expect(endDay(periodEnd)).toBe("2026-03-14");
	});

	it("preserves periodStart exactly (returns the input instance value)", () => {
		const start = dayAtNoon("2026-06-10");
		const { periodStart } = computeMembershipTerm(start, "month", 1, TZ);
		expect(periodStart.getTime()).toBe(start.getTime());
	});

	it("Jan 15 → Feb 14", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-01-15"),
			"month",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-02-14");
	});

	it("ends at end-of-day so a same-day check still reads active", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-02-15"),
			"month",
			1,
			TZ,
		);
		const end = dayjs(periodEnd).tz(TZ);
		expect(end.hour()).toBe(23);
		expect(end.minute()).toBe(59);
	});
});

describe("computeMembershipTerm — short-month / clamp (preserve-anchor)", () => {
	it("Jan 31 → Feb 27 (next anchor clamps to Feb 28, non-leap)", () => {
		// 2027 is non-leap: Jan 31 + 1mo clamps to Feb 28 → periodEnd Feb 27.
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2027-01-31"),
			"month",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2027-02-27");
	});

	it("Jan 31 → Feb 28 (next anchor clamps to Feb 29, leap year)", () => {
		// 2028 is a leap year: Jan 31 + 1mo clamps to Feb 29 → periodEnd Feb 28.
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2028-01-31"),
			"month",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2028-02-28");
	});

	it("Mar 31 → Apr 29 (next anchor clamps to Apr 30)", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-03-31"),
			"month",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-04-29");
	});

	it("Aug 31 → Sep 29 (next anchor clamps to Sep 30)", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-08-31"),
			"month",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-09-29");
	});

	it("day 28 never clamps — Feb 28 → Mar 27", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-02-28"),
			"month",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-03-27");
	});
});

describe("computeMembershipTerm — quarterly (interval 3 months)", () => {
	it("Feb 15 → May 14", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-02-15"),
			"month",
			3,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-05-14");
	});

	it("Nov 15 → Feb 14 (crosses year boundary)", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-11-15"),
			"month",
			3,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2027-02-14");
	});
});

describe("computeMembershipTerm — yearly", () => {
	it("Feb 15 '26 → Feb 14 '27", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-02-15"),
			"year",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2027-02-14");
	});

	it("leap-day start Feb 29 '24 → Feb 27 '25 (next anchor clamps to Feb 28)", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2024-02-29"),
			"year",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2025-02-27");
	});

	it("Jan 1 → Dec 31 (whole-year, day 1 never clamps)", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-01-01"),
			"year",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-12-31");
	});
});

describe("computeMembershipTerm — day / week units", () => {
	it("10-day term: Feb 15 → Feb 24", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-02-15"),
			"day",
			10,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-02-24");
	});

	it("2-week term: Feb 15 → Feb 28", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-02-15"),
			"week",
			2,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-02-28");
	});

	it("accepts plural unit aliases (months)", () => {
		const { periodEnd } = computeMembershipTerm(
			dayAtNoon("2026-02-15"),
			"months",
			1,
			TZ,
		);
		expect(endDay(periodEnd)).toBe("2026-03-14");
	});
});

describe("computeMembershipTerm — validation", () => {
	it("rejects a non-positive interval", () => {
		expect(() =>
			computeMembershipTerm(dayAtNoon("2026-02-15"), "month", 0, TZ),
		).toThrow(/positive integer/);
	});

	it("rejects a non-integer interval", () => {
		expect(() =>
			computeMembershipTerm(dayAtNoon("2026-02-15"), "month", 1.5, TZ),
		).toThrow(/positive integer/);
	});

	it("rejects an unsupported billing unit", () => {
		expect(() =>
			computeMembershipTerm(dayAtNoon("2026-02-15"), "fortnight", 1, TZ),
		).toThrow(/unsupported billingUnit/);
	});
});
