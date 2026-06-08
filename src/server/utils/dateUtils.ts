/**
 * Date utility functions for dashboard metrics calculations
 * and shared server-side date/time formatting.
 */

const DEFAULT_FACILITY_TIMEZONE = "America/New_York";

/**
 * Format an event's start/end window for display in error messages, scoped to a
 * facility's timezone. Used by the conflict-check error formatters across
 * `rentals.bookRentalSlot`, `calendar.createEvent`, and `calendar.updateEvent`
 * (CR-c Tier A) so messages render consistently no matter which caller throws.
 *
 * Why a single helper:
 * Each caller has a CalendarEvent → ClubFacility → timezone path that's identical.
 * Hand-rolling Intl.DateTimeFormat per caller drifts in subtle ways (hour12 setting,
 * weekday format, etc.). One helper, one source of truth for "what does a conflict
 * message look like."
 *
 * Output examples (timezone="America/New_York"):
 *   includeDate=false: "6:00 PM – 8:00 PM"
 *   includeDate=true:  "Tue, May 5, 6:00 PM – 8:00 PM"
 *
 * The `includeDate` flag exists because:
 *   - Non-recurring conflicts: the date is implied by what staff was creating
 *     (they know which day they were trying to book). Date in the message is noise.
 *   - Recurring occurrences: the date is essential — "6:00 PM" alone doesn't tell
 *     staff which Tuesday is conflicting. CR-c.2 calls this out explicitly.
 */
export function formatEventTimeInZone(
	start: Date,
	end: Date,
	timezone: string | null | undefined,
	opts: { includeDate: boolean } = { includeDate: false },
): string {
	const tz = timezone ?? DEFAULT_FACILITY_TIMEZONE;
	const timeFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
	const startTime = timeFormatter.format(start);
	const endTime = timeFormatter.format(end);
	if (!opts.includeDate) {
		return `${startTime} – ${endTime}`;
	}
	const dateFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		weekday: "short",
		month: "short",
		day: "numeric",
	});
	const date = dateFormatter.format(start);
	return `${date}, ${startTime} – ${endTime}`;
}

/**
 * Validates that a date is a valid Date object
 * @param date The date to validate
 * @throws Error if the date is invalid
 */
export function validateDate(date: Date): void {
	if (!(date instanceof Date) || isNaN(date.getTime())) {
		throw new Error("Invalid date provided");
	}
}

/**
 * Validates that a date range is valid (start <= end)
 * @param startDate The start date
 * @param endDate The end date
 * @throws Error if the range is invalid
 */
export function validateDateRange(startDate: Date, endDate: Date): void {
	validateDate(startDate);
	validateDate(endDate);

	if (startDate > endDate) {
		throw new Error("Start date must be before or equal to end date");
	}
}

/**
 * Get the start and end dates for the current week (Monday to Sunday)
 * Handles timezone considerations by working with local time
 * @param timezone Optional timezone string (e.g., 'America/New_York'). Defaults to local timezone
 * @returns Object with startOfWeek and endOfWeek dates
 */
export function getCurrentWeekRange(timezone?: string): {
	startOfWeek: Date;
	endOfWeek: Date;
} {
	let now: Date;

	if (timezone) {
		// Create date in specified timezone
		const formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});

		const parts = formatter.formatToParts(new Date());
		const year = Number.parseInt(
			parts.find((p) => p.type === "year")?.value || "0",
		);
		const month =
			Number.parseInt(parts.find((p) => p.type === "month")?.value || "0") - 1; // Month is 0-indexed
		const day = Number.parseInt(
			parts.find((p) => p.type === "day")?.value || "0",
		);
		const hour = Number.parseInt(
			parts.find((p) => p.type === "hour")?.value || "0",
		);
		const minute = Number.parseInt(
			parts.find((p) => p.type === "minute")?.value || "0",
		);
		const second = Number.parseInt(
			parts.find((p) => p.type === "second")?.value || "0",
		);

		now = new Date(year, month, day, hour, minute, second);
	} else {
		now = new Date();
	}

	// Get the current day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
	const currentDay = now.getDay();

	// Calculate days to subtract to get to Monday (start of week)
	// If currentDay is 0 (Sunday), we need to go back 6 days to get to Monday
	// If currentDay is 1 (Monday), we need to go back 0 days
	// If currentDay is 2 (Tuesday), we need to go back 1 day, etc.
	const daysToMonday = currentDay === 0 ? 6 : currentDay - 1;

	// Calculate start of week (Monday at 00:00:00)
	const startOfWeek = new Date(now);
	startOfWeek.setDate(now.getDate() - daysToMonday);
	startOfWeek.setHours(0, 0, 0, 0);

	// Calculate end of week (Sunday at 23:59:59.999)
	const endOfWeek = new Date(startOfWeek);
	endOfWeek.setDate(startOfWeek.getDate() + 6);
	endOfWeek.setHours(23, 59, 59, 999);

	return { startOfWeek, endOfWeek };
}

/**
 * Compute the UTC instants bounding a single calendar day ("today" by default) as
 * observed in a given IANA timezone. Used by the member dashboard's "today's events"
 * query so "today" means the member's local day, not the server's.
 *
 * Returns `startOfDay` (local 00:00:00.000 as a UTC instant) and `endOfDay`
 * (local 23:59:59.999 as a UTC instant). DST transitions within the day shift the
 * window by at most an hour — acceptable for a day-granularity event listing.
 */
export function getDayRangeInZone(
	timezone?: string,
	reference: Date = new Date(),
): { startOfDay: Date; endOfDay: Date } {
	const tz = timezone ?? DEFAULT_FACILITY_TIMEZONE;
	const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	})
		.format(reference)
		.split("-")
		.map(Number) as [number, number, number];

	// Offset to add to a tz-local wall-clock to obtain the matching UTC instant.
	const asUTC = new Date(
		reference.toLocaleString("en-US", { timeZone: "UTC" }),
	);
	const asTz = new Date(reference.toLocaleString("en-US", { timeZone: tz }));
	const offsetMs = asUTC.getTime() - asTz.getTime();

	const startOfDay = new Date(
		Date.UTC(year, month - 1, day, 0, 0, 0, 0) + offsetMs,
	);
	const endOfDay = new Date(
		Date.UTC(year, month - 1, day, 23, 59, 59, 999) + offsetMs,
	);
	return { startOfDay, endOfDay };
}

/**
 * Check if a date falls within the current week (Monday to Sunday)
 * @param date The date to check
 * @param timezone Optional timezone string (e.g., 'America/New_York'). Defaults to local timezone
 * @returns True if the date is within the current week
 * @throws Error if the date is invalid
 */
export function isDateInCurrentWeek(date: Date, timezone?: string): boolean {
	validateDate(date);
	const { startOfWeek, endOfWeek } = getCurrentWeekRange(timezone);
	return date >= startOfWeek && date <= endOfWeek;
}

/**
 * Get the start and end dates for a specific week containing the given date
 * @param date The date to get the week range for
 * @param timezone Optional timezone string (e.g., 'America/New_York'). Defaults to local timezone
 * @returns Object with startOfWeek and endOfWeek dates
 * @throws Error if the date is invalid
 */
export function getWeekRangeForDate(
	date: Date,
	timezone?: string,
): { startOfWeek: Date; endOfWeek: Date } {
	validateDate(date);

	let targetDate: Date;

	if (timezone) {
		// Convert date to specified timezone
		const formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});

		const parts = formatter.formatToParts(date);
		const year = Number.parseInt(
			parts.find((p) => p.type === "year")?.value || "0",
		);
		const month =
			Number.parseInt(parts.find((p) => p.type === "month")?.value || "0") - 1; // Month is 0-indexed
		const day = Number.parseInt(
			parts.find((p) => p.type === "day")?.value || "0",
		);
		const hour = Number.parseInt(
			parts.find((p) => p.type === "hour")?.value || "0",
		);
		const minute = Number.parseInt(
			parts.find((p) => p.type === "minute")?.value || "0",
		);
		const second = Number.parseInt(
			parts.find((p) => p.type === "second")?.value || "0",
		);

		targetDate = new Date(year, month, day, hour, minute, second);
	} else {
		targetDate = new Date(date);
	}

	const currentDay = targetDate.getDay();
	const daysToMonday = currentDay === 0 ? 6 : currentDay - 1;

	const startOfWeek = new Date(targetDate);
	startOfWeek.setDate(targetDate.getDate() - daysToMonday);
	startOfWeek.setHours(0, 0, 0, 0);

	const endOfWeek = new Date(startOfWeek);
	endOfWeek.setDate(startOfWeek.getDate() + 6);
	endOfWeek.setHours(23, 59, 59, 999);

	return { startOfWeek, endOfWeek };
}

/**
 * Check if a date falls within a specific week range
 * @param date The date to check
 * @param weekStart The start of the week (Monday 00:00:00)
 * @param weekEnd The end of the week (Sunday 23:59:59.999)
 * @returns True if the date is within the week range
 * @throws Error if any date is invalid or range is invalid
 */
export function isDateInWeekRange(
	date: Date,
	weekStart: Date,
	weekEnd: Date,
): boolean {
	validateDate(date);
	validateDateRange(weekStart, weekEnd);

	return date >= weekStart && date <= weekEnd;
}

/**
 * Get the week number of the year for a given date (ISO 8601 week numbering)
 * @param date The date to get the week number for
 * @returns The week number (1-53)
 * @throws Error if the date is invalid
 */
export function getWeekNumber(date: Date): number {
	validateDate(date);

	// Copy date so we don't modify the original
	const target = new Date(date.valueOf());

	// Set to Thursday of this week (ISO 8601 week belongs to year of Thursday)
	const dayNr = (target.getDay() + 6) % 7; // Make Monday = 0, Sunday = 6
	target.setDate(target.getDate() - dayNr + 3);

	// January 4 is always in week 1
	const jan4 = new Date(target.getFullYear(), 0, 4);

	// Calculate the week number
	const weekStart = new Date(jan4.valueOf());
	weekStart.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7)); // Monday of week containing Jan 4

	const daysDiff = Math.floor(
		(target.getTime() - weekStart.getTime()) / 86400000,
	);
	return Math.floor(daysDiff / 7) + 1;
}

/**
 * Check if two dates are in the same week (Monday to Sunday)
 * @param date1 First date
 * @param date2 Second date
 * @param timezone Optional timezone string
 * @returns True if both dates are in the same week
 * @throws Error if any date is invalid
 */
export function areDatesInSameWeek(
	date1: Date,
	date2: Date,
	timezone?: string,
): boolean {
	validateDate(date1);
	validateDate(date2);

	const week1 = getWeekRangeForDate(date1, timezone);
	const week2 = getWeekRangeForDate(date2, timezone);

	return week1.startOfWeek.getTime() === week2.startOfWeek.getTime();
}
