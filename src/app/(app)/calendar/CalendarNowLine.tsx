"use client";

/**
 * Brand-indigo "now line" indicator for the calendar.
 *
 * Replaces ilamy's default solid red horizontal line with a dashed brand-indigo
 * stroke + 3px head circle, matching the marketing CalendarMock aesthetic.
 *
 * Wired via `renderCurrentTimeIndicator` on `IlamyCalendar` /
 * `IlamyResourceCalendar`. Per the ilamy library, the indicator is only
 * rendered inside vertical-grid views (week/day standard, vertical resource).
 * Horizontal resource views currently don't render an indicator at all in
 * ilamy — adding one there would require a PR upstream or a custom overlay.
 *
 * Positioning: ilamy's indicator wrapper uses absolute positioning with
 * `top: ${progress}%` to place the line vertically based on the time-grid
 * progress (0–100%). We replicate that contract.
 */

interface CalendarNowLineProps {
	/** Percentage (0–100) through the visible time range. */
	progress: number;
}

export function CalendarNowLine({ progress }: CalendarNowLineProps) {
	return (
		<div
			className="pointer-events-none absolute right-0 left-0 z-50"
			style={{ top: `${progress}%` }}
			data-testid="calendar-now-line"
		>
			{/* The dashed brand-indigo rule */}
			<div className="border-[var(--brand)] border-t border-dashed" />
			{/* Head circle pinned at the left edge — matches the mockup's "pin in
			 * calendar" look. -1.5px vertical offset so the 3px dot centers on the
			 * line. */}
			<span className="-top-[3px] -left-[3px] absolute inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
		</div>
	);
}

export default CalendarNowLine;
