"use client";

import { ArrowLeft, CalendarDays, Clock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { ToastContainer, useToast } from "~/app/_components/shared/Toast";
import { isFacilityOrAbove } from "~/lib/utils";
import { formatTime } from "~/app/(app)/rentals/utils";
import { api } from "~/trpc/react";

export default function WindowBookingsClient() {
	const params = useParams();
	const windowId = params.windowId as string;
	const { toasts, toast, dismiss } = useToast();
	const utils = api.useUtils();

	const [cancelTarget, setCancelTarget] = useState<{
		bookingId: string;
		memberName: string;
		courtName: string;
	} | null>(null);

	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();

	const canManage = user ? isFacilityOrAbove(user) : false;

	const { data: windowData, isLoading: isWindowLoading } =
		api.rentals.getRentalWindowById.useQuery(
			{ eventId: windowId },
			{ enabled: canManage && !!windowId },
		);

	const cancelMutation = api.rentals.cancelRentalBooking.useMutation({
		onSuccess: () => {
			void utils.rentals.getRentalWindowById.invalidate({ eventId: windowId });
			toast("Booking cancelled", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	const confirmCancel = () => {
		if (cancelTarget) {
			cancelMutation.mutate({ bookingId: cancelTarget.bookingId });
			setCancelTarget(null);
		}
	};

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

	if (isWindowLoading) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<p className="text-[var(--muted-foreground)] text-sm">
					Loading window details...
				</p>
			</div>
		);
	}

	if (!windowData) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="text-center">
					<h2 className="font-semibold text-[var(--foreground)] text-xl">
						Rental Window Not Found
					</h2>
					<p className="mt-2 text-[var(--muted-foreground)] text-sm">
						This rental window may have been deleted.
					</p>
					<Link href="/admin/rentals">
						<Button variant="outline" className="mt-4">
							<ArrowLeft size={16} /> Back to Rental Windows
						</Button>
					</Link>
				</div>
			</div>
		);
	}

	const confirmedBookings = windowData.bookings.filter(
		(b) => b.status === "CONFIRMED",
	);
	const cancelledBookings = windowData.bookings.filter(
		(b) => b.status === "CANCELLED",
	);

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">
			<ToastContainer toasts={toasts} onDismiss={dismiss} />

			{/* Back + Header */}
			<div className="mb-6">
				<Link
					href="/admin/rentals"
					className="mb-3 inline-flex items-center gap-1.5 text-[var(--muted-foreground)] text-sm transition-colors hover:text-[var(--foreground)]"
				>
					<ArrowLeft size={14} /> Back to Rental Windows
				</Link>
				<h1 className="font-bold text-2xl text-[var(--foreground)]">
					{windowData.title}
				</h1>
				<div className="mt-1 flex flex-wrap items-center gap-4 text-[var(--muted-foreground)] text-sm">
					<span className="flex items-center gap-1.5">
						<CalendarDays size={14} />
						{new Date(windowData.start).toLocaleDateString(undefined, {
							weekday: "long",
							month: "long",
							day: "numeric",
							year: "numeric",
						})}
					</span>
					<span className="flex items-center gap-1.5">
						<Clock size={14} />
						{formatTime(windowData.start)} – {formatTime(windowData.end)}
					</span>
				</div>
				<p className="mt-1 text-[var(--muted-foreground)] text-sm">
					Courts: {windowData.courts.map((c) => c.title).join(", ")} ·{" "}
					{confirmedBookings.length} booking
					{confirmedBookings.length !== 1 ? "s" : ""}
				</p>
			</div>

			{/* Confirmed Bookings Table */}
			{confirmedBookings.length === 0 ? (
				<div className="flex h-48 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
					<p className="text-[var(--muted-foreground)] text-sm">
						No confirmed bookings for this window.
					</p>
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border border-[var(--border)]">
					<table className="w-full min-w-[640px]">
						<thead className="bg-[var(--muted)] text-left text-sm">
							<tr>
								<th className="px-4 py-3 font-medium">Court</th>
								<th className="px-4 py-3 font-medium">Member</th>
								<th className="px-4 py-3 font-medium">Time</th>
								<th className="px-4 py-3 font-medium">Status</th>
								<th className="px-4 py-3 text-right font-medium">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--border)] bg-[var(--card)]">
							{confirmedBookings.map((b) => (
								<tr key={b.bookingId} className="hover:bg-[var(--accent)]">
									<td className="px-4 py-3 text-[var(--foreground)] text-sm">
										{b.resource.title}
									</td>
									<td className="px-4 py-3 text-[var(--foreground)] text-sm">
										{b.user.firstName} {b.user.lastName}
										{b.user.email && (
											<span className="ml-1 text-[var(--muted-foreground)] text-xs">
												({b.user.email})
											</span>
										)}
									</td>
									<td className="px-4 py-3 text-[var(--foreground)] text-sm">
										{formatTime(b.startTime)} – {formatTime(b.endTime)}
									</td>
									<td className="px-4 py-3">
										<span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
											Confirmed
										</span>
									</td>
									<td className="px-4 py-3">
										<div className="flex justify-end">
											<Button
												variant="ghost"
												size="icon"
												aria-label="Cancel booking"
												className="hover:bg-red-50 hover:text-red-600"
												onClick={() =>
													setCancelTarget({
														bookingId: b.bookingId,
														memberName: `${b.user.firstName} ${b.user.lastName}`,
														courtName: b.resource.title,
													})
												}
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

			{/* Cancelled Bookings (collapsed) */}
			{cancelledBookings.length > 0 && (
				<details className="mt-6">
					<summary className="cursor-pointer text-[var(--muted-foreground)] text-sm hover:text-[var(--foreground)]">
						{cancelledBookings.length} cancelled booking
						{cancelledBookings.length !== 1 ? "s" : ""}
					</summary>
					<div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
						<table className="w-full min-w-[640px]">
							<thead className="bg-[var(--muted)] text-left text-sm">
								<tr>
									<th className="px-4 py-3 font-medium">Court</th>
									<th className="px-4 py-3 font-medium">Member</th>
									<th className="px-4 py-3 font-medium">Time</th>
									<th className="px-4 py-3 font-medium">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--border)] bg-[var(--card)] opacity-60">
								{cancelledBookings.map((b) => (
									<tr key={b.bookingId}>
										<td className="px-4 py-3 text-sm">{b.resource.title}</td>
										<td className="px-4 py-3 text-sm">
											{b.user.firstName} {b.user.lastName}
										</td>
										<td className="px-4 py-3 text-sm">
											{formatTime(b.startTime)} – {formatTime(b.endTime)}
										</td>
										<td className="px-4 py-3">
											<span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
												Cancelled
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</details>
			)}

			{/* Cancel Confirmation */}
			<AlertDialog
				open={cancelTarget !== null}
				title="Cancel Booking"
				description={`Cancel ${cancelTarget?.memberName}'s booking on ${cancelTarget?.courtName}? The slot will become available again.`}
				confirmLabel="Cancel Booking"
				destructive
				onConfirm={confirmCancel}
				onCancel={() => setCancelTarget(null)}
			/>
		</div>
	);
}
