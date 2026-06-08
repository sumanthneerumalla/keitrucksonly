"use client";

import { SignInButton } from "@clerk/nextjs";
import dayjs from "dayjs";
import {
	ArrowLeft,
	CalendarCheck,
	Check,
	Copy,
	Eye,
	Pencil,
	X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import EventRoster from "~/app/(app)/events/[eventId]/EventRoster";
import EventStatusLogTimeline from "~/app/(app)/events/[eventId]/EventStatusLogTimeline";
import GuestRegisterModal from "~/app/(app)/events/[eventId]/GuestRegisterModal";
import BookableEventDetails from "~/app/(app)/events/_components/BookableEventDetails";
import DropInEventDetails from "~/app/(app)/events/_components/DropInEventDetails";
import { useToast } from "~/app/_components/shared/Toast";
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
	const { toast } = useToast();
	const isFacilityOrAdmin = userType ? isFacilityOrAbove({ userType }) : false;
	const isCoach = userType === "COACH";
	const isStudent = userType === "STUDENT";
	const [editMode, setEditMode] = useState(false);
	const [copied, setCopied] = useState(false);
	// Guest-register modal + post-register success banner state (D3, Tier 1)
	const [showGuestRegister, setShowGuestRegister] = useState(false);
	const [guestRegisteredEmail, setGuestRegisteredEmail] = useState<
		string | null
	>(null);
	const [bannerDismissed, setBannerDismissed] = useState(false);
	// Phase 9a Activity tab — only staff (facility+) and coaches see the tab
	// row; students stay on the Details view. RegistrationStatusLog rows are
	// surfaced via `calendar.listEventStatusLog`.
	const [activeTab, setActiveTab] = useState<"details" | "activity">("details");
	const showTabs = isFacilityOrAdmin || isCoach;
	const showDetails = !showTabs || activeTab === "details";
	const showActivity = showTabs && activeTab === "activity";

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
	// Free-event detection — must mirror server-side `shop.guestRegisterForFreeEvent` validation
	// exactly (review I2). Server checks BOTH price-is-zero AND credit-is-zero before letting
	// a guest register. If we relax this client-side, a credit-required $0 event will show the
	// guest-register CTA but then fail with "This event is not free" on submit.
	const isFreeEvent =
		event != null &&
		(event.productId === null || event.product?.priceInCents === 0) &&
		(event.creditCost === null || event.creditCost === 0);

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

	// Rotation Play (DROP_IN): the event page IS the live board — render it instead
	// of the normal bookable detail view (D2: the board is the event page).
	if (event.eventType === "DROP_IN") {
		return (
			<div className="h-[calc(100vh-5rem)] overflow-auto p-6">
				<div className="mb-6">
					<Link
						href="/calendar"
						className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)] text-sm transition-colors hover:text-[var(--foreground)]"
					>
						<ArrowLeft size={14} />
						Back to calendar
					</Link>
				</div>
				<div className="mx-auto max-w-3xl space-y-4">
					<DropInEventDetails
						eventId={eventId}
						eventStart={event.start}
						eventTitle={event.title}
						isStaff={isFacilityOrAdmin}
						userId={userId}
					/>
					{/* Registered roster (facility / club-admin / platform-admin). */}
					{isFacilityOrAdmin && (
						<EventRoster
							eventId={eventId}
							facilityId={event.facilityId ?? null}
							maxParticipants={event.maxParticipants}
							canManage={isFacilityOrAdmin}
							canCheckIn={isFacilityOrAdmin}
						/>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-6">
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
				{showTabs && (
					<div className="flex border-[var(--border)] border-b">
						<button
							type="button"
							onClick={() => setActiveTab("details")}
							className={`-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors ${
								activeTab === "details"
									? "border-[var(--primary)] text-[var(--foreground)]"
									: "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
							}`}
						>
							Details
						</button>
						<button
							type="button"
							onClick={() => setActiveTab("activity")}
							className={`-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors ${
								activeTab === "activity"
									? "border-[var(--primary)] text-[var(--foreground)]"
									: "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
							}`}
						>
							Activity
						</button>
					</div>
				)}
				{showDetails && (
					<>
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

						{/* Post-register success banner — guest just registered (D3, Tier 1) */}
						{guestRegisteredEmail && !bannerDismissed && isBookable && (
							<div className="relative space-y-2 rounded-lg border border-green-200 bg-green-50 p-5">
								<button
									type="button"
									onClick={() => setBannerDismissed(true)}
									className="absolute top-3 right-3 rounded p-1 text-green-700/70 transition-colors hover:text-green-800"
									aria-label="Dismiss banner"
								>
									<X size={16} />
								</button>
								<div className="flex items-center gap-2 font-medium text-green-700 text-sm">
									<CalendarCheck size={16} />
									You're registered for {event.title}!
								</div>
								<p className="text-green-800 text-sm">
									We created an account for you with{" "}
									<span className="font-medium">{guestRegisteredEmail}</span>.{" "}
									{/*
									 * D8: use SignInButton with initialValues to pre-fill the email
									 * in Clerk's hosted sign-in (the codebase has no custom /sign-in
									 * route — direct links would 404). Per Clerk docs, the
									 * initialValues prop is forwarded to the SignIn flow and the
									 * field name is `emailAddress`.
									 */}
									<SignInButton
										mode="modal"
										initialValues={{ emailAddress: guestRegisteredEmail }}
									>
										<button
											type="button"
											className="cursor-pointer bg-transparent p-0 font-medium text-green-700 underline hover:text-green-900"
										>
											Sign in
										</button>
									</SignInButton>{" "}
									to view your registration.
								</p>
							</div>
						)}

						{/* Registration actions — students */}
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
								) : (
									<>
										{event.maxParticipants !== null && (
											<p className="text-[var(--muted-foreground)] text-sm">
												{event.maxParticipants - event._count.registrations}{" "}
												spot
												{event.maxParticipants - event._count.registrations ===
												1
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

						{/* Unauthenticated viewer CTA — guest register for free events (D3) */}
						{!userId && isBookable && !guestRegisteredEmail && (
							<div className="glass-card space-y-3 rounded-lg p-5">
								{isFull ? (
									<p className="text-[var(--muted-foreground)] text-sm">
										This event is fully booked ({event._count.registrations}/
										{event.maxParticipants} spots filled).
									</p>
								) : isFreeEvent ? (
									<>
										{event.maxParticipants !== null && (
											<p className="text-[var(--muted-foreground)] text-sm">
												{event.maxParticipants - event._count.registrations}{" "}
												spot
												{event.maxParticipants - event._count.registrations ===
												1
													? ""
													: "s"}{" "}
												remaining
											</p>
										)}
										<p className="text-[var(--muted-foreground)] text-xs">
											This is a free event — register without signing in.
										</p>
										<Button
											size="sm"
											onClick={() => setShowGuestRegister(true)}
										>
											<CalendarCheck size={14} />
											Register
										</Button>
									</>
								) : (
									<p className="text-[var(--muted-foreground)] text-sm">
										<SignInButton mode="modal">
											<button
												type="button"
												className="cursor-pointer bg-transparent p-0 text-[var(--primary)] underline"
											>
												Sign in
											</button>
										</SignInButton>{" "}
										to register for this event.
									</p>
								)}
							</div>
						)}

						{/* Guest register modal */}
						{showGuestRegister && (
							<GuestRegisterModal
								clubShortName={event.clubShortName}
								eventId={event.eventId}
								eventTitle={event.title}
								onClose={() => setShowGuestRegister(false)}
								onSuccess={(registeredEmail) => {
									setGuestRegisteredEmail(registeredEmail);
									setShowGuestRegister(false);
									setBannerDismissed(false);
									// Refresh public event data so the new registration is reflected.
									void utils.calendar.getPublicEventById.invalidate({
										eventId,
									});
								}}
							/>
						)}

						{/* Event roster — FACILITY/ADMIN/COACH only */}
						{(isFacilityOrAdmin || isCoach) && event.eventType !== "BLOCK" && (
							<EventRoster
								eventId={event.eventId}
								facilityId={event.facilityId ?? null}
								maxParticipants={event.maxParticipants}
								canManage={isFacilityOrAdmin}
								canCheckIn={canEdit}
							/>
						)}
					</>
				)}
				{showActivity && <EventStatusLogTimeline eventId={eventId} />}
			</div>
		</div>
	);
}
