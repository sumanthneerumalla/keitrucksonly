"use client";

import type { RenderCurrentTimeIndicatorProps } from "@ilamy/calendar";

/**
 * Brand-indigo "now line" indicator for the calendar.
 *
 * Replaces ilamy's default solid red line with a dashed brand-indigo stroke
 * + 3px head circle, matching the marketing CalendarMock aesthetic.
 *
 * Wired via `renderCurrentTimeIndicator` on `IlamyCalendar` /
 * `IlamyResourceCalendar`. Branches on the library's `axis` prop (added in
 * @ilamy/calendar v1.7.0 — see kcsujeet/ilamy-calendar#121):
 *   - `'vertical'` (default): horizontal stroke positioned by `top: ${progress}%`,
 *     used in day/week vertical grids (regular calendar + resource vertical).
 *   - `'horizontal'`: vertical stroke positioned by `left: ${progress}%`,
 *     used in resource hour-resolution horizontal grids (day, week-hourly).
 */

export function CalendarNowLine({
	progress,
	axis = "vertical",
}: Pick<RenderCurrentTimeIndicatorProps, "progress" | "axis">) {
	if (axis === "horizontal") {
		return (
			<div
				className="pointer-events-none absolute top-0 bottom-0 z-50"
				style={{ left: `${progress}%` }}
				data-testid="calendar-now-line"
			>
				{/* The dashed brand-indigo rule, vertical */}
				<div className="border-[var(--brand)] border-l border-dashed h-full" />
				{/* Head circle pinned at the top edge — mirrors the vertical-axis
				 * "pin in calendar" look. -1.5px horizontal offset so the 3px dot
				 * centers on the line. */}
				<span className="-top-[3px] -left-[3px] absolute inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
			</div>
		);
	}

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
