"use client";

import { useAuth } from "@clerk/nextjs";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { CalendarDays, Clock, MapPin } from "lucide-react";
import { Button } from "~/app/_components/shared/Button";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { ToastContainer, useToast } from "~/app/_components/shared/Toast";
import { toDateInputValue, parseLocalDate } from "~/app/(app)/rentals/utils";
import RentalBookingForm from "~/app/(app)/rentals/RentalBookingForm";
import { api } from "~/trpc/react";

// ─── Main Page Component ────────────────────────────────────────────────────

export default function RentalsClient() {
	const { isSignedIn, isLoaded } = useAuth();
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const { toasts, toast, dismiss } = useToast();
	const utils = api.useUtils();

	// Fetch authed user profile for club fallback
	const { data: user } = api.user.getOrCreateProfile.useQuery(undefined, {
		enabled: isLoaded && !!isSignedIn,
		staleTime: 1000 * 60 * 5,
		retry: false,
	});

	// URL params — fall back to user's clubShortName for authed users
	const clubParam = searchParams.get("club");
	const club = clubParam ?? user?.clubShortName ?? null;
	const facilityParam = searchParams.get("facility");
	const windowParam = searchParams.get("window");

	// Date state
	const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));

	// Cancel confirmation
	const [cancelTarget, setCancelTarget] = useState<{
		bookingId: string;
		courtName: string;
	} | null>(null);

	// ── Queries ─────────────────────────────────────────────────────────────

	const { data: facilities, isLoading: isFacilitiesLoading } =
		api.calendar.getPublicFacilities.useQuery(
			{ clubShortName: club! },
			{ enabled: !!club },
		);

	const selectedFacilityId = facilityParam ?? facilities?.[0]?.facilityId ?? "";

	const { data: windows, isLoading: isWindowsLoading } =
		api.rentals.listRentalWindows.useQuery(
			{
				clubShortName: club!,
				facilityId: selectedFacilityId || undefined,
				date: parseLocalDate(selectedDate),
			},
			{ enabled: !!club && !!selectedDate },
		);

	const selectedWindowId = windowParam ?? windows?.[0]?.eventId ?? "";
	const selectedWindow = windows?.find((w) => w.eventId === selectedWindowId);

	const { data: memberBookings, isLoading: isBookingsLoading } =
		api.rentals.listMemberBookings.useQuery(
			{ upcoming: true },
			{ enabled: !!isSignedIn },
		);

	const cancelMutation = api.rentals.cancelRentalBooking.useMutation({
		onSuccess: () => {
			void utils.rentals.listMemberBookings.invalidate();
			void utils.rentals.getRentalAvailability.invalidate();
			toast("Booking cancelled", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	// ── Handlers ────────────────────────────────────────────────────────────

	const handleFacilityChange = (facilityId: string) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("facility", facilityId);
		params.delete("window");
		router.replace(`${pathname}?${params.toString()}`);
	};

	const handleWindowChange = (windowId: string) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("window", windowId);
		router.replace(`${pathname}?${params.toString()}`);
	};

	const handleConfirmCancel = () => {
		if (!cancelTarget) return;
		cancelMutation.mutate({ bookingId: cancelTarget.bookingId });
		setCancelTarget(null);
	};

	// ── Render ──────────────────────────────────────────────────────────────

	// Wait for Clerk + (if signed in) the user profile query before deciding whether a club is resolvable
	const isResolvingClub = !isLoaded || (isSignedIn && !user && !clubParam);

	if (isResolvingClub) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<p className="text-[var(--muted-foreground)] text-sm">Loading...</p>
			</div>
		);
	}

	if (!club) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="text-center">
					<h2 className="font-semibold text-[var(--foreground)] text-xl">
						No Club Specified
					</h2>
					<p className="mt-2 text-[var(--muted-foreground)] text-sm">
						Please specify a club. e.g., /rentals?club=yourclub
					</p>
				</div>
			</div>
		);
	}

	if (isFacilitiesLoading) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<p className="text-[var(--muted-foreground)] text-sm">Loading...</p>
			</div>
		);
	}

	const selectClassName =
		"flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

	return (
		<div className="container mx-auto max-w-4xl px-4 py-6">
			<ToastContainer toasts={toasts} onDismiss={dismiss} />

			<h1 className="mb-6 font-bold text-2xl text-[var(--foreground)]">
				Court Rentals
			</h1>

			{/* Facility selector */}
			{facilities && facilities.length > 1 && (
				<div className="mb-4 space-y-1">
					<label className="font-medium text-[var(--foreground)] text-sm">
						<MapPin size={14} className="mr-1 inline" />
						Facility
					</label>
					<select
						value={selectedFacilityId}
						onChange={(e) => handleFacilityChange(e.target.value)}
						className={selectClassName}
					>
						{facilities.map((f) => (
							<option key={f.facilityId} value={f.facilityId}>
								{f.facilityName}
							</option>
						))}
					</select>
				</div>
			)}

			{/* Date picker */}
			<div className="mb-4 space-y-1">
				<label className="font-medium text-[var(--foreground)] text-sm">
					<CalendarDays size={14} className="mr-1 inline" />
					Date
				</label>
				<input
					type="date"
					value={selectedDate}
					onChange={(e) => setSelectedDate(e.target.value)}
					className={selectClassName}
				/>
			</div>

			{/* Window selector */}
			{isWindowsLoading ? (
				<p className="text-[var(--muted-foreground)] text-sm">
					Loading windows...
				</p>
			) : windows && windows.length > 0 ? (
				<>
					{windows.length > 1 && (
						<div className="mb-4 space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								<Clock size={14} className="mr-1 inline" />
								Rental Window
							</label>
							<select
								value={selectedWindowId}
								onChange={(e) => handleWindowChange(e.target.value)}
								className={selectClassName}
							>
								{windows.map((w) => (
									<option key={w.eventId} value={w.eventId}>
										{w.title} ({new Date(w.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {new Date(w.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
									</option>
								))}
							</select>
						</div>
					)}

					{/* Booking form */}
					{selectedWindow && (
						<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
							<h2 className="mb-3 font-semibold text-[var(--foreground)] text-lg">
								{selectedWindow.title}
							</h2>
							<p className="mb-4 text-[var(--muted-foreground)] text-sm">
								{new Date(selectedWindow.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -{" "}
								{new Date(selectedWindow.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
								{" | "}
								{selectedWindow.courts.length} court{selectedWindow.courts.length !== 1 ? "s" : ""}
								{" | "}
								Max {selectedWindow.maxBookingHours ?? 2}h per booking
							</p>
							<RentalBookingForm
								rentalWindowEventId={selectedWindow.eventId}
								maxBookingHours={selectedWindow.maxBookingHours ?? 2}
								courts={selectedWindow.courts}
								clubShortName={club}
							/>
						</div>
					)}
				</>
			) : (
				<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-center">
					<p className="text-[var(--muted-foreground)] text-sm">
						No rental windows available for this date.
					</p>
				</div>
			)}

			{/* My Upcoming Bookings */}
			{isSignedIn && (
				<div className="mt-8">
					<h2 className="mb-4 font-semibold text-[var(--foreground)] text-xl">
						My Upcoming Bookings
					</h2>

					{isBookingsLoading ? (
						<p className="text-[var(--muted-foreground)] text-sm">
							Loading bookings...
						</p>
					) : memberBookings && memberBookings.length > 0 ? (
						<div className="space-y-3">
							{memberBookings.map((booking) => (
								<div
									key={booking.bookingId}
									className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
								>
									<div>
										<p className="font-medium text-[var(--foreground)] text-sm">
											{booking.resource?.title ?? "Court"}
										</p>
										<p className="text-[var(--muted-foreground)] text-sm">
											{new Date(booking.startTime).toLocaleDateString()} |{" "}
											{new Date(booking.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -{" "}
											{new Date(booking.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
										</p>
										<p className="text-[var(--muted-foreground)] text-xs">
											{booking.facility?.name ?? ""} | {booking.status}
										</p>
									</div>
									{booking.status === "CONFIRMED" && (
										<Button
											variant="destructive-outline"
											size="sm"
											onClick={() =>
												setCancelTarget({
													bookingId: booking.bookingId,
													courtName: booking.resource?.title ?? "Court",
												})
											}
										>
											Cancel
										</Button>
									)}
								</div>
							))}
						</div>
					) : (
						<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-center">
							<p className="text-[var(--muted-foreground)] text-sm">
								No upcoming bookings.
							</p>
						</div>
					)}
				</div>
			)}

			<AlertDialog
				open={!!cancelTarget}
				title="Cancel Booking"
				description={
					cancelTarget
						? `Cancel your booking for ${cancelTarget.courtName}?`
						: ""
				}
				confirmLabel="Cancel Booking"
				destructive
				onConfirm={handleConfirmCancel}
				onCancel={() => setCancelTarget(null)}
			/>
		</div>
	);
}
