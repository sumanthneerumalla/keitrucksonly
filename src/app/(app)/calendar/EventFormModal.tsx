"use client";
// TODO: This file is a local port of the ilamy-calendar EventForm + EventFormDialog components.
// If the PR #80 exporting EventForm, EventFormDialog, and RecurrenceEditor is merged and released
// (see: https://github.com/kcsujeet/ilamy-calendar), replace this file by importing directly:
//   import { EventFormDialog } from "@ilamy/calendar";
// and removing EventFormModal.tsx + RecurrenceEditor.tsx from this directory.

import type {
	CalendarEvent as IlamyCalendarEvent,
	Resource,
} from "@ilamy/calendar";
import type { RRuleOptions } from "@ilamy/calendar";
import dayjs from "dayjs";
import {
	Building2,
	Check,
	ChevronsUpDown,
	ExternalLink,
	Trash2,
	X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RRule } from "rrule";
import { RecurrenceEditor } from "~/app/(app)/calendar/RecurrenceEditor";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "~/app/_components/shared/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import { Select } from "~/app/_components/shared/ui/select";
import { COLOR_OPTIONS } from "~/lib/constants";
import { isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";

type EventTypeValue =
	| "BLOCK"
	| "BOOKABLE"
	| "COACHING_SLOT"
	| "RENTAL_WINDOW"
	| "DROP_IN";

interface EventFormModalProps {
	open?: boolean;
	selectedEvent?: IlamyCalendarEvent | null;
	onAdd?: (event: IlamyCalendarEvent) => void;
	onUpdate?: (event: IlamyCalendarEvent) => void;
	onDelete?: (event: IlamyCalendarEvent) => void;
	onClose: () => void;
	resources: Resource[];
	userType?: string;
	facilityId?: string;
	facilityName?: string;
	defaultEventType?: EventTypeValue;
}

function toDatetimeLocal(d: dayjs.Dayjs): string {
	return d.format("YYYY-MM-DDTHH:mm");
}

const DATETIME_STEP_SECONDS = 15 * 60;

export default function EventFormModal({
	open,
	selectedEvent,
	onAdd,
	onUpdate,
	onDelete,
	onClose,
	resources,
	userType,
	facilityId,
	facilityName,
	defaultEventType: defaultEventTypeProp,
}: EventFormModalProps) {
	// isEdit: selectedEvent has a real db id (non-empty string) — not a new-event temp object
	const isEdit = selectedEvent?.id != null && selectedEvent.id !== "";

	const isCoach = userType === "COACH";
	const isFacilityOrAdmin = userType ? isFacilityOrAbove({ userType }) : false;
	const defaultEventType: EventTypeValue =
		defaultEventTypeProp ?? (isCoach ? "COACHING_SLOT" : "BOOKABLE");

	// Fetch full event details when editing, to determine edit permissions
	const dbEventId = isEdit
		? (((selectedEvent?.data as Record<string, unknown> | undefined)
				?.dbEventId as string | undefined) ?? String(selectedEvent?.id ?? ""))
		: null;
	const { data: fetchedEvent } = api.calendar.getEventById.useQuery(
		{ eventId: dbEventId! },
		{ enabled: open === true && dbEventId !== null },
	);
	const { data: currentUser } = api.user.getOrCreateProfile.useQuery();

	// canEdit: owns the event OR is FACILITY/ADMIN on same club
	const canEdit =
		!isEdit ||
		(fetchedEvent != null &&
			(isFacilityOrAdmin ||
				(currentUser != null &&
					fetchedEvent.createdByUserId === currentUser.userId)));

	const [title, setTitle] = useState("");
	const [resourceId, setResourceId] = useState("");
	const [start, setStart] = useState("");
	const [end, setEnd] = useState("");
	const [allDay, setAllDay] = useState(false);
	const [rruleOpts, setRruleOpts] = useState<RRuleOptions | null>(null);
	const [saving, setSaving] = useState(false);
	const [eventType, setEventType] = useState<EventTypeValue>(defaultEventType);
	const [productId, setProductId] = useState<string>("");
	const [color, setColor] = useState<string>("");
	const [scope, setScope] = useState<"THIS" | "THIS_AND_FUTURE" | "ALL">("ALL");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [productPickerOpen, setProductPickerOpen] = useState(false);
	// RENTAL_WINDOW-specific state
	const [resourceIds, setResourceIds] = useState<string[]>([]);
	const [maxBookingHours, setMaxBookingHours] = useState(2);
	const [cancelCutoffHours, setCancelCutoffHours] = useState<string>("");
	const [courtPickerOpen, setCourtPickerOpen] = useState(false);

	// Reset saving state and scope when modal opens
	useEffect(() => {
		if (open) {
			setSaving(false);
			setScope("ALL");
		}
	}, [open]);

	// Populate form when modal opens
	useEffect(() => {
		if (!open) return;
		// Reset rental-specific fields on every open; the second useEffect seeds them
		// from fetchedEvent for edits and they stay at defaults for new events.
		setResourceIds([]);
		setMaxBookingHours(2);
		setCancelCutoffHours("");
		if (isEdit && selectedEvent) {
			setTitle(selectedEvent.title ?? "");
			setResourceId(selectedEvent.resourceId?.toString() ?? "");
			setStart(toDatetimeLocal(selectedEvent.start));
			setEnd(toDatetimeLocal(selectedEvent.end));
			setAllDay(selectedEvent.allDay ?? false);
			setRruleOpts((selectedEvent.rrule as RRuleOptions | undefined) ?? null);
			const data = selectedEvent.data as Record<string, unknown> | undefined;
			setEventType(
				(data?.eventType as EventTypeValue | undefined) ?? defaultEventType,
			);
			setProductId((data?.productId as string | undefined) ?? "");
			setColor(selectedEvent.backgroundColor ?? "");
		} else if (selectedEvent) {
			// New event — pre-fill times from clicked slot
			setTitle("");
			const clickedCourt = selectedEvent.resourceId?.toString() ?? "";
			setResourceId(clickedCourt);
			// Seed the multi-court picker (BOOKABLE/RENTAL_WINDOW) with the clicked court.
			setResourceIds(clickedCourt ? [clickedCourt] : []);
			setStart(toDatetimeLocal(selectedEvent.start));
			setEnd(toDatetimeLocal(selectedEvent.end));
			setAllDay(selectedEvent.allDay ?? false);
			setRruleOpts(null);
			setEventType(defaultEventType);
			setProductId("");
			setColor("");
		} else {
			setTitle("");
			setResourceId("");
			setStart(toDatetimeLocal(dayjs()));
			setEnd(toDatetimeLocal(dayjs().add(1, "hour")));
			setAllDay(false);
			setRruleOpts(null);
			setEventType(defaultEventType);
			setProductId("");
			setColor("");
		}
	}, [open, selectedEvent, isEdit, defaultEventType]);

	// Populate rental-specific fields from fetchedEvent (async — arrives after modal opens)
	useEffect(() => {
		if (!fetchedEvent) return;
		// BOOKABLE and DROP_IN use one flat "Courts" multi-select (like RENTAL_WINDOW).
		// Hydrate it with the full set of courts — primary resourceId + any additional
		// resourceIds, deduped — since the calendar lib renders on resourceIds when present.
		if (
			fetchedEvent.eventType === "BOOKABLE" ||
			fetchedEvent.eventType === "DROP_IN"
		) {
			setResourceIds(
				Array.from(
					new Set(
						[
							fetchedEvent.resourceId,
							...(fetchedEvent.resourceIds ?? []),
						].filter((id): id is string => !!id),
					),
				),
			);
			return;
		}
		if (fetchedEvent.eventType !== "RENTAL_WINDOW") return;
		setResourceIds(fetchedEvent.resourceIds ?? []);
		setMaxBookingHours(fetchedEvent.maxBookingHours ?? 2);
		setCancelCutoffHours(
			fetchedEvent.earlyCancelCutoffHours != null
				? String(fetchedEvent.earlyCancelCutoffHours)
				: "",
		);
		// Reseed start/end from the BASE event. selectedEvent may carry an OCCURRENCE's
		// times (calendar client-side rrule expansion; /admin/rentals date-filtered row),
		// and updateRentalWindow rewrites base.start/end — so a no-op save would otherwise
		// shift the entire series anchor to the occurrence's date. Safe to overwrite the
		// first useEffect's seed here: rental windows are series-level only (plan §2i).
		setStart(toDatetimeLocal(dayjs(fetchedEvent.start)));
		setEnd(toDatetimeLocal(dayjs(fetchedEvent.end)));
		// When opened from /admin/rentals, selectedEvent.rrule isn't populated;
		// seed rruleOpts from the fetched rrule string so staff can edit the pattern.
		if (fetchedEvent.rrule && !rruleOpts) {
			try {
				setRruleOpts(
					RRule.fromString(fetchedEvent.rrule).origOptions as RRuleOptions,
				);
			} catch {
				// ignore parse errors
			}
		}
		// rruleOpts intentionally omitted: this effect is a one-time bootstrap when
		// fetchedEvent arrives with an rrule. Including it would re-seed on every
		// user edit of the recurrence pattern, overwriting their changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fetchedEvent]);

	// All hooks must be above early return (rules of hooks)
	const utils = api.useUtils();
	const { toast } = useToast();

	// Fetch products for the selector (BOOKABLE/COACHING_SLOT only)
	const { data: productsData } = api.products.getProducts.useQuery(
		{},
		{
			enabled: !!open && eventType !== "BLOCK" && eventType !== "RENTAL_WINDOW",
		},
	);

	// Derive the selected product label for the combobox trigger
	const selectedProductLabel = useMemo(() => {
		if (!productId) return "— No product (free) —";
		const match = productsData?.products.find((p) => p.productId === productId);
		return match
			? `${match.name} ($${(match.priceInCents / 100).toFixed(2)})`
			: "— No product (free) —";
	}, [productId, productsData]);

	const createMutation = api.calendar.createEvent.useMutation({
		onSuccess: () => {
			void utils.calendar.getEvents.invalidate();
			onAdd?.(buildEvent());
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => {
			setSaving(false);
		},
	});
	const updateMutation = api.calendar.updateEvent.useMutation({
		onSuccess: () => {
			void utils.calendar.getEvents.invalidate();
			onUpdate?.(buildEvent());
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => {
			setSaving(false);
		},
	});
	const deleteMutation = api.calendar.deleteEvent.useMutation({
		onSuccess: () => {
			void utils.calendar.getEvents.invalidate();
			onDelete?.(selectedEvent!);
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => {
			setSaving(false);
		},
	});

	const invalidateAfterRentalMutation = () => {
		void utils.calendar.getEvents.invalidate();
		void utils.rentals.listRentalWindows.invalidate();
	};

	const rentalsCreateMutation = api.rentals.createRentalWindow.useMutation({
		onSuccess: () => {
			invalidateAfterRentalMutation();
			onAdd?.(buildEvent());
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => {
			setSaving(false);
		},
	});
	const rentalsUpdateMutation = api.rentals.updateRentalWindow.useMutation({
		onSuccess: () => {
			invalidateAfterRentalMutation();
			onUpdate?.(buildEvent());
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => {
			setSaving(false);
		},
	});
	const rentalsDeleteMutation = api.rentals.deleteRentalWindow.useMutation({
		onSuccess: () => {
			invalidateAfterRentalMutation();
			onDelete?.(selectedEvent!);
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => {
			setSaving(false);
		},
	});

	const buildEvent = useCallback(
		(): IlamyCalendarEvent =>
			({
				...(selectedEvent ?? {}),
				id: selectedEvent?.id ?? "",
				title,
				start: dayjs(start),
				end: dayjs(end),
				resourceId: resourceId || undefined,
				allDay,
				backgroundColor: color || undefined,
				color: color
					? (COLOR_OPTIONS.find((o) => o.bg === color)?.text ?? "#1e293b")
					: undefined,
			}) as IlamyCalendarEvent,
		[selectedEvent, title, start, end, resourceId, allDay, color],
	);

	if (!open) return null;

	// While fetching permissions on edit, show loading shell
	const isLoadingPermissions = isEdit && !fetchedEvent;

	// Read-only view: RENTAL_BOOKING events are managed via /admin/rentals/{windowId}.
	// Staff still land here via the calendar but are sent to the window page for any changes.
	if (isEdit && fetchedEvent && fetchedEvent.eventType === "RENTAL_BOOKING") {
		const windowId = fetchedEvent.bookingBlockEvent?.rentalWindowEventId;
		return (
			<>
				<div
					className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
					onClick={onClose}
				/>
				<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
					<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
						<h2 className="font-semibold text-[var(--foreground)] text-base">
							{fetchedEvent.title}
						</h2>
						<button
							onClick={onClose}
							className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
							aria-label="Close"
						>
							<X size={18} />
						</button>
					</div>
					<div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
						<p className="text-[var(--muted-foreground)] text-sm">
							{dayjs(fetchedEvent.start).format("ddd, MMM D · h:mm A")} –{" "}
							{dayjs(fetchedEvent.end).format("h:mm A")}
						</p>
						{fetchedEvent.resource && (
							<p className="text-[var(--muted-foreground)] text-sm">
								Court:{" "}
								<span className="text-[var(--foreground)]">
									{fetchedEvent.resource.title}
								</span>
							</p>
						)}
						{windowId && (
							<Link
								href={`/admin/rentals/${windowId}`}
								onClick={onClose}
								className="inline-flex items-center gap-1.5 text-[var(--primary)] text-sm underline-offset-2 hover:underline"
							>
								<ExternalLink size={13} /> Manage bookings
							</Link>
						)}
					</div>
					<div className="flex justify-end border-[var(--border)] border-t px-6 py-4">
						<Button variant="outline" size="sm" onClick={onClose}>
							Close
						</Button>
					</div>
				</div>
			</>
		);
	}

	// Read-only view: editing an event you don't own
	if (isEdit && fetchedEvent && !canEdit) {
		const evType = fetchedEvent.eventType;
		return (
			<>
				<div
					className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
					onClick={onClose}
				/>
				<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
					<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
						<h2 className="font-semibold text-[var(--foreground)] text-base">
							{fetchedEvent.title}
						</h2>
						<button
							onClick={onClose}
							className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
							aria-label="Close"
						>
							<X size={18} />
						</button>
					</div>
					<div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
						<p className="text-[var(--muted-foreground)] text-sm">
							{dayjs(fetchedEvent.start).format("ddd, MMM D · h:mm A")} –{" "}
							{dayjs(fetchedEvent.end).format("h:mm A")}
						</p>
						{fetchedEvent.resource && (
							<p className="text-[var(--muted-foreground)] text-sm">
								Resource:{" "}
								<span className="text-[var(--foreground)]">
									{fetchedEvent.resource.title}
								</span>
							</p>
						)}
						{fetchedEvent.description && (
							<p className="whitespace-pre-wrap text-[var(--foreground)] text-sm">
								{fetchedEvent.description}
							</p>
						)}
						{(evType === "BOOKABLE" || evType === "COACHING_SLOT") && (
							<Link
								href={`/events/${fetchedEvent.eventId}`}
								onClick={onClose}
								className="inline-flex items-center gap-1.5 text-[var(--primary)] text-sm underline-offset-2 hover:underline"
							>
								<ExternalLink size={13} /> View event details
							</Link>
						)}
					</div>
					<div className="flex justify-end border-[var(--border)] border-t px-6 py-4">
						<Button variant="outline" size="sm" onClick={onClose}>
							Close
						</Button>
					</div>
				</div>
			</>
		);
	}

	const handleSave = () => {
		if (!title.trim()) return;

		const rruleString = rruleOpts
			? new RRule(
					rruleOpts as ConstructorParameters<typeof RRule>[0],
				).toString()
			: undefined;
		const colorText = color
			? (COLOR_OPTIONS.find((o) => o.bg === color)?.text ?? "#1e293b")
			: undefined;
		const startDate = dayjs(start).toDate();
		const endDate = dayjs(end).toDate();

		if (eventType === "RENTAL_WINDOW") {
			if (resourceIds.length === 0) {
				toast("Select at least one court.", "error");
				return;
			}
			// null = explicitly clear cutoff (for edits); matches server-side semantics for
			// both create and update now that createRentalWindow accepts nullable.
			const parsedCutoff =
				cancelCutoffHours.trim() !== ""
					? Number.parseInt(cancelCutoffHours, 10)
					: null;
			setSaving(true);
			if (isEdit && selectedEvent) {
				const dbEventId =
					((selectedEvent.data as Record<string, unknown> | undefined)
						?.dbEventId as string | undefined) ??
					String(selectedEvent?.id ?? "");
				rentalsUpdateMutation.mutate({
					eventId: dbEventId,
					title,
					start: startDate,
					end: endDate,
					courtIds: resourceIds,
					maxBookingHours,
					earlyCancelCutoffHours: parsedCutoff,
					rrule: rruleString,
					color: colorText,
					backgroundColor: color || undefined,
				});
			} else {
				if (!facilityId) {
					toast("No facility selected for this rental window.", "error");
					setSaving(false);
					return;
				}
				rentalsCreateMutation.mutate({
					facilityId,
					title,
					start: startDate,
					end: endDate,
					courtIds: resourceIds,
					maxBookingHours,
					earlyCancelCutoffHours: parsedCutoff,
					rrule: rruleString,
					color: colorText,
					backgroundColor: color || undefined,
				});
			}
			return;
		}

		setSaving(true);
		// BOOKABLE and DROP_IN (Rotation Play) use the flat "Courts" multi-select
		// (`resourceIds` state). Store the first selection as the primary `resourceId`
		// (single-court consumers still read it) and the FULL set as `resourceIds` only
		// when 2+ courts — the calendar lib renders an event on `resourceIds` when
		// present, so it must hold every reserved court. A single-court event keeps the
		// legacy shape (resourceId set, no extras).
		const usesMultiCourt = eventType === "BOOKABLE" || eventType === "DROP_IN";
		const primaryResourceId = usesMultiCourt
			? resourceIds[0] || undefined
			: resourceId || undefined;
		const multiCourtIds =
			usesMultiCourt && resourceIds.length > 1 ? resourceIds : undefined;
		if (isEdit && selectedEvent) {
			const dbEventId =
				((selectedEvent.data as Record<string, unknown> | undefined)
					?.dbEventId as string | undefined) ?? String(selectedEvent?.id ?? "");
			const isRecurring = !!fetchedEvent?.rrule;
			updateMutation.mutate({
				eventId: dbEventId,
				title,
				start: startDate,
				end: endDate,
				resourceId: primaryResourceId,
				// Send [] (not undefined) for single-court BOOKABLE so deselecting down to
				// one court clears any previously-stored extra courts. undefined = "leave
				// unchanged", which would strand stale resourceIds.
				resourceIds: usesMultiCourt ? (multiCourtIds ?? []) : undefined,
				allDay,
				productId: productId || undefined,
				// MVP: creditCost is always 1 for product-linked events. No UI input exists for
				// multi-credit events yet. This means editing any event resets creditCost to 1.
				// Acceptable because we have zero multi-credit events in production today.
				// See HANDOFF decision #63. When multi-credit events are needed, either
				// (a) preserve the existing value on edit, or (b) add a creditCost number input.
				creditCost: productId ? 1 : null,
				backgroundColor: color || undefined,
				color: colorText,
				...(isRecurring && {
					scope,
					instanceDate: selectedEvent.start.toDate(),
				}),
			});
		} else {
			createMutation.mutate({
				title,
				start: startDate,
				end: endDate,
				resourceId: primaryResourceId,
				resourceIds: multiCourtIds,
				facilityId: facilityId || undefined,
				allDay,
				productId: productId || undefined,
				rrule: rruleString,
				eventType,
				backgroundColor: color || undefined,
				color: colorText,
			});
		}
	};

	const handleDelete = () => {
		if (!selectedEvent) return;
		setConfirmDelete(true);
	};

	const executeDelete = () => {
		if (!selectedEvent) return;
		setConfirmDelete(false);
		setSaving(true);
		const dbEventId =
			((selectedEvent.data as Record<string, unknown> | undefined)?.dbEventId as
				| string
				| undefined) ?? String(selectedEvent.id);
		if (fetchedEvent?.eventType === "RENTAL_WINDOW") {
			rentalsDeleteMutation.mutate({ eventId: dbEventId });
			return;
		}
		const isRecurring = !!fetchedEvent?.rrule;
		deleteMutation.mutate({
			eventId: dbEventId,
			...(isRecurring && { scope, instanceDate: selectedEvent.start.toDate() }),
		});
	};

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
				onClick={saving ? undefined : onClose}
			/>

			{/* Slide-over panel */}
			<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
				{/* Header */}
				<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
					<div>
						<h2 className="font-semibold text-[var(--foreground)] text-base">
							{isLoadingPermissions
								? "Loading…"
								: isEdit
									? "Edit Event"
									: "New Event"}
						</h2>
						{facilityName && (
							<p className="mt-1 flex items-center gap-1.5 text-[var(--foreground)] text-sm">
								<Building2
									size={14}
									className="text-[var(--muted-foreground)]"
								/>
								<span className="font-semibold">{facilityName}</span>
							</p>
						)}
					</div>
					<button
						onClick={onClose}
						className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
						aria-label="Close"
					>
						<X size={18} />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
					{isLoadingPermissions && (
						<div className="animate-pulse space-y-3">
							<div className="h-4 w-2/3 rounded bg-[var(--muted)]" />
							<div className="h-4 w-1/2 rounded bg-[var(--muted)]" />
						</div>
					)}
					{/* Event Type — hidden for coaches (always COACHING_SLOT) */}
					{isFacilityOrAdmin && (
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Event Type
							</label>
							<Select
								value={eventType}
								onChange={(e) => {
									setEventType(e.target.value as EventTypeValue);
									setProductId("");
								}}
								disabled={isEdit}
								className="h-9"
							>
								<option value="BOOKABLE">
									Bookable — students can register
								</option>
								<option value="DROP_IN">
									Rotation Play — managed drop-in games
								</option>
								<option value="BLOCK">Block — internal scheduling</option>
								<option value="RENTAL_WINDOW">
									Rental Window — court availability
								</option>
							</Select>
							{eventType === "BOOKABLE" || eventType === "COACHING_SLOT" ? (
								<p className="text-[var(--muted-foreground)] text-xs">
									Set visibility, capacity, and other details on the event page
									after creation.
								</p>
							) : null}
						</div>
					)}

					{/* Title */}
					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Title <span className="text-red-500">*</span>
						</label>
						<Input
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Event title"
							maxLength={500}
						/>
					</div>

					{/* Resource (single) — for BLOCK / COACHING_SLOT. RENTAL_WINDOW and
					    BOOKABLE use the flat multi-court "Courts" picker below instead. */}
					{resources.length > 0 &&
						eventType !== "RENTAL_WINDOW" &&
						eventType !== "BOOKABLE" &&
						eventType !== "DROP_IN" && (
							<div className="space-y-1">
								<label className="font-medium text-[var(--foreground)] text-sm">
									Resource
								</label>
								<Select
									value={resourceId}
									onChange={(e) => setResourceId(e.target.value)}
									className="h-9"
								>
									<option value="">— No resource —</option>
									{resources.map((r) => (
										<option key={r.id} value={r.id}>
											{r.title}
										</option>
									))}
								</Select>
							</div>
						)}

					{/* Rental fields skeleton — shown while fetchedEvent is still loading on edit.
					    Avoids the "empty fields flash" where courts/maxBookingHours/cutoff briefly
					    render with defaults before the second useEffect hydrates from fetchedEvent,
					    which could silently overwrite staff input typed during the fetch window. */}
					{eventType === "RENTAL_WINDOW" && isEdit && !fetchedEvent && (
						<div
							className="space-y-3"
							role="status"
							aria-live="polite"
							aria-busy="true"
							aria-label="Loading rental window details"
						>
							<div className="space-y-1">
								<label className="font-medium text-[var(--foreground)] text-sm">
									Courts <span className="text-red-500">*</span>
								</label>
								<div className="h-9 animate-pulse rounded-md bg-[var(--muted)]" />
							</div>
						</div>
					)}

					{/* Courts (multi-select) — the single court control for both
					    RENTAL_WINDOW and BOOKABLE. BOOKABLE uses it so a drop-in / open-play
					    event can reserve several courts at once (optional for BOOKABLE,
					    required for RENTAL_WINDOW). */}
					{(eventType === "RENTAL_WINDOW" ||
						eventType === "BOOKABLE" ||
						eventType === "DROP_IN") &&
						(!isEdit || fetchedEvent) && (
							<div className="space-y-1">
								<label className="font-medium text-[var(--foreground)] text-sm">
									{eventType === "BOOKABLE" || eventType === "DROP_IN" ? (
										"Courts"
									) : (
										<>
											Courts <span className="text-red-500">*</span>
										</>
									)}
								</label>
								<Popover
									open={courtPickerOpen}
									onOpenChange={setCourtPickerOpen}
								>
									<PopoverTrigger asChild>
										<button
											type="button"
											className="flex h-auto min-h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
										>
											<span
												className={
													resourceIds.length
														? "flex flex-wrap gap-1 text-[var(--foreground)]"
														: "text-[var(--muted-foreground)]"
												}
											>
												{resourceIds.length ? (
													resourceIds.map((rid) => {
														const r = resources.find((res) => res.id === rid);
														return (
															<span
																key={rid}
																className="inline-flex items-center rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs"
															>
																{r?.title ?? rid}
															</span>
														);
													})
												) : (
													<>Select courts…</>
												)}
											</span>
											<ChevronsUpDown
												size={14}
												className="ml-2 shrink-0 opacity-50"
											/>
										</button>
									</PopoverTrigger>
									<PopoverContent
										className="w-[--radix-popover-trigger-width] p-0"
										align="start"
									>
										<Command>
											<CommandInput placeholder="Search courts…" />
											<CommandList>
												<CommandEmpty>No courts found.</CommandEmpty>
												<CommandGroup>
													{resources.map((r) => {
														const selected = resourceIds.includes(
															r.id.toString(),
														);
														return (
															<CommandItem
																key={r.id}
																value={r.title}
																onSelect={() => {
																	const rid = r.id.toString();
																	setResourceIds((prev) =>
																		prev.includes(rid)
																			? prev.filter((p) => p !== rid)
																			: [...prev, rid],
																	);
																}}
															>
																<span className="mr-2 flex h-4 w-4 items-center justify-center">
																	{selected && <Check size={14} />}
																</span>
																{r.title}
															</CommandItem>
														);
													})}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>
								{resources.length === 0 && (
									<p className="text-[var(--muted-foreground)] text-xs">
										No courts found for this facility.
									</p>
								)}
							</div>
						)}

					{/* All day — hidden for RENTAL_WINDOW (always time-bounded) */}
					{eventType !== "RENTAL_WINDOW" && (
						<label className="flex cursor-pointer select-none items-center gap-2 text-[var(--foreground)] text-sm">
							<input
								type="checkbox"
								checked={allDay}
								onChange={(e) => setAllDay(e.target.checked)}
								className="h-4 w-4 rounded border-input accent-[var(--primary)]"
							/>
							All day
						</label>
					)}

					{/* Start */}
					{!allDay && (
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Start
							</label>
							<Input
								type="datetime-local"
								value={start}
								onChange={(e) => setStart(e.target.value)}
								step={DATETIME_STEP_SECONDS}
							/>
						</div>
					)}

					{/* End */}
					{!allDay && (
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								End
							</label>
							<Input
								type="datetime-local"
								value={end}
								onChange={(e) => setEnd(e.target.value)}
								step={DATETIME_STEP_SECONDS}
							/>
						</div>
					)}

					{/* Recurrence — always shown for create; on edit, shown for RENTAL_WINDOW + BLOCK only.
					    BOOKABLE/COACHING_SLOT pattern edits hidden until registration migration ships
					    (TODO at calendar.ts). RENTAL_WINDOW bookings hold their original times regardless
					    of pattern change. BLOCK has no registrations so pattern edits are safe. */}
					{(!isEdit ||
						eventType === "RENTAL_WINDOW" ||
						eventType === "BLOCK") && (
						<div className="space-y-1">
							<RecurrenceEditor
								value={rruleOpts}
								onChange={setRruleOpts}
								disabled={isEdit && eventType === "BLOCK" && scope !== "ALL"}
								disabledReason="Pattern can only be changed when scope is 'All events in series'."
							/>
						</div>
					)}

					{/* Recurrence scope selector — shown when editing a recurring event.
					    Hidden for RENTAL_WINDOW: backend is series-level only (no per-instance scope). */}
					{isEdit && fetchedEvent?.rrule && eventType !== "RENTAL_WINDOW" && (
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Edit scope
							</label>
							<Select
								value={scope}
								onChange={(e) =>
									setScope(e.target.value as "THIS" | "THIS_AND_FUTURE" | "ALL")
								}
								className="h-9"
							>
								<option value="ALL">All events in series</option>
								<option value="THIS">This event only</option>
								<option value="THIS_AND_FUTURE">
									This and following events
								</option>
							</Select>
						</div>
					)}

					{/* Color picker */}
					<div className="space-y-2">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Color
						</label>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => setColor("")}
								title="Default"
								className={`h-6 w-6 rounded-full border-2 bg-[var(--muted)] transition-all ${color === "" ? "scale-110 border-[var(--primary)]" : "border-transparent"}`}
							/>
							{COLOR_OPTIONS.map((opt) => (
								<button
									key={opt.bg}
									type="button"
									onClick={() => setColor(opt.bg)}
									title={opt.label}
									style={{ backgroundColor: opt.bg }}
									className={`h-6 w-6 rounded-full border-2 transition-all ${color === opt.bg ? "scale-110 border-[var(--primary)]" : "border-transparent"}`}
								/>
							))}
						</div>
					</div>

					{/* Rental-specific numeric fields — same gating as the courts picker above.
					    On edit, wait for fetchedEvent so defaults (2h, blank) don't flash and
					    then silently overwrite any value the user typed during the fetch window. */}
					{eventType === "RENTAL_WINDOW" && isEdit && !fetchedEvent && (
						<>
							<div className="space-y-1">
								<label className="font-medium text-[var(--foreground)] text-sm">
									Max Booking Hours
								</label>
								<div className="h-9 animate-pulse rounded-md bg-[var(--muted)]" />
							</div>
							<div className="space-y-1">
								<label className="font-medium text-[var(--foreground)] text-sm">
									Cancellation Cutoff (hours before start)
								</label>
								<div className="h-9 animate-pulse rounded-md bg-[var(--muted)]" />
							</div>
						</>
					)}
					{eventType === "RENTAL_WINDOW" && (!isEdit || fetchedEvent) && (
						<>
							<div className="space-y-1">
								<label className="font-medium text-[var(--foreground)] text-sm">
									Max Booking Hours
								</label>
								<Input
									type="number"
									min={1}
									value={maxBookingHours}
									onChange={(e) =>
										setMaxBookingHours(
											Math.max(1, Number.parseInt(e.target.value, 10) || 1),
										)
									}
								/>
							</div>
							<div className="space-y-1">
								<label className="font-medium text-[var(--foreground)] text-sm">
									Cancellation Cutoff (hours before start)
								</label>
								<Input
									type="number"
									min={0}
									value={cancelCutoffHours}
									onChange={(e) => setCancelCutoffHours(e.target.value)}
									placeholder="None — free cancel"
								/>
								<p className="text-[var(--muted-foreground)] text-xs">
									Leave blank for unrestricted member cancellation.
								</p>
							</div>
						</>
					)}

					{/* Product selector — shown for BOOKABLE and COACHING_SLOT only */}
					{eventType !== "BLOCK" && eventType !== "RENTAL_WINDOW" && (
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Linked Product
							</label>
							<Popover
								open={productPickerOpen}
								onOpenChange={setProductPickerOpen}
							>
								<PopoverTrigger asChild>
									<button
										type="button"
										className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
									>
										<span
											className={
												productId
													? "text-[var(--foreground)]"
													: "text-[var(--muted-foreground)]"
											}
										>
											{selectedProductLabel}
										</span>
										<ChevronsUpDown
											size={14}
											className="ml-2 shrink-0 opacity-50"
										/>
									</button>
								</PopoverTrigger>
								<PopoverContent
									className="w-[--radix-popover-trigger-width] p-0"
									align="start"
								>
									<Command>
										<CommandInput placeholder="Search products..." />
										<CommandList>
											<CommandEmpty>No products found.</CommandEmpty>
											<CommandGroup>
												<CommandItem
													onSelect={() => {
														setProductId("");
														setProductPickerOpen(false);
													}}
												>
													— No product (free) —
												</CommandItem>
												{productsData?.products
													.filter((p) => p.isActive)
													.map((p) => (
														<CommandItem
															key={p.productId}
															value={p.name}
															onSelect={() => {
																setProductId(p.productId);
																setProductPickerOpen(false);
															}}
														>
															{p.name} ($
															{(p.priceInCents / 100).toFixed(2)})
														</CommandItem>
													))}
											</CommandGroup>
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
							{!productsData?.products.length && (
								<p className="text-[var(--muted-foreground)] text-xs">
									No products found.{" "}
									<a href="/products" className="underline">
										Create one first.
									</a>
								</p>
							)}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-[var(--border)] border-t px-6 py-4">
					<div className="flex items-center gap-2">
						{isEdit && !isLoadingPermissions && (
							<Button
								variant="outline"
								size="sm"
								onClick={handleDelete}
								className="border-red-200 text-red-600 hover:bg-red-50"
							>
								<Trash2 size={14} />
								Delete
							</Button>
						)}
						{isEdit &&
							dbEventId &&
							fetchedEvent &&
							(fetchedEvent.eventType === "BOOKABLE" ||
								fetchedEvent.eventType === "COACHING_SLOT" ||
								fetchedEvent.eventType === "DROP_IN") && (
								<Link
									href={`/events/${dbEventId}`}
									onClick={onClose}
									className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)] text-sm transition-colors hover:text-[var(--foreground)]"
								>
									<ExternalLink size={13} />{" "}
									{fetchedEvent.eventType === "DROP_IN"
										? "Open board"
										: "Event Page"}
								</Link>
							)}
					</div>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={onClose}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleSave}
							disabled={
								!title.trim() ||
								saving ||
								isLoadingPermissions ||
								(eventType === "RENTAL_WINDOW" && resourceIds.length === 0)
							}
						>
							{saving ? "Saving…" : isEdit ? "Save" : "Create"}
						</Button>
					</div>
				</div>
			</div>
			<AlertDialog
				open={confirmDelete}
				title="Delete event"
				description={
					fetchedEvent?.rrule
						? `This will ${scope === "THIS" ? "remove this occurrence" : scope === "THIS_AND_FUTURE" ? "delete this and all following occurrences" : "delete the entire series"}. This cannot be undone.`
						: "This event will be permanently deleted. This cannot be undone."
				}
				confirmLabel="Delete"
				destructive
				onConfirm={executeDelete}
				onCancel={() => setConfirmDelete(false)}
			/>
		</>
	);
}
