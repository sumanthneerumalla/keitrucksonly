/**
 * Shared date/time utilities for Court Rentals frontend
 */

/** Parse a YYYY-MM-DD string from <input type="date"> into local midnight Date.
 *  `new Date("2026-04-13")` parses as UTC midnight — this constructs local midnight instead.
 */
export function parseLocalDate(dateStr: string): Date {
	const [year, month, day] = dateStr.split("-").map(Number);
	return new Date(year!, month! - 1, day!);
}

/** Format a Date to YYYY-MM-DD for <input type="date"> value */
export function toDateInputValue(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

/** Format a Date to HH:mm for <input type="time"> value */
export function toTimeInputValue(d: Date): string {
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

/** Format an ISO string or Date to localized time (e.g., "6:00 PM") */
export function formatTime(iso: string | Date): string {
	return new Date(iso).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Combine a YYYY-MM-DD date string and HH:mm time string into a local Date */
export function combineDateAndTime(dateStr: string, timeStr: string): Date {
	const [year, month, day] = dateStr.split("-").map(Number);
	const [hours, minutes] = timeStr.split(":").map(Number);
	return new Date(year!, month! - 1, day!, hours!, minutes!, 0, 0);
}
