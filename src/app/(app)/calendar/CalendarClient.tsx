"use client";

import { IlamyCalendar, IlamyResourceCalendar } from "@ilamy/calendar";
import type {
	BusinessHours,
	CalendarEvent as IlamyCalendarEvent,
	Resource,
} from "@ilamy/calendar";
import { keepPreviousData } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Check, Clipboard, Columns, LayoutGrid, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { RRule } from "rrule";
import { isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";
import "~/lib/dayjs-config";
import { CalendarNowLine } from "~/app/(app)/calendar/CalendarNowLine";
import EventFormModal from "~/app/(app)/calendar/EventFormModal";
import { CalendarEventBadge } from "~/app/_components/shared/CalendarEventBadge";
import { FacilitySelector } from "~/app/_components/shared/FacilitySelector";
import { useToast } from "~/app/_components/shared/Toast";

const DEFAULT_STANDARD_BUSINESS_HOURS = {
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
} satisfies BusinessHours;
const DEFAULT_RESOURCE_BUSINESS_HOURS = {
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
} satisfies BusinessHours;
// backdrop-blur-sm removed: CSS backdrop-filter creates a new stacking context that traps
// portalled dropdowns (DatePopover uses createPortal + z-index:9999 which is capped inside
// any ancestor that has a backdrop-filter applied).
//
// Warm-paper theming: bg uses --paper (set globally on [data-calendar-root]) so ilamy's
// default `bg-background` resolves to paper across cells, headers, and view-header bands.
const CALENDAR_HEADER_CLASSNAME =
	"rounded-t-xl border-b border-[var(--line)] bg-[var(--paper)] px-3 py-2";
const CALENDAR_VIEW_HEADER_CLASSNAME = "bg-[var(--paper)]";
const CALENDAR_CLASSES_OVERRIDE = {
	disabledCell:
		"bg-[var(--paper-2)]/80 text-[var(--ink-4)] pointer-events-none",
};

// Custom now-line override — wired via renderCurrentTimeIndicator on the
// calendar components. Pulled out so the inline JSX inside
// commonCalendarProps stays tidy. Only the `progress` prop is used; the
// other props (currentTime, resource, view) are available if we ever want
// to show a time badge or per-view variant.
function renderNowLine({ progress }: { progress: number }) {
	return <CalendarNowLine progress={progress} />;
}

// Parse RRULE string into rrule.js options — defined outside component to avoid re-creation on every render
function parseRRule(rruleString: string) {
	const rule = RRule.fromString(rruleString);
	return rule.origOptions;
}

export default function CalendarClient() {
	const router = useRouter();
	const searchParams = useSearchParams();

	// Initialise from URL params so views/modes are bookmarkable
	const initialView = (() => {
		const v = searchParams.get("view");
		return v === "month" || v === "week" || v === "day" || v === "year"
			? v
			: "week";
	})();
	const initialMode =
		searchParams.get("mode") === "standard" ? "standard" : "resource";
	const initialOrientation =
		searchParams.get("orientation") === "vertical" ? "vertical" : "horizontal";

	const [currentDate, setCurrentDate] = useState(dayjs());
	const [currentView, setCurrentView] = useState<
		"month" | "week" | "day" | "year"
	>(initialView);
	// Staff can toggle between resource calendar and standard calendar
	const [calendarMode, setCalendarMode] = useState<"resource" | "standard">(
		initialMode,
	);
	const [orientation, setOrientation] = useState<"horizontal" | "vertical">(
		initialOrientation,
	);
	const initialFacilityId = searchParams.get("facility") ?? null;
	// Embed copy button feedback state
	const [embedCopied, setEmbedCopied] = useState(false);

	// Fetch user profile
	const { data: user, isLoading: userLoading } =
		api.user.getOrCreateProfile.useQuery();

	// Facility memberships for the dropdown
	const { data: facilityMemberships } =
		api.user.getFacilityMemberships.useQuery(undefined, {
			enabled: !userLoading && !!user,
		});
	// Selected facility — from URL param, falls back to user's active facility
	const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(
		initialFacilityId,
	);
	const effectiveFacilityId =
		selectedFacilityId ?? user?.activeFacilityId ?? null;
	const selectedFacilityMembership = facilityMemberships?.find(
		(m) => m.facilityId === effectiveFacilityId,
	);
	const activeFacilityName =
		selectedFacilityMembership?.facilityName ?? "All Facilities";

	// User timezone — derived early so viewRange can use it
	const userTimezone = user?.timeZone ?? dayjs.tz.guess();

	// Compute fetch range with ±1 week buffer, normalized to user timezone
	const viewRange = useMemo(() => {
		const effective = currentDate.tz(userTimezone);
		if (currentView === "year") {
			return {
				startDate: effective.startOf("year").subtract(1, "week").toDate(),
				endDate: effective.endOf("year").add(1, "week").toDate(),
			};
		}
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
	}, [currentDate, currentView, userTimezone]);

	// Fetch resources — scoped to selected facility (omit for all)
	const { data: resourcesData, isLoading: resourcesLoading } =
		api.calendar.getResources.useQuery({
			...(effectiveFacilityId && { facilityId: effectiveFacilityId }),
		});

	// Fetch events — gated on profile load so timezone is known before the first range is computed
	const { data: eventsData, isLoading: eventsLoading } =
		api.calendar.getEvents.useQuery(
			{
				startDate: viewRange.startDate,
				endDate: viewRange.endDate,
				facilityId: effectiveFacilityId ?? undefined,
			},
			{
				placeholderData: keepPreviousData,
				enabled: !userLoading,
			},
		);

	// Mutations
	const utils = api.useUtils();
	const { toast } = useToast();

	const createEventMutation = api.calendar.createEvent.useMutation({
		onSuccess: () => {
			void utils.calendar.getEvents.invalidate();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});
	const updateEventMutation = api.calendar.updateEvent.useMutation({
		onSuccess: () => {
			void utils.calendar.getEvents.invalidate();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});
	const deleteEventMutation = api.calendar.deleteEvent.useMutation({
		onSuccess: () => {
			void utils.calendar.getEvents.invalidate();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	// Role flags
	const isStudent = user?.userType === "STUDENT";
	const isCoach = user?.userType === "COACH";
	const isFacilityOrAdmin = user ? isFacilityOrAbove(user) : false;
	const canCreateEvents = isCoach || isFacilityOrAdmin;

	// Transform DB resources → ilamy Resource[]
	//
	// Resources without an explicit color in the DB pass `undefined` for
	// color/backgroundColor — so ilamy's ResourceCell renders no inline
	// style and the cell inherits the warm-paper background + dark ink
	// text from the [data-calendar-root] cascade. Resources WITH a custom
	// color stored use that color (operators can color-code specific
	// courts). The legacy DEFAULT_COLOR / DEFAULT_BG_COLOR fallbacks were
	// removed in favor of cascade-driven neutrals.
	const resources: Resource[] = useMemo(() => {
		if (!resourcesData?.resources) return [];

		return resourcesData.resources.map((r) => ({
			id: r.resourceId,
			title: r.title,
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
					: DEFAULT_RESOURCE_BUSINESS_HOURS,
		})) as Resource[];
	}, [resourcesData]);

	// Transform DB events → ilamy CalendarEvent[]
	const events: IlamyCalendarEvent[] = useMemo(() => {
		if (!eventsData?.events) return [];

		return eventsData.events.map((e) => ({
			id: e.eventId,
			title: e.title,
			start: dayjs(e.start),
			end: dayjs(e.end),
			description: e.description ?? undefined,
			color: e.color ?? undefined,
			backgroundColor: e.backgroundColor ?? undefined,
			allDay: e.allDay,
			resourceId: e.resourceId ?? undefined,
			resourceIds: e.resourceIds?.length ? e.resourceIds : undefined,
			uid: e.uid,
			rrule: e.rrule ? parseRRule(e.rrule) : undefined,
			exdates: e.exdates?.map((d) => d.toISOString()) ?? [],
			recurrenceId: e.recurrenceId ?? undefined,
			// Store DB metadata in data bag
			data: {
				dbEventId: e.eventId,
				eventType: e.eventType,
				isBlocking: e.isBlocking,
				isPublic: e.isPublic,
				maxParticipants: e.maxParticipants ?? null,
				currentRegistrations: e._count?.registrations ?? 0,
				priceInCents: e.product?.priceInCents ?? null,
				productId: e.productId ?? null,
				coachName: e.createdByUser?.firstName ?? null,
			},
		})) as IlamyCalendarEvent[];
	}, [eventsData]);

	// Event lifecycle handlers
	const handleEventUpdate = async (event: IlamyCalendarEvent) => {
		const dbEventId = (event.data?.dbEventId as string) ?? event.id;

		// Convert local times to UTC
		const startUtc = event.start.toDate();
		const endUtc = event.end.toDate();

		await updateEventMutation.mutateAsync({
			eventId: dbEventId,
			title: event.title,
			start: startUtc,
			end: endUtc,
			description: event.description,
			resourceId: event.resourceId?.toString(),
			allDay: event.allDay,
			color: event.color,
			backgroundColor: event.backgroundColor,
		});
	};

	const handleEventDelete = async (event: IlamyCalendarEvent) => {
		const dbEventId = (event.data?.dbEventId as string) ?? event.id;
		await deleteEventMutation.mutateAsync({ eventId: dbEventId });
	};

	// Stable renderEvent reference — must be memoized with useCallback. An inline
	// arrow function creates a new reference on every render, causing ilamy to
	// re-register its internal event rendering on each getEvents refetch, which
	// manifests as events reverting to unstyled plain text in the calendar cells.
	const renderEvent = useCallback(
		(e: IlamyCalendarEvent) => <CalendarEventBadge event={e} />,
		[],
	);

	// Push view/mode/orientation changes back into the URL (replace, not push)
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

	// Navigation handlers
	// ilamy may fire onDateChange synchronously during a child's render (e.g. when
	// initialDate drifts from its internal state). Calling setState there trips
	// React's "setState during render" guard. queueMicrotask defers to after the
	// current render; the isSame guard prevents re-render loops when ilamy echoes
	// the same date back on each render.
	const handleDateChange = useCallback((date: dayjs.Dayjs) => {
		queueMicrotask(() => {
			setCurrentDate((prev) => (prev.isSame(date) ? prev : date));
		});
	}, []);
	const handleViewChange = (view: "month" | "week" | "day" | "year") => {
		setCurrentView(view);
		syncUrl({ view });
	};
	const commonCalendarProps = {
		classesOverride: CALENDAR_CLASSES_OVERRIDE,
		firstDayOfWeek: "monday" as const,
		headerClassName: CALENDAR_HEADER_CLASSNAME,
		hideNonBusinessHours: true,
		initialDate: currentDate,
		initialView: currentView,
		onDateChange: handleDateChange,
		onViewChange: handleViewChange,
		renderCurrentTimeIndicator: renderNowLine,
		timeFormat: "12-hour" as const,
		timezone: userTimezone,
		viewHeaderClassName: CALENDAR_VIEW_HEADER_CLASSNAME,
	};
	const standardCalendarProps = {
		...commonCalendarProps,
		businessHours: DEFAULT_STANDARD_BUSINESS_HOURS,
	};

	// Loading state
	const isLoading = userLoading || resourcesLoading || eventsLoading;

	if (isLoading) {
		return (
			<div className="flex h-[calc(100vh-7.5rem)] items-center justify-center md:h-[calc(100vh-5rem)]">
				<div className="animate-pulse space-y-4">
					<div className="h-8 w-48 rounded bg-gray-200" />
					<div className="h-96 w-full rounded bg-gray-200" />
				</div>
			</div>
		);
	}

	// Build embed URL for the club calendar, preserving the current view/mode/orientation
	// so the iframe opens in exactly the state the admin is looking at.
	// TODO(multi-facility): when ClubFacility schema lands, append &facilityId=<id> here
	// so that each facility gets its own embeddable calendar URL.
	const clubShortName = user?.clubShortName;
	const embedUrl = clubShortName
		? (() => {
				const origin =
					typeof window !== "undefined" ? window.location.origin : "";
				const params = new URLSearchParams({
					view: currentView,
					mode: calendarMode,
					orientation,
				});
				return `${origin}/embed/${clubShortName}/calendar?${params.toString()}`;
			})()
		: null;
	const embedCode = embedUrl
		? `<iframe src="${embedUrl}" width="100%" height="700" frameborder="0" allow="fullscreen" style="border:none;border-radius:12px"></iframe>`
		: null;

	const handleCopyEmbed = async () => {
		if (!embedCode) return;
		await navigator.clipboard.writeText(embedCode);
		setEmbedCopied(true);
		setTimeout(() => setEmbedCopied(false), 2000);
	};

	// Pill-shaped toolbar buttons — matches the marketing aesthetic.
	// `text-sm` is preserved so existing layout doesn't shift.
	const TOOLBAR_BTN_CLASS =
		"inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--paper-2)] hover:text-[var(--ink)]";

	return (
		<div className="flex h-[calc(100vh-7.5rem)] flex-col overflow-hidden md:h-[calc(100vh-5rem)]">
			{/* Mono eyebrow + section title strip — matches the marketing
			 * CalendarMock's "Court calendar / Saturday, May 16" treatment but
			 * keeps the date itself owned by ilamy's internal header (per
			 * decision to not replace ilamy's header in this round). */}
			<div className="px-4 pt-3">
				<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
					Court calendar
				</div>
			</div>
			{/* Calendar toolbar */}
			<div className="flex flex-wrap items-center gap-2 px-4 pt-2">
				{facilityMemberships && (
					<FacilitySelector
						facilities={facilityMemberships}
						selectedFacilityId={effectiveFacilityId}
						onSelect={(id) => {
							setSelectedFacilityId(id);
							syncUrl({ facility: id });
						}}
					/>
				)}

				<div className="ml-auto flex flex-wrap items-center gap-2">
					{(isFacilityOrAdmin || isCoach) && (
						<>
							{/* Resource ↔ Standard view toggle */}
							<button
								type="button"
								onClick={() => {
									const next =
										calendarMode === "standard" ? "resource" : "standard";
									if (next === "resource" && currentView === "year")
										setCurrentView("month");
									setCalendarMode(next);
									syncUrl({ mode: next });
								}}
								className={TOOLBAR_BTN_CLASS}
								title={
									calendarMode === "resource"
										? "Switch to standard calendar"
										: "Switch to resource calendar"
								}
							>
								{calendarMode === "resource" ? (
									<LayoutGrid size={16} />
								) : (
									<Columns size={16} />
								)}
								{calendarMode === "resource"
									? "Standard View"
									: "Resource View"}
							</button>
							{/* Orientation toggle — only in resource mode */}
							{calendarMode === "resource" && (
								<button
									type="button"
									onClick={() => {
										const next =
											orientation === "horizontal" ? "vertical" : "horizontal";
										setOrientation(next);
										syncUrl({ orientation: next });
									}}
									className={TOOLBAR_BTN_CLASS}
								>
									{orientation === "horizontal"
										? "Vertical Layout"
										: "Horizontal Layout"}
								</button>
							)}
							{/* Embed code copy — only for facility/admin who have a club */}
							{isFacilityOrAdmin && embedCode && (
								<button
									type="button"
									onClick={() => void handleCopyEmbed()}
									className={TOOLBAR_BTN_CLASS}
									title="Copy embed code for your public calendar"
								>
									{embedCopied ? (
										<Check size={16} className="text-[var(--good)]" />
									) : (
										<Clipboard size={16} />
									)}
									{embedCopied ? "Copied!" : "Embed This Calendar View"}
								</button>
							)}
							{isFacilityOrAdmin && (
								<Link href="/calendar/resources" className={TOOLBAR_BTN_CLASS}>
									<Settings size={16} />
									Manage Resources
								</Link>
							)}
						</>
					)}
				</div>
			</div>
			<div className="flex-1 overflow-y-auto p-4">
				{/* ring-1 instead of border: a real CSS border adds a box edge that renders flush
				    against the overflow-hidden clip boundary, causing the inner corners to appear
				    square. ring renders as an inset box-shadow so the rounded clip applies cleanly.
				    All modes use overflow-hidden on the inner card; the outer flex-1 container
				    scrolls so the full time range (9am–midnight) is always reachable.
				    bg uses --paper directly (not via --background) so that ilamy's interior
				    cells — which DO consume --background via the var override on this same
				    [data-calendar-root] selector — render warm paper without the outer card's
				    bg fighting the cascade. */}
				<div
					data-calendar-root
					className="overflow-hidden rounded-2xl bg-[var(--paper)] shadow-sm ring-1 ring-[var(--line)]"
				>
					{isStudent ? (
						// Students: standard calendar (no resource columns), click navigates directly to event page
						<IlamyCalendar
							{...standardCalendarProps}
							key={userTimezone}
							events={events}
							disableCellClick={true}
							disableDragAndDrop={true}
							disableEventClick={false}
							renderEvent={renderEvent}
							onEventClick={(e) => {
								const dbEventId = (
									e.data as Record<string, unknown> | undefined
								)?.dbEventId as string | undefined;
								if (dbEventId) router.push(`/events/${dbEventId}`);
							}}
						/>
					) : calendarMode === "resource" ? (
						// Staff: resource calendar (default)
						<IlamyResourceCalendar
							{...commonCalendarProps}
							key={`resource-${userTimezone}-${orientation}`}
							resources={resources}
							events={events}
							orientation={orientation}
							disableCellClick={!canCreateEvents}
							disableDragAndDrop={!canCreateEvents}
							disableEventClick={false}
							renderEvent={renderEvent}
							onEventUpdate={canCreateEvents ? handleEventUpdate : undefined}
							onEventDelete={canCreateEvents ? handleEventDelete : undefined}
							renderEventForm={(props) => (
								<EventFormModal
									{...props}
									resources={resources}
									userType={user?.userType}
									facilityId={effectiveFacilityId ?? undefined}
									facilityName={activeFacilityName}
								/>
							)}
						/>
					) : (
						// Staff: standard calendar (toggled)
						<IlamyCalendar
							{...standardCalendarProps}
							key={`standard-${userTimezone}`}
							events={events}
							disableCellClick={!canCreateEvents}
							disableDragAndDrop={!canCreateEvents}
							disableEventClick={false}
							renderEvent={renderEvent}
							// Event lifecycle (wired for COACH and FACILITY/ADMIN)
							// onEventAdd intentionally omitted — EventFormModal.createMutation handles creation directly
							onEventUpdate={canCreateEvents ? handleEventUpdate : undefined}
							onEventDelete={canCreateEvents ? handleEventDelete : undefined}
							renderEventForm={(props) => (
								<EventFormModal
									{...props}
									resources={resources}
									userType={user?.userType}
									facilityId={effectiveFacilityId ?? undefined}
									facilityName={activeFacilityName}
								/>
							)}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
