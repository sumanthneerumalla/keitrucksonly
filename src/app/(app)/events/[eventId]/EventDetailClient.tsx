"use client";

import dayjs from "dayjs";
import {
	ArrowLeft,
	CalendarCheck,
	Check,
	Copy,
	Eye,
	Package,
	Pencil,
	Users,
	X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import SellPackageModal from "~/app/(app)/admin/checkin/SellPackageModal";
import AddStudentPopover from "~/app/(app)/events/[eventId]/AddStudentPopover";
import BookableEventDetails from "~/app/(app)/events/_components/BookableEventDetails";
import { ToastContainer, useToast } from "~/app/_components/shared/Toast";
import { isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";
import "~/lib/dayjs-config";
import { Button } from "~/app/_components/shared/Button";

interface EventDetailClientProps {
	eventId: string;
	userType: string;
	userId: string;
}

export default function EventDetailClient({
	eventId,
	userType,
	userId,
}: EventDetailClientProps) {
	const { toasts, toast, dismiss } = useToast();
	const isFacilityOrAdmin = userType ? isFacilityOrAbove({ userType }) : false;
	const isCoach = userType === "COACH";
	const isStudent = userType === "STUDENT";
	const [editMode, setEditMode] = useState(false);
	const [copied, setCopied] = useState(false);
	const [sellPackageTarget, setSellPackageTarget] = useState<{
		userId: string;
		memberName: string;
	} | null>(null);

	const handleCopyLink = () => {
		void navigator.clipboard.writeText(window.location.href).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	const {
		data: event,
		isLoading,
		error,
	} = api.calendar.getPublicEventById.useQuery({ eventId });

	// COACH can edit only their own events; FACILITY/ADMIN can edit all
	const canEdit =
		isFacilityOrAdmin ||
		(isCoach && event != null && event.createdByUserId === userId);

	const utils = api.useUtils();

	// My current confirmed registration for this event (students only)
	const { data: myRegistrationsData } =
		api.calendar.getMyRegistrations.useQuery(undefined, {
			enabled: isStudent,
		});
	const myRegistration = myRegistrationsData?.registrations.find(
		(r) => r.event.eventId === eventId,
	);

	// Roster: fetch confirmed registrations for staff
	const { data: rosterData } = api.calendar.getEventRegistrations.useQuery(
		{ eventId },
		{ enabled: isFacilityOrAdmin || isCoach },
	);

	const registerMutation = api.calendar.registerForEvent.useMutation({
		onSuccess: () => {
			void utils.calendar.getMyRegistrations.invalidate();
			void utils.calendar.getPublicEventById.invalidate({ eventId });
			toast("You're registered!", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	const cancelMutation = api.calendar.cancelRegistration.useMutation({
		onSuccess: () => {
			void utils.calendar.getMyRegistrations.invalidate();
			void utils.calendar.getPublicEventById.invalidate({ eventId });
			toast("Registration cancelled", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	// Derived registration state
	const isBookable =
		event != null && event.eventType !== "BLOCK" && event.isPublic;
	const isFull =
		event != null &&
		event.maxParticipants !== null &&
		event._count.registrations >= event.maxParticipants;
	const canRegister = isStudent && isBookable && !isFull && !myRegistration;
	const canCancel = isStudent && myRegistration != null;

	if (isLoading) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="animate-pulse space-y-4">
					<div className="h-8 w-64 rounded bg-[var(--muted)]" />
					<div className="h-48 w-full max-w-2xl rounded bg-[var(--muted)]" />
				</div>
			</div>
		);
	}

	if (error || !event) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="text-center">
					<p className="text-[var(--muted-foreground)] text-sm">
						Event not found.
					</p>
					<Link
						href="/calendar"
						className="mt-3 inline-block text-[var(--primary)] text-sm underline"
					>
						Back to calendar
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-6">
			<ToastContainer toasts={toasts} onDismiss={dismiss} />

			{/* Back nav */}
			<div className="mb-6">
				<Link
					href="/calendar"
					className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)] text-sm transition-colors hover:text-[var(--foreground)]"
				>
					<ArrowLeft size={14} />
					Back to calendar
				</Link>
			</div>

			<div className="mx-auto max-w-2xl space-y-4">
				{/* Date/time + edit toggle header */}
				<div className="flex items-center justify-between">
					<div className="text-[var(--muted-foreground)] text-sm">
						{dayjs(event.start).format("ddd, MMM D YYYY · h:mm A")}
						{" — "}
						{dayjs(event.end).format("h:mm A")}
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleCopyLink}
							className={copied ? "border-green-500 text-green-600" : ""}
						>
							{copied ? (
								<>
									<Check size={14} /> Copied!
								</>
							) : (
								<>
									<Copy size={14} /> Copy link
								</>
							)}
						</Button>
						{canEdit && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setEditMode((v) => !v)}
								className={
									editMode
										? "border-[var(--primary)] text-[var(--primary)]"
										: ""
								}
							>
								{editMode ? (
									<>
										<Eye size={14} /> View
									</>
								) : (
									<>
										<Pencil size={14} /> Edit
									</>
								)}
							</Button>
						)}
					</div>
				</div>

				<BookableEventDetails
					event={{
						eventId: event.eventId,
						title: event.title,
						eventType: event.eventType,
						description: event.description,
						isPublic: event.isPublic,
						maxParticipants: event.maxParticipants,
						registrationType: event.registrationType,
						rrule: event.rrule,
						start: event.start,
						end: event.end,
						showRegistrantNames: event.showRegistrantNames,
						resource: event.resource,
						product: event.product,
						createdByUser: event.createdByUser,
						_count: event._count,
						registrants: event.registrants,
					}}
					readOnly={!editMode}
				/>

				{/* Registration actions — students only */}
				{isStudent && isBookable && (
					<div className="glass-card space-y-3 rounded-lg p-5">
						{myRegistration ? (
							<>
								<div className="flex items-center gap-2 font-medium text-green-600 text-sm">
									<CalendarCheck size={16} />
									You're registered for this event
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										cancelMutation.mutate({
											registrationId: myRegistration.registrationId,
										})
									}
									disabled={cancelMutation.isPending}
									className="border-red-200 text-red-600 hover:bg-red-50"
								>
									<X size={14} />
									{cancelMutation.isPending
										? "Cancelling…"
										: "Cancel Registration"}
								</Button>
								<p className="text-[var(--muted-foreground)] text-xs">
									Cancelling forfeits any credit used for this registration.
								</p>
							</>
						) : isFull ? (
							<p className="text-[var(--muted-foreground)] text-sm">
								This event is fully booked ({event._count.registrations}/
								{event.maxParticipants} spots filled).
							</p>
						) : !userId ? (
							<p className="text-[var(--muted-foreground)] text-sm">
								<Link
									href="/sign-in"
									className="text-[var(--primary)] underline"
								>
									Sign in
								</Link>{" "}
								to register for this event.
							</p>
						) : (
							<>
								{event.maxParticipants !== null && (
									<p className="text-[var(--muted-foreground)] text-sm">
										{event.maxParticipants - event._count.registrations} spot
										{event.maxParticipants - event._count.registrations === 1
											? ""
											: "s"}{" "}
										remaining
									</p>
								)}
								<Button
									size="sm"
									onClick={() =>
										registerMutation.mutate({ eventId: event.eventId })
									}
									disabled={registerMutation.isPending}
								>
									<CalendarCheck size={14} />
									{registerMutation.isPending
										? "Registering…"
										: "Register for this event"}
								</Button>
							</>
						)}
					</div>
				)}

				{/* Event roster — FACILITY/ADMIN/COACH only */}
				{(isFacilityOrAdmin || isCoach) && event.eventType !== "BLOCK" && (
					<div className="glass-card space-y-3 rounded-lg p-5">
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<Users
									size={16}
									className="text-[var(--muted-foreground)]"
								/>
								<h3 className="font-medium text-[var(--foreground)] text-sm">
									Registered ({rosterData?.registrations.length ?? 0}
									{event.maxParticipants !== null
										? ` / ${event.maxParticipants}`
										: ""}
									)
								</h3>
							</div>
							{isFacilityOrAdmin && (
								<AddStudentPopover
									eventId={event.eventId}
									facilityId={event.facilityId ?? null}
									onSuccess={() => {
										void utils.calendar.getEventRegistrations.invalidate({
											eventId,
										});
										void utils.calendar.getPublicEventById.invalidate({
											eventId,
										});
									}}
								/>
							)}
						</div>
						{!rosterData ? (
							<p className="text-[var(--muted-foreground)] text-xs">Loading…</p>
						) : rosterData.registrations.length === 0 ? (
							<p className="text-[var(--muted-foreground)] text-xs">
								No confirmed registrations yet.
							</p>
						) : (
							<ul className="space-y-1.5">
								{rosterData.registrations.map((r) => {
									const displayName = `${r.firstName ?? ""} ${
										r.lastName ?? r.lastInitial ?? ""
									}`.trim();
									const nameContent = (
										<>
											{/* Avatar placeholder — replace inner div with <ProfileAvatar> when avatar support is added */}
											<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-medium text-[var(--primary)] text-xs">
												{r.firstName?.[0] ?? "?"}
											</div>
											<span>
												{r.firstName} {r.lastName ?? r.lastInitial}
											</span>
										</>
									);
									return (
										<li
											key={r.registrationId}
											className="flex items-center justify-between gap-2 text-[var(--foreground)] text-sm"
										>
											{isFacilityOrAdmin ? (
												<Link
													href={`/admin/users/${r.userId}`}
													className="flex min-w-0 flex-1 items-center gap-2.5 transition-colors hover:text-[var(--primary)] hover:underline"
												>
													{nameContent}
												</Link>
											) : (
												<div className="flex min-w-0 flex-1 items-center gap-2.5">
													{nameContent}
												</div>
											)}
											{isFacilityOrAdmin && (
												<Button
													variant="ghost"
													size="icon"
													title="Sell package"
													aria-label={`Sell package to ${displayName}`}
													className="h-8 w-8 shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
													onClick={() =>
														setSellPackageTarget({
															userId: r.userId,
															memberName: displayName,
														})
													}
												>
													<Package size={14} />
												</Button>
											)}
										</li>
									);
								})}
							</ul>
						)}
						{sellPackageTarget && (
							<SellPackageModal
								userId={sellPackageTarget.userId}
								memberName={sellPackageTarget.memberName}
								onClose={() => setSellPackageTarget(null)}
							/>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
