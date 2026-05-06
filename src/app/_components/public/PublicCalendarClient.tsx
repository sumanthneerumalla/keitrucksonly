"use client";

import {
	IlamyCalendar,
	IlamyResourceCalendar,
	useIlamyCalendarContext,
} from "@ilamy/calendar";
import type {
	BusinessHours,
	CalendarEvent as IlamyCalendarEvent,
	Resource,
} from "@ilamy/calendar";
import { keepPreviousData } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
	Building2,
	Calendar,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Columns,
	LayoutGrid,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RRule } from "rrule";
import "~/lib/dayjs-config";
import { CalendarEventBadge } from "~/app/_components/shared/CalendarEventBadge";
import { FacilitySelector } from "~/app/_components/shared/FacilitySelector";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Read-only header — shown inside IlamyCalendar / IlamyResourceCalendar via
// headerComponent. Provides navigation (prev/next/today) + view switcher but
// deliberately omits the "+ New" button.
// Both hooks return the same shape so we can share one implementation.
// ---------------------------------------------------------------------------

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

type CalendarCtx = {
	view: "month" | "week" | "day";
	currentDate: dayjs.Dayjs;
	setCurrentDate: (d: dayjs.Dayjs) => void;
	setView: (v: "month" | "week" | "day") => void;
	nextPeriod: () => void;
	prevPeriod: () => void;
	today: () => void;
	firstDayOfWeek: number;
};

// Returns the 7 days of the week containing `date`, starting from `firstDayOfWeek`
function getWeekDays(date: dayjs.Dayjs, firstDayOfWeek: number): dayjs.Dayjs[] {
	const diff = (date.day() - firstDayOfWeek + 7) % 7;
	const start = date.subtract(diff, "day");
	return Array.from({ length: 7 }, (_, i) => start.add(i, "day"));
}

// DatePopover — portals its dropdown to document.body so it always escapes
// overflow:hidden scroll containers and sticky-element stacking contexts.
function DatePopover({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({ top: 0, left: 0 });

	// Recalculate position whenever the dropdown opens
	useEffect(() => {
		if (!open || !triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		setPosition({
			top: rect.bottom + window.scrollY + 4,
			left: rect.left + window.scrollX,
		});
	}, [open]);

	// Close on outside click
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			const target = e.target as Node;
			const outsideTrigger = !triggerRef.current?.contains(target);
			const outsideDropdown = !dropdownRef.current?.contains(target);
			if (outsideTrigger && outsideDropdown) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	return (
		<>
			<button
				ref={triggerRef}
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-0.5 rounded px-1 py-0.5 font-semibold text-sm hover:bg-gray-100"
			>
				{label}
				<ChevronDown className="h-3.5 w-3.5 opacity-60" />
			</button>
			{open &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						ref={dropdownRef}
						style={{
							position: "absolute",
							top: position.top,
							left: position.left,
							zIndex: 9999,
						}}
						className="max-h-60 w-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
					>
						{children}
					</div>,
					document.body,
				)}
		</>
	);
}

function PopoverItem({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			onClick={onClick}
			className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${active ? "bg-[var(--primary)]/10 font-medium" : ""}`}
		>
			{children}
		</button>
	);
}

function ReadOnlyHeader({
	ctx,
	headerClassName,
	facilityName,
}: {
	ctx: CalendarCtx;
	headerClassName?: string;
	facilityName?: string;
}) {
	const VIEWS = ["month", "week", "day"] as const;
	const {
		view,
		currentDate,
		setCurrentDate,
		today,
		prevPeriod,
		nextPeriod,
		firstDayOfWeek,
	} = ctx;

	const currentYear = currentDate.year();
	const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);
	const weekDays = getWeekDays(currentDate, firstDayOfWeek);

	// Title display varies by view
	const weekLabel = `${weekDays[0]!.format("MMM D")} – ${weekDays[6]!.format("MMM D")}`;
	const dayLabel = currentDate.format("ddd, MMM D");

	return (
		<div
			className={`flex flex-wrap items-center justify-between gap-2 p-1 ${headerClassName ?? ""}`}
		>
			{/* Left: nav + date display */}
			<div className="flex items-center gap-1">
				{facilityName ? (
					<span className="flex items-center gap-1 text-gray-500 text-xs">
						<Building2 className="h-3.5 w-3.5" />
						{facilityName}
						<span className="text-gray-300">|</span>
					</span>
				) : (
					<Calendar className="h-4 w-4 shrink-0 text-gray-400" />
				)}
				<button
					onClick={today}
					className="rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium text-xs shadow-xs hover:bg-gray-50"
				>
					Today
				</button>
				<button
					onClick={prevPeriod}
					className="rounded-md border border-gray-200 bg-white p-2 shadow-xs hover:bg-gray-50"
					aria-label="Previous"
				>
					<ChevronLeft className="h-5 w-5" />
				</button>
				<button
					onClick={nextPeriod}
					className="rounded-md border border-gray-200 bg-white p-2 shadow-xs hover:bg-gray-50"
					aria-label="Next"
				>
					<ChevronRight className="h-5 w-5" />
				</button>

				{/* Month popover — hidden in day view */}
				{view !== "day" && (
					<DatePopover label={currentDate.format("MMMM")}>
						{MONTHS.map((m, i) => (
							<PopoverItem
								key={m}
								active={currentDate.month() === i}
								onClick={() => setCurrentDate(currentDate.month(i))}
							>
								{m}
							</PopoverItem>
						))}
					</DatePopover>
				)}

				{/* Year popover — always shown */}
				<DatePopover label={currentDate.format("YYYY")}>
					{years.map((y) => (
						<PopoverItem
							key={y}
							active={currentDate.year() === y}
							onClick={() => setCurrentDate(currentDate.year(y))}
						>
							{y}
						</PopoverItem>
					))}
				</DatePopover>

				{/* Week range — only in week view */}
				{view === "week" && (
					<DatePopover label={weekLabel}>
						{Array.from({ length: 7 }, (_, i) => {
							const w = currentDate.subtract(3 - i, "week");
							const days = getWeekDays(w, firstDayOfWeek);
							const start = days[0]!;
							const end = days[6]!;
							const crossMonth = start.month() !== end.month();
							return (
								<PopoverItem
									key={start.format("YYYY-MM-DD")}
									active={w.isSame(currentDate, "week")}
									onClick={() => setCurrentDate(start)}
								>
									<span>{`${start.format("MMM D")} – ${end.format("D")}`}</span>
									{crossMonth && (
										<span className="ml-1 text-gray-400 text-xs">
											{`${start.format("MMM")}-${end.format("MMM")}`}
										</span>
									)}
								</PopoverItem>
							);
						})}
					</DatePopover>
				)}

				{/* Day — only in day view */}
				{view === "day" && (
					<DatePopover label={dayLabel}>
						{Array.from({ length: currentDate.daysInMonth() }, (_, i) => {
							const d = currentDate.startOf("month").date(i + 1);
							const isToday = d.isSame(dayjs(), "day");
							return (
								<PopoverItem
									key={d.format("YYYY-MM-DD")}
									active={d.isSame(currentDate, "day")}
									onClick={() => setCurrentDate(d)}
								>
									<span>{d.format("ddd, MMM D")}</span>
									{isToday && (
										<span className="ml-1 rounded bg-[var(--primary)] px-1 text-white text-xs">
											Today
										</span>
									)}
								</PopoverItem>
							);
						})}
					</DatePopover>
				)}
			</div>

			{/* Right: view switcher */}
			<div className="flex items-center gap-1">
				{VIEWS.map((v) => (
					<button
						key={v}
						onClick={() => ctx.setView(v)}
						className={`rounded-md px-2.5 py-1 font-medium text-xs capitalize transition-colors ${
							ctx.view === v
								? "bg-[var(--primary)] text-white"
								: "border border-gray-200 bg-white hover:bg-gray-50"
						}`}
					>
						{v}
					</button>
				))}
			</div>
		</div>
	);
}

function CalendarHeader({
	headerClassName,
	facilityName,
}: { headerClassName?: string; facilityName?: string }) {
	const ctx = useIlamyCalendarContext();
	return (
		<ReadOnlyHeader
			ctx={ctx as unknown as CalendarCtx}
			headerClassName={headerClassName}
			facilityName={facilityName}
		/>
	);
}

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
	daysOfWeek: [
		"sunday",
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
	],
	startTime: 9,
	endTime: 24,
};
// backdrop-blur-sm removed: CSS backdrop-filter creates a new stacking context that traps
// portalled dropdowns (DatePopover uses createPortal + z-index:9999 which is capped inside
// any ancestor that has a backdrop-filter applied).
const CALENDAR_HEADER_CLASSNAME =
	"rounded-t-xl border-b border-[var(--border)] bg-white px-3 py-2 shadow-sm";
// backdrop-blur creates a CSS stacking context that traps portalled dropdowns;
// use solid bg-white so sticky elements remain opaque without any stacking side-effects.
const CALENDAR_VIEW_HEADER_CLASSNAME = "bg-white";
const CALENDAR_CLASSES_OVERRIDE = {
	disabledCell: "bg-slate-50/80 text-slate-400 pointer-events-none",
};

function parseRRule(rruleString: string) {
	const rule = RRule.fromString(rruleString);
	return rule.origOptions;
}

export interface PublicCalendarClientProps {
	clubShortName: string;
	initialView?: "month" | "week" | "day";
	initialMode?: "standard" | "resource";
	initialOrientation?: "horizontal" | "vertical";
	/** true = embed mode: zero chrome, full viewport, no mode toggle UI */
	embedMode?: boolean;
}

export default function PublicCalendarClient({
	clubShortName,
	initialView = "month",
	initialMode = "standard",
	initialOrientation = "horizontal",
	embedMode = false,
}: PublicCalendarClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const timezone = dayjs.tz.guess();

	const [currentDate, setCurrentDate] = useState(dayjs());
	const [currentView, setCurrentView] = useState<"month" | "week" | "day">(
		initialView,
	);
	const [calendarMode, setCalendarMode] = useState<"standard" | "resource">(
		initialMode,
	);
	const [orientation, setOrientation] = useState<"horizontal" | "vertical">(
		initialOrientation,
	);

	// Facility state — read from URL, synced back on change
	const initialFacilityId = searchParams.get("facility") ?? null;
	const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(
		initialFacilityId,
	);
	const { data: publicFacilities } = api.calendar.getPublicFacilities.useQuery({
		clubShortName,
	});
	// Default to first facility if none selected
	const effectiveFacilityId =
		selectedFacilityId ?? publicFacilities?.[0]?.facilityId ?? null;

	// Push view/mode/orientation/facility changes back into the URL so the state is
	// shareable/bookmarkable. Uses replace (not push) to avoid polluting history.
	const syncUrl = useCallback(
		(
			updates: Partial<{
				view: string;
				mode: string;
				orientation: string;
				facility: string | null;
			}>,
		) => {
			const params = new URLSearchParams(searchParams.toString());
			if (updates.view !== undefined) params.set("view", updates.view);
			if (updates.mode !== undefined) params.set("mode", updates.mode);
			if (updates.orientation !== undefined)
				params.set("orientation", updates.orientation);
			if (updates.facility !== undefined) {
				if (updates.facility) params.set("facility", updates.facility);
				else params.delete("facility");
			}
			router.replace(`?${params.toString()}`, { scroll: false });
		},
		[router, searchParams],
	);

	// Compute fetch range with ±1 week buffer
	const viewRange = useMemo(() => {
		const effective = currentDate.tz(timezone);
		const unit =
			currentView === "month"
				? "month"
				: currentView === "week"
					? "week"
					: "day";
		return {
			startDate: effective.startOf(unit).subtract(1, "week").toDate(),
			endDate: effective.endOf(unit).add(1, "week").toDate(),
		};
	}, [currentDate, currentView, timezone]);

	const { data: eventsData, isLoading: eventsLoading } =
		api.calendar.getPublicEvents.useQuery(
			{
				clubShortName,
				startDate: viewRange.startDate,
				endDate: viewRange.endDate,
				facilityId: effectiveFacilityId ?? undefined,
			},
			{ placeholderData: keepPreviousData },
		);

	const { data: resourcesData, isLoading: resourcesLoading } =
		api.calendar.getPublicResources.useQuery({
			clubShortName,
			facilityId: effectiveFacilityId ?? undefined,
		});

	const resources: Resource[] = useMemo(() => {
		if (!resourcesData?.resources) return [];
		return resourcesData.resources.map((r) => ({
			id: r.resourceId,
			title: r.title,
			// Pass through DB color/bg only if explicitly set; otherwise let
			// ilamy render with no inline style so the calendar canvas
			// cascade (warm paper bg, ink text) takes over. Matches the
			// behaviour in CalendarClient — the public/embed view shouldn't
			// look different from the staff view.
			color: r.color ?? undefined,
			backgroundColor: r.backgroundColor ?? undefined,
			position: r.position,
			businessHours:
				r.businessHours.length > 0
					? r.businessHours.map((bh) => ({
							daysOfWeek: bh.daysOfWeek,
							startTime: bh.startTime,
							endTime: bh.endTime,
						}))
					: DEFAULT_BUSINESS_HOURS,
		})) as Resource[];
	}, [resourcesData]);

	const events: IlamyCalendarEvent[] = useMemo(() => {
		if (!eventsData?.events) return [];
		return eventsData.events.map((e) => ({
			id: e.eventId,
			title: e.title,
			start: dayjs(e.start),
			end: dayjs(e.end),
			description: e.description ?? undefined,
			allDay: false,
			resourceId: e.resourceId ?? undefined,
			uid: e.uid,
			rrule: e.rrule ? parseRRule(e.rrule) : undefined,
			color: e.color ?? undefined,
			backgroundColor: e.backgroundColor ?? undefined,
			data: {
				dbEventId: e.eventId,
				eventType: e.eventType,
				maxParticipants: e.maxParticipants ?? null,
				currentRegistrations: e.currentRegistrations,
				priceInCents: e.priceInCents ?? null,
				coachName: e.coachName ?? null,
			},
		})) as IlamyCalendarEvent[];
	}, [eventsData]);

	const hasResources = resources.length > 0;
	const isLoading = eventsLoading || resourcesLoading;

	const renderEvent = useCallback(
		(e: IlamyCalendarEvent) => <CalendarEventBadge event={e} />,
		[],
	);

	const commonProps = {
		businessHours: DEFAULT_BUSINESS_HOURS,
		classesOverride: CALENDAR_CLASSES_OVERRIDE,
		disableCellClick: true,
		disableDragAndDrop: true,
		disableEventClick: false,
		events,
		firstDayOfWeek: "monday" as const,
		hideNonBusinessHours: true,
		initialDate: currentDate,
		initialView: currentView,
		onDateChange: (date: dayjs.Dayjs) => setCurrentDate(date),
		onViewChange: (view: "month" | "week" | "day" | "year") => {
			if (view !== "year") {
				setCurrentView(view);
				syncUrl({ view });
			}
		},
		renderEvent,
		timeFormat: "12-hour" as const,
		timezone,
		viewHeaderClassName: CALENDAR_VIEW_HEADER_CLASSNAME,
		onEventClick: (e: IlamyCalendarEvent) => {
			const dbEventId = (e.data as Record<string, unknown> | undefined)
				?.dbEventId as string | undefined;
			if (dbEventId) router.push(`/events/${dbEventId}`);
		},
	};

	const containerClass = embedMode
		? "h-screen w-screen overflow-hidden"
		: "flex h-full flex-col";

	const activeFacilityName = publicFacilities?.find(
		(f) => f.facilityId === effectiveFacilityId,
	)?.facilityName;

	return (
		<div className={containerClass}>
			{/* Toolbar — club pages only (not embed) */}
			{!embedMode && (
				<div className="flex flex-wrap items-center gap-2 px-4 pt-3">
					{/* Facility selector — club pages only */}
					{publicFacilities && (
						<FacilitySelector
							facilities={publicFacilities}
							selectedFacilityId={effectiveFacilityId}
							onSelect={(id) => {
								setSelectedFacilityId(id);
								syncUrl({ facility: id });
							}}
						/>
					)}
				</div>
			)}
			{!embedMode && hasResources && (
				<div className="flex items-center justify-end gap-2 px-4 pt-1">
					<button
						onClick={() => {
							const next =
								calendarMode === "standard" ? "resource" : "standard";
							setCalendarMode(next);
							syncUrl({ mode: next });
						}}
						className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-gray-700 text-sm transition-colors hover:bg-[var(--accent)]"
					>
						{calendarMode === "resource" ? (
							<LayoutGrid size={16} />
						) : (
							<Columns size={16} />
						)}
						{calendarMode === "resource" ? "Standard View" : "Resource View"}
					</button>
					{calendarMode === "resource" && (
						<button
							onClick={() => {
								const next =
									orientation === "horizontal" ? "vertical" : "horizontal";
								setOrientation(next);
								syncUrl({ orientation: next });
							}}
							className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-gray-700 text-sm transition-colors hover:bg-[var(--accent)]"
						>
							{orientation === "horizontal"
								? "Vertical Layout"
								: "Horizontal Layout"}
						</button>
					)}
				</div>
			)}

			<div
				className={embedMode ? "h-full w-full" : "flex-1 overflow-y-auto p-4"}
			>
				<div
					data-calendar-root
					className={
						embedMode
							? "h-full w-full"
							: // ring-1 instead of border: a real CSS border adds a box edge flush against the
								// overflow-hidden clip boundary, making the inner corners appear square.
								// ring renders as an inset box-shadow so rounded corners clip cleanly.
								"overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[var(--border)]"
					}
				>
					{isLoading ? (
						<div className="flex h-full items-center justify-center">
							<div className="animate-pulse space-y-4">
								<div className="h-8 w-48 rounded bg-gray-200" />
								<div className="h-96 w-full rounded bg-gray-200" />
							</div>
						</div>
					) : calendarMode === "resource" && hasResources ? (
						<IlamyResourceCalendar
							{...commonProps}
							key={`public-resource-${timezone}`}
							resources={resources}
							orientation={orientation}
							headerComponent={
								<CalendarHeader
									headerClassName={CALENDAR_HEADER_CLASSNAME}
									facilityName={embedMode ? activeFacilityName : undefined}
								/>
							}
						/>
					) : (
						<IlamyCalendar
							{...commonProps}
							key={`public-standard-${timezone}`}
							headerComponent={
								<CalendarHeader
									headerClassName={CALENDAR_HEADER_CLASSNAME}
									facilityName={embedMode ? activeFacilityName : undefined}
								/>
							}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
