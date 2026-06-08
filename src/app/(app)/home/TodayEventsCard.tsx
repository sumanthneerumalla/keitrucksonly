"use client";

import type { CalendarEvent as IlamyCalendarEvent } from "@ilamy/calendar";
import dayjs from "dayjs";
import { CalendarCheck, CalendarDays, MapPin } from "lucide-react";
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

// Group already-start-sorted events into time slots so concurrent events render
// together under one start-time heading.
function groupByStart<T extends { start: Date }>(
	events: T[],
): { key: number; label: string; items: T[] }[] {
	const groups: { key: number; label: string; items: T[] }[] = [];
	for (const ev of events) {
		const key = ev.start.getTime();
		const last = groups.at(-1);
		if (last && last.key === key) {
			last.items.push(ev);
		} else {
			groups.push({ key, label: formatTime(ev.start), items: [ev] });
		}
	}
	return groups;
}

export function TodayEventsCard() {
	const { data, isLoading, error } =
		api.calendar.getMemberTodayEvents.useQuery();

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
			<div className="mb-4 flex items-center gap-2">
				<CalendarDays className="h-5 w-5 text-purple-600" />
				<h2 className="font-semibold text-gray-900 text-xl">
					Today{data?.facility ? ` at ${data.facility.name}` : ""}
				</h2>
			</div>

			{isLoading ? (
				<p className="text-gray-500 text-sm">Loading today's events…</p>
			) : error ? (
				<p className="text-gray-500 text-sm">Couldn't load today's events.</p>
			) : !data?.facility ? (
				<p className="text-gray-500 text-sm">
					Choose an active facility to see what's happening today.
				</p>
			) : data.events.length === 0 ? (
				<p className="text-gray-500 text-sm">
					Nothing scheduled today at {data.facility.name}.
				</p>
			) : (
				<div className="space-y-5">
					{groupByStart(data.events).map((group) => (
						<div key={group.key}>
							{/* Time-slot heading — concurrent events share one heading */}
							<div className="mb-2 flex items-center gap-3">
								<span className="font-semibold text-gray-700 text-sm">
									{group.label}
								</span>
								<span className="h-px flex-1 bg-gray-100" />
							</div>

							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{group.items.map((ev) => {
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

									const statusChip = ev.isRegistered ? (
										<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 text-xs">
											<CalendarCheck size={12} />
											Registered
										</span>
									) : ev.eventType === "DROP_IN" ? (
										<span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700 text-xs">
											Rotation board
										</span>
									) : ev.isFull ? (
										<span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-500 text-xs">
											View
										</span>
									) : (
										<span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 text-xs">
											{ev.isFree ? "Register" : "Sign up"}
										</span>
									);

									const key = ev.instanceDate
										? `${ev.eventId}-${ev.instanceDate.toISOString()}`
										: ev.eventId;

									return (
										<Link
											key={key}
											href={`/events/${ev.eventId}`}
											className="flex flex-col gap-2 rounded-lg border border-gray-100 p-3 transition-colors hover:bg-gray-50 hover:shadow-sm"
										>
											<CalendarEventBadge event={badgeEvent} />
											<div className="flex items-center justify-between gap-2 text-gray-500 text-xs">
												<span className="flex min-w-0 items-center gap-1 truncate">
													{ev.resourceTitle && (
														<>
															<MapPin size={11} className="shrink-0" />
															<span className="truncate">
																{ev.resourceTitle}
															</span>
															<span className="text-gray-300">·</span>
														</>
													)}
													<span className="shrink-0">
														ends {formatTime(ev.end)}
													</span>
												</span>
												{statusChip}
											</div>
										</Link>
									);
								})}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
