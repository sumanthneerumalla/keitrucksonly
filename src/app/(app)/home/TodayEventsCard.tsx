"use client";

import type { CalendarEvent as IlamyCalendarEvent } from "@ilamy/calendar";
import dayjs from "dayjs";
import { CalendarCheck, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CalendarEventBadge } from "~/app/_components/shared/CalendarEventBadge";
import { api } from "~/trpc/react";

function formatTime(date: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(date);
}

function formatDay(date: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(date);
}

// Group already-start-sorted events into time slots so concurrent events render
// together under one start-time heading. When the visible range spans more than
// one day, the slot label carries the date too ("Sat, Jun 14 · 6:00 PM").
function groupByStart<T extends { start: Date }>(
	events: T[],
	multiDay: boolean,
): { key: number; label: string; items: T[] }[] {
	const groups: { key: number; label: string; items: T[] }[] = [];
	for (const ev of events) {
		const key = ev.start.getTime();
		const label = multiDay
			? `${formatDay(ev.start)} · ${formatTime(ev.start)}`
			: formatTime(ev.start);
		const last = groups.at(-1);
		if (last && last.key === key) {
			last.items.push(ev);
		} else {
			groups.push({ key, label, items: [ev] });
		}
	}
	return groups;
}

type Period = "today" | "tomorrow" | "week" | "month" | "custom";

const PERIODS: { value: Period; label: string }[] = [
	{ value: "today", label: "Today" },
	{ value: "tomorrow", label: "Tomorrow" },
	{ value: "week", label: "This Week" },
	{ value: "month", label: "This Month" },
	{ value: "custom", label: "Custom" },
];

function startOfLocalDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Parse an <input type="date"> value ("YYYY-MM-DD") as a LOCAL day start.
// new Date("YYYY-MM-DD") would parse as UTC midnight and shift the day.
function parseLocalDate(value: string): Date | null {
	const [y, m, d] = value.split("-").map(Number);
	if (!y || !m || !d) return null;
	return new Date(y, m - 1, d);
}

// Half-open [start, end) instant range for a period, anchored on the viewer's
// local day boundaries so the query key is stable within a day. Week and month
// are forward-looking (today → end of period): past days of the period aren't
// attendable, so showing them is noise.
function rangeForPeriod(
	period: Period,
	customFrom: string,
	customTo: string,
): { start: Date; end: Date } | null {
	const today = startOfLocalDay(new Date());
	switch (period) {
		case "today":
			return { start: today, end: addDays(today, 1) };
		case "tomorrow":
			return { start: addDays(today, 1), end: addDays(today, 2) };
		case "week": {
			const daysFromMonday = (today.getDay() + 6) % 7;
			// Through the end of the current Mon–Sun week.
			return { start: today, end: addDays(today, 7 - daysFromMonday) };
		}
		case "month":
			return {
				start: today,
				end: new Date(today.getFullYear(), today.getMonth() + 1, 1),
			};
		case "custom": {
			const from = parseLocalDate(customFrom);
			const to = parseLocalDate(customTo);
			if (!from || !to || to < from) return null;
			// `to` is inclusive in the UI → half-open end is the next day.
			return { start: from, end: addDays(to, 1) };
		}
	}
}

function headingLabel(
	period: Period,
	range: { start: Date; end: Date } | null,
): string {
	switch (period) {
		case "today":
			return "Today";
		case "tomorrow":
			return "Tomorrow";
		case "week":
			return "This week";
		case "month":
			return "This month";
		case "custom":
			if (!range) return "Custom dates";
			return `${formatDay(range.start)} – ${formatDay(addDays(range.end, -1))}`;
	}
}

export function TodayEventsCard() {
	const [period, setPeriod] = useState<Period>("today");
	const [customFrom, setCustomFrom] = useState("");
	const [customTo, setCustomTo] = useState("");

	const range = rangeForPeriod(period, customFrom, customTo);
	const { data, isLoading, error } = api.calendar.getMemberTodayEvents.useQuery(
		range ? { rangeStart: range.start, rangeEnd: range.end } : undefined,
		{ enabled: range !== null },
	);

	// Multi-day ranges get the date in slot labels; single days don't need it.
	const multiDay =
		range !== null && range.end.getTime() - range.start.getTime() > 86_400_000;
	const label = headingLabel(period, range);

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<CalendarDays className="h-5 w-5 text-purple-600" />
					<h2 className="font-semibold text-gray-900 text-xl">
						{label}
						{data?.facility ? ` at ${data.facility.name}` : ""}
					</h2>
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					{PERIODS.map((p) => (
						<button
							key={p.value}
							type="button"
							onClick={() => setPeriod(p.value)}
							className={`rounded-full px-3 py-1 font-medium text-xs transition-colors ${
								period === p.value
									? "bg-purple-600 text-white"
									: "bg-gray-100 text-gray-600 hover:bg-gray-200"
							}`}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			{period === "custom" && (
				<div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
					<input
						type="date"
						value={customFrom}
						onChange={(e) => setCustomFrom(e.target.value)}
						className="rounded-md border border-gray-200 px-2 py-1 text-gray-700 text-sm"
						aria-label="From date"
					/>
					<span className="text-gray-400">to</span>
					<input
						type="date"
						value={customTo}
						onChange={(e) => setCustomTo(e.target.value)}
						className="rounded-md border border-gray-200 px-2 py-1 text-gray-700 text-sm"
						aria-label="To date"
					/>
				</div>
			)}

			{range === null ? (
				<p className="text-gray-500 text-sm">
					Pick a start and end date to see events.
				</p>
			) : isLoading ? (
				<p className="text-gray-500 text-sm">Loading events…</p>
			) : error ? (
				<p className="text-gray-500 text-sm">Couldn't load events.</p>
			) : !data?.facility ? (
				<p className="text-gray-500 text-sm">
					Choose an active facility to see what's happening.
				</p>
			) : data.events.length === 0 ? (
				<p className="text-gray-500 text-sm">
					Nothing scheduled {label.toLowerCase()} at {data.facility.name}.
				</p>
			) : (
				<div className="space-y-5">
					{groupByStart(data.events, multiDay).map((group) => (
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
