"use client";

import type { CalendarEvent as IlamyCalendarEvent } from "@ilamy/calendar";
import dayjs from "dayjs";
import { CalendarCheck, CalendarClock, MapPin } from "lucide-react";
import Link from "next/link";
import { CalendarEventBadge } from "~/app/_components/shared/CalendarEventBadge";
import { api } from "~/trpc/react";

function formatTime(date: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(date);
}

// "Today", "Tomorrow", or "Mon, Jun 9" relative to the viewer's local day.
function formatDayLabel(date: Date): string {
	const today = new Date();
	const startOf = (d: Date) =>
		new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const diffDays = Math.round(
		(startOf(date) - startOf(today)) / (24 * 60 * 60 * 1000),
	);
	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Tomorrow";
	return new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(date);
}

/**
 * Upcoming-events list. Two modes from one component so it's reusable:
 *  - default (no props): the signed-in member's registered upcoming events
 *    (`getMyUpcomingEvents`) — used on /home, shows a Registered/Checked-in chip.
 *  - public (pass `clubShortName`, optionally `facilityId`): a club's upcoming
 *    public events (`getPublicUpcomingEvents`) — used on club landing pages,
 *    no registration chip.
 */
export function UpcomingEventsCard({
	clubShortName,
	facilityId,
}: {
	clubShortName?: string;
	facilityId?: string;
} = {}) {
	const isPublic = !!clubShortName;

	const memberQuery = api.calendar.getMyUpcomingEvents.useQuery(
		{ limit: 5 },
		{ enabled: !isPublic },
	);
	const publicQuery = api.calendar.getPublicUpcomingEvents.useQuery(
		{ clubShortName: clubShortName ?? "", facilityId, limit: 5 },
		{ enabled: isPublic },
	);

	const { data, isLoading, error } = isPublic ? publicQuery : memberQuery;

	const heading = isPublic ? "Upcoming events" : "Your upcoming events";
	const emptyMessage = isPublic
		? "No upcoming events scheduled yet."
		: "You're not registered for any upcoming events yet.";

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
			<div className="mb-4 flex items-center gap-2">
				<CalendarClock className="h-5 w-5 text-blue-600" />
				<h2 className="font-semibold text-gray-900 text-xl">{heading}</h2>
			</div>

			{isLoading ? (
				<p className="text-gray-500 text-sm">Loading events…</p>
			) : error ? (
				<p className="text-gray-500 text-sm">Couldn't load events.</p>
			) : !data || data.events.length === 0 ? (
				<p className="text-gray-500 text-sm">{emptyMessage}</p>
			) : (
				<div className="space-y-2">
					{data.events.map((ev) => {
						// Minimal ilamy event shape — CalendarEventBadge reads only
						// title/colors/data; start/end satisfy the type.
						const badgeEvent = {
							id: ev.eventId,
							title: ev.title,
							start: dayjs(ev.start),
							end: dayjs(ev.end),
							color: ev.color ?? undefined,
							backgroundColor: ev.backgroundColor ?? undefined,
							data: {
								eventType: ev.eventType,
								maxParticipants: ev.maxParticipants,
								currentRegistrations: ev.currentRegistrations,
								priceInCents: ev.priceInCents,
							},
						} as unknown as IlamyCalendarEvent;

						// Registration chip is member-only; public club events carry no
						// per-viewer status, so we omit it there.
						const status = "status" in ev ? ev.status : null;
						const statusChip =
							status == null ? null : status === "CHECKED_IN" ? (
								<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 text-xs">
									<CalendarCheck size={12} />
									Checked in
								</span>
							) : (
								<span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 text-xs">
									Registered
								</span>
							);

						const startDate = new Date(ev.start);
						const metaParts = [ev.facilityName, ev.resourceTitle].filter(
							Boolean,
						);

						return (
							<Link
								key={`${ev.eventId}-${startDate.toISOString()}`}
								href={`/events/${ev.eventId}`}
								className="flex items-center gap-3 rounded-lg border border-gray-100 p-2.5 transition-colors hover:bg-gray-50 hover:shadow-sm"
							>
								<div className="w-20 shrink-0 leading-tight">
									<div className="font-medium text-gray-900 text-xs">
										{formatDayLabel(startDate)}
									</div>
									<div className="text-gray-500 text-xs">
										{formatTime(startDate)}
									</div>
								</div>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<CalendarEventBadge event={badgeEvent} />
									{metaParts.length > 0 && (
										<span className="flex min-w-0 items-center gap-1 truncate text-gray-500 text-xs">
											<MapPin size={11} className="shrink-0" />
											<span className="truncate">{metaParts.join(" · ")}</span>
										</span>
									)}
								</div>
								{statusChip}
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}
