"use client";

import type {
	CalendarEvent as IlamyCalendarEvent,
	Resource,
} from "@ilamy/calendar";
import dayjs from "dayjs";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import EventFormModal from "~/app/(app)/calendar/EventFormModal";
import { parseLocalDate, toDateInputValue } from "~/app/(app)/rentals/utils";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { FacilitySelector } from "~/app/_components/shared/FacilitySelector";
import { useToast } from "~/app/_components/shared/Toast";
import { isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";

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
} as const;

// ─── Component ──────────────────────────────────────────────────────────────

export default function RentalWindowsClient() {
	const router = useRouter();
	const { toast } = useToast();
	const utils = api.useUtils();

	const [selectedDate, setSelectedDate] = useState(() =>
		toDateInputValue(new Date()),
	);
	const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(
		null,
	);
	const [showModal, setShowModal] = useState(false);
	const [editEvent, setEditEvent] = useState<IlamyCalendarEvent | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<{
		eventId: string;
		title: string;
	} | null>(null);

	// ── Queries ─────────────────────────────────────────────────────────────

	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();

	const canManage = user ? isFacilityOrAbove(user) : false;

	const { data: facilityMemberships } =
		api.user.getFacilityMemberships.useQuery(undefined, {
			enabled: !isUserLoading && !!user,
		});

	const effectiveFacilityId =
		selectedFacilityId ?? user?.activeFacilityId ?? null;

	const activeFacilityName = facilityMemberships?.find(
		(m) => m.facilityId === effectiveFacilityId,
	)?.facilityName;

	const { data: resourcesData } = api.calendar.getResources.useQuery(
		{
			...(effectiveFacilityId && { facilityId: effectiveFacilityId }),
		},
		{ enabled: !!user },
	);

	const { data: windows, isLoading: isWindowsLoading } =
		api.rentals.listRentalWindows.useQuery(
			{
				clubShortName: user?.clubShortName ?? "",
				facilityId: effectiveFacilityId ?? undefined,
				date: parseLocalDate(selectedDate),
			},
			{ enabled: !!user?.clubShortName && !!selectedDate },
		);

	const deleteMutation = api.rentals.deleteRentalWindow.useMutation({
		onSuccess: () => {
			void utils.rentals.listRentalWindows.invalidate();
			toast("Rental window deleted", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	// ── Transform DB resources → ilamy Resource[] shape ─────────────────────

	const resources: Resource[] = useMemo(() => {
		if (!resourcesData?.resources) return [];
		return resourcesData.resources.map((r) => ({
			id: r.resourceId,
			title: r.title,
			// Pass-through DB color/bg only when set; otherwise undefined so
			// ilamy renders with no inline style and the cell inherits the
			// calendar's neutral cascade. Matches CalendarClient and
			// PublicCalendarClient behaviour for consistency.
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

	// ── Handlers ────────────────────────────────────────────────────────────

	const handleEdit = (
		w: NonNullable<typeof windows>[number],
		e: React.MouseEvent,
	) => {
		e.stopPropagation();
		// Pass BASE times (baseStart/baseEnd), not occurrence times. updateRentalWindow
		// rewrites base.start/end, so a no-op save on a recurring window would otherwise
		// shift the whole series anchor to the clicked occurrence's date. EventFormModal's
		// second useEffect also reseeds from fetchedEvent as a safety net.
		const ilamyEvent = {
			id: w.eventId,
			title: w.title,
			start: dayjs(w.baseStart),
			end: dayjs(w.baseEnd),
			resourceId: w.courts[0]?.resourceId,
			data: {
				dbEventId: w.eventId,
				eventType: "RENTAL_WINDOW",
			},
		} as unknown as IlamyCalendarEvent;
		setEditEvent(ilamyEvent);
		setShowModal(true);
	};

	const handleDelete = (
		eventId: string,
		title: string,
		e: React.MouseEvent,
	) => {
		e.stopPropagation();
		setDeleteTarget({ eventId, title });
	};

	const confirmDelete = () => {
		if (deleteTarget) {
			deleteMutation.mutate({ eventId: deleteTarget.eventId });
			setDeleteTarget(null);
		}
	};

	const handleRowClick = (eventId: string) => {
		router.push(`/admin/rentals/${eventId}`);
	};

	const handleCreate = () => {
		if (!effectiveFacilityId) {
			toast("Select a facility first.", "error");
			return;
		}
		setEditEvent(null);
		setShowModal(true);
	};

	const handleModalClose = () => {
		setShowModal(false);
		setEditEvent(null);
	};

	// ── Render ──────────────────────────────────────────────────────────────

	if (isUserLoading) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<p className="text-[var(--muted-foreground)] text-sm">Loading...</p>
			</div>
		);
	}

	if (!canManage) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="text-center">
					<h2 className="font-semibold text-[var(--foreground)] text-xl">
						Access Denied
					</h2>
					<p className="mt-2 text-[var(--muted-foreground)] text-sm">
						You do not have permission to view this page.
					</p>
				</div>
			</div>
		);
	}

	const selectClassName =
		"flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

	const windowList = windows ?? [];

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">

			{/* Header */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-bold text-2xl text-[var(--foreground)]">
						Rental Windows
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Create and manage court rental availability windows
					</p>
				</div>
				<Button onClick={handleCreate}>
					<Plus size={16} />
					Create Rental Window
				</Button>
			</div>

			{/* Filters */}
			<div className="mb-4 flex flex-col gap-3 sm:flex-row">
				{facilityMemberships && (
					<FacilitySelector
						facilities={facilityMemberships}
						selectedFacilityId={effectiveFacilityId}
						onSelect={(id) => setSelectedFacilityId(id)}
					/>
				)}
				<div className="w-full sm:w-48">
					<input
						type="date"
						value={selectedDate}
						onChange={(e) => setSelectedDate(e.target.value)}
						className={selectClassName}
					/>
				</div>
			</div>

			{/* Table */}
			{isWindowsLoading ? (
				<div className="flex h-64 items-center justify-center">
					<p className="text-[var(--muted-foreground)] text-sm">Loading...</p>
				</div>
			) : windowList.length === 0 ? (
				<div className="flex h-64 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
					<div className="text-center">
						<CalendarDays
							size={32}
							className="mx-auto mb-2 text-[var(--muted-foreground)]"
						/>
						<p className="text-[var(--muted-foreground)] text-sm">
							No rental windows for this date.
						</p>
					</div>
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border border-[var(--border)]">
					<table className="w-full min-w-[640px]">
						<thead className="bg-[var(--muted)] text-left text-sm">
							<tr>
								<th className="px-4 py-3 font-medium">Title</th>
								<th className="px-4 py-3 font-medium">Date</th>
								<th className="px-4 py-3 font-medium">Time</th>
								<th className="px-4 py-3 font-medium">Courts</th>
								<th className="px-4 py-3 font-medium"># Bookings</th>
								<th className="px-4 py-3 text-right font-medium">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--border)] bg-[var(--card)]">
							{windowList.map((w) => (
								<tr
									key={w.eventId}
									className="cursor-pointer hover:bg-[var(--accent)]"
									onClick={() => handleRowClick(w.eventId)}
								>
									<td className="px-4 py-3 font-medium text-[var(--foreground)]">
										{w.title}
									</td>
									<td className="px-4 py-3 text-[var(--foreground)] text-sm">
										{new Date(w.start).toLocaleDateString()}
									</td>
									<td className="px-4 py-3 text-[var(--foreground)] text-sm">
										{new Date(w.start).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}{" "}
										-{" "}
										{new Date(w.end).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}
									</td>
									<td className="px-4 py-3 text-[var(--foreground)] text-sm">
										{w.courts.map((c) => c.title).join(", ")}
									</td>
									<td className="px-4 py-3 text-[var(--foreground)] text-sm">
										{w.bookingCount}
									</td>
									<td className="px-4 py-3">
										<div className="flex justify-end gap-2">
											<Button
												variant="ghost"
												size="icon"
												aria-label="Edit rental window"
												onClick={(e) => handleEdit(w, e)}
											>
												<Pencil size={16} />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label="Delete rental window"
												onClick={(e) => handleDelete(w.eventId, w.title, e)}
												className="hover:bg-red-50 hover:text-red-600"
											>
												<Trash2 size={16} />
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* Create / Edit Modal — uses shared EventFormModal for RENTAL_WINDOW events */}
			{showModal && (
				<EventFormModal
					open={showModal}
					selectedEvent={editEvent}
					onClose={handleModalClose}
					resources={resources}
					userType={user?.userType}
					facilityId={effectiveFacilityId ?? undefined}
					facilityName={activeFacilityName}
					defaultEventType="RENTAL_WINDOW"
				/>
			)}

			{/* Delete Confirmation */}
			<AlertDialog
				open={deleteTarget !== null}
				title={`Delete "${deleteTarget?.title}"?`}
				description="This will cancel all confirmed bookings for this window. This action cannot be undone."
				confirmLabel="Delete"
				destructive
				onConfirm={confirmDelete}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}
