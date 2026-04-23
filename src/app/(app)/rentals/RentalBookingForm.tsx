"use client";

import { useAuth, SignInButton } from "@clerk/nextjs";
import { useSearchParams, usePathname } from "next/navigation";
import { useState, useMemo } from "react";
import { Button } from "~/app/_components/shared/Button";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { ToastContainer, useToast } from "~/app/_components/shared/Toast";
import { formatTime } from "~/app/(app)/rentals/utils";
import { api } from "~/trpc/react";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RentalBookingFormProps {
	rentalWindowEventId: string;
	maxBookingHours: number;
	courts: Array<{ resourceId: string; title: string }>;
	clubShortName: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function RentalBookingForm({
	rentalWindowEventId,
	maxBookingHours,
	courts,
	clubShortName,
}: RentalBookingFormProps) {
	const { isSignedIn } = useAuth();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { toasts, toast, dismiss } = useToast();
	const utils = api.useUtils();

	const [selectedCourtId, setSelectedCourtId] = useState(
		courts[0]?.resourceId ?? "",
	);
	const [selectedStart, setSelectedStart] = useState("");
	const [selectedEnd, setSelectedEnd] = useState("");
	const [confirmTarget, setConfirmTarget] = useState<{
		courtName: string;
		startLabel: string;
		endLabel: string;
		resourceId: string;
		startTime: Date;
		endTime: Date;
	} | null>(null);

	const { data: availability, isLoading: isAvailLoading } =
		api.rentals.getRentalAvailability.useQuery({ rentalWindowEventId });

	const bookMutation = api.rentals.bookRentalSlot.useMutation({
		onSuccess: () => {
			void utils.rentals.getRentalAvailability.invalidate();
			void utils.rentals.listMemberBookings.invalidate();
			toast("Booking confirmed!", "success");
			setSelectedStart("");
			setSelectedEnd("");
		},
		onError: (err) => toast(err.message, "error"),
	});

	// Build current URL for redirect after sign-in
	const currentUrl = useMemo(() => {
		const params = searchParams.toString();
		return params ? `${pathname}?${params}` : pathname;
	}, [pathname, searchParams]);

	// Get slots for the selected court
	const courtAvailability = useMemo(() => {
		if (!availability) return null;
		return availability.find((c) => c.courtId === selectedCourtId) ?? null;
	}, [availability, selectedCourtId]);

	// Build start time options from available half-hour slots
	const startTimeOptions = useMemo(() => {
		if (!courtAvailability) return [];
		return courtAvailability.slots.map((slot) => ({
			value: slot.startTime,
			label: formatTime(slot.startTime),
			disabled: !slot.isAvailable,
		}));
	}, [courtAvailability]);

	// Build end time options based on selected start
	const endTimeOptions = useMemo(() => {
		if (!selectedStart || !courtAvailability) return [];
		const startMs = new Date(selectedStart).getTime();
		const minEnd = startMs + 60 * 60 * 1000; // +1 hour
		const maxEnd = startMs + maxBookingHours * 60 * 60 * 1000;

		const options: Array<{
			value: string;
			label: string;
			disabled: boolean;
		}> = [];

		// Collect consecutive half-hour slots from selected start
		let hitUnavailable = false;

		for (const slot of courtAvailability.slots) {
			const slotStartMs = new Date(slot.startTime).getTime();
			if (slotStartMs < startMs) continue;
			if (slotStartMs >= maxEnd) break;

			if (slotStartMs === startMs) continue; // skip the start slot itself

			if (!slot.isAvailable) {
				hitUnavailable = true;
			}

			const endMs = new Date(slot.endTime).getTime();
			if (endMs >= minEnd && endMs <= maxEnd + 30 * 60 * 1000) {
				if (endMs >= minEnd) {
					options.push({
						value: slot.endTime,
						label: formatTime(slot.endTime),
						disabled: hitUnavailable,
					});
				}
			}
		}

		return options;
	}, [selectedStart, courtAvailability, maxBookingHours]);

	const handleBookClick = () => {
		if (!selectedStart || !selectedEnd || !selectedCourtId) return;
		const court = courts.find((c) => c.resourceId === selectedCourtId);
		setConfirmTarget({
			courtName: court?.title ?? "Court",
			startLabel: formatTime(selectedStart),
			endLabel: formatTime(selectedEnd),
			resourceId: selectedCourtId,
			startTime: new Date(selectedStart),
			endTime: new Date(selectedEnd),
		});
	};

	const handleConfirmBook = () => {
		if (!confirmTarget) return;
		bookMutation.mutate({
			rentalWindowEventId,
			resourceId: confirmTarget.resourceId,
			startTime: confirmTarget.startTime,
			endTime: confirmTarget.endTime,
		});
		setConfirmTarget(null);
	};

	if (isAvailLoading) {
		return (
			<p className="text-[var(--muted-foreground)] text-sm">
				Loading availability...
			</p>
		);
	}

	const selectClassName =
		"flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

	return (
		<div className="space-y-4">
			<ToastContainer toasts={toasts} onDismiss={dismiss} />

			{/* Court selector */}
			{courts.length > 1 && (
				<div className="space-y-1">
					<label className="font-medium text-[var(--foreground)] text-sm">
						Court
					</label>
					<select
						value={selectedCourtId}
						onChange={(e) => {
							setSelectedCourtId(e.target.value);
							setSelectedStart("");
							setSelectedEnd("");
						}}
						className={selectClassName}
					>
						{courts.map((court) => (
							<option key={court.resourceId} value={court.resourceId}>
								{court.title}
							</option>
						))}
					</select>
				</div>
			)}

			{/* Start time */}
			<div className="space-y-1">
				<label className="font-medium text-[var(--foreground)] text-sm">
					Start Time
				</label>
				<select
					value={selectedStart}
					onChange={(e) => {
						setSelectedStart(e.target.value);
						setSelectedEnd("");
					}}
					className={selectClassName}
				>
					<option value="">Select start time</option>
					{startTimeOptions.map((opt) => (
						<option
							key={opt.value}
							value={opt.value}
							disabled={opt.disabled}
						>
							{opt.label}
							{opt.disabled ? " (unavailable)" : ""}
						</option>
					))}
				</select>
			</div>

			{/* End time */}
			{selectedStart && (
				<div className="space-y-1">
					<label className="font-medium text-[var(--foreground)] text-sm">
						End Time
					</label>
					<select
						value={selectedEnd}
						onChange={(e) => setSelectedEnd(e.target.value)}
						className={selectClassName}
					>
						<option value="">Select end time</option>
						{endTimeOptions.map((opt) => (
							<option
								key={opt.value}
								value={opt.value}
								disabled={opt.disabled}
							>
								{opt.label}
								{opt.disabled ? " (unavailable)" : ""}
							</option>
						))}
					</select>
				</div>
			)}

			{/* Book / Sign-in button */}
			<div className="pt-2">
				{isSignedIn ? (
					<Button
						onClick={handleBookClick}
						disabled={
							!selectedStart ||
							!selectedEnd ||
							bookMutation.isPending
						}
					>
						{bookMutation.isPending ? "Booking..." : "Book"}
					</Button>
				) : (
					<SignInButton
						forceRedirectUrl={currentUrl}
						signUpForceRedirectUrl={currentUrl}
					>
						<Button>Sign in to Book</Button>
					</SignInButton>
				)}
			</div>

			<AlertDialog
				open={!!confirmTarget}
				title="Confirm Booking"
				description={
					confirmTarget
						? `Book ${confirmTarget.courtName} from ${confirmTarget.startLabel} to ${confirmTarget.endLabel}?`
						: ""
				}
				confirmLabel="Book"
				onConfirm={handleConfirmBook}
				onCancel={() => setConfirmTarget(null)}
			/>
		</div>
	);
}
