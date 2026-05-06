"use client";

import { useAuth } from "@clerk/nextjs";
import { CheckCircle, Clock, LogIn } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Registration = {
	registrationId: string;
	status: "REGISTERED" | "CHECKED_IN";
	event: {
		eventId: string;
		title: string;
		start: Date;
		end: Date;
		eventType: string;
		maxParticipants: number | null;
		resourceTitle: string | null;
	};
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(date: Date) {
	return new Date(date).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatDate(date: Date) {
	return new Date(date).toLocaleDateString([], {
		weekday: "long",
		month: "long",
		day: "numeric",
	});
}

/** Returns true when now is within +-30 min of event start */
function isWithinCheckinWindow(eventStart: Date): boolean {
	const now = Date.now();
	const start = new Date(eventStart).getTime();
	const windowMs = 30 * 60 * 1000;
	return now >= start - windowMs && now <= start + windowMs;
}

/** Returns true when the event has ended */
function hasEventEnded(eventEnd: Date): boolean {
	return Date.now() > new Date(eventEnd).getTime();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SignInPrompt({ redirectUrl }: { redirectUrl: string }) {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4">
			<LogIn size={48} className="text-[var(--muted-foreground)]" />
			<h1 className="text-center font-semibold text-[var(--foreground)] text-xl">
				Sign in to check in
			</h1>
			<p className="text-center text-[var(--muted-foreground)] text-sm">
				Please sign in to view your events and check in.
			</p>
			<a href={`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`}>
				<Button className="min-h-[44px] min-w-[200px]">
					<LogIn size={18} />
					Sign In
				</Button>
			</a>
		</div>
	);
}

function ConfirmDialog({
	eventTitle,
	eventTime,
	onConfirm,
	onCancel,
	isPending,
}: {
	eventTitle: string;
	eventTime: string;
	onConfirm: () => void;
	onCancel: () => void;
	isPending: boolean;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 shadow-lg">
				<h2 className="font-semibold text-[var(--foreground)] text-lg">
					Confirm Check-in
				</h2>
				<p className="mt-2 text-[var(--muted-foreground)] text-sm">
					Check in to <strong>{eventTitle}</strong> at {eventTime}?
				</p>
				<div className="mt-6 flex gap-3">
					<Button
						variant="outline"
						className="min-h-[44px] flex-1"
						onClick={onCancel}
						disabled={isPending}
					>
						Cancel
					</Button>
					<Button
						className="min-h-[44px] flex-1"
						onClick={onConfirm}
						disabled={isPending}
					>
						{isPending ? "Checking in..." : "Check In"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function EventCard({
	registration,
	onCheckin,
}: {
	registration: Registration;
	onCheckin: (reg: Registration) => void;
}) {
	const { status, event } = registration;
	const ended = hasEventEnded(event.end);
	const inWindow = isWithinCheckinWindow(event.start);
	const canCheckin = status === "REGISTERED" && !ended && inWindow;
	const showDisabledCheckin = status === "REGISTERED" && !ended && !inWindow;

	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
			{/* Title row */}
			<div className="flex items-start justify-between gap-2">
				<h3 className="font-medium text-[var(--foreground)]">{event.title}</h3>
				{status === "CHECKED_IN" && (
					<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-green-700 text-xs font-medium">
						<CheckCircle size={14} />
						Checked in
					</span>
				)}
			</div>

			{/* Details */}
			<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--muted-foreground)] text-sm">
				<span className="inline-flex items-center gap-1">
					<Clock size={14} />
					{formatTime(event.start)} &ndash; {formatTime(event.end)}
				</span>
				{event.resourceTitle && (
					<span className="rounded bg-[var(--accent)] px-2 py-0.5 text-xs">
						{event.resourceTitle}
					</span>
				)}
			</div>

			{/* Check-in button */}
			{canCheckin && (
				<Button
					className="mt-3 min-h-[44px] w-full"
					onClick={() => onCheckin(registration)}
				>
					Check In
				</Button>
			)}

			{showDisabledCheckin && (
				<Button
					className="mt-3 min-h-[44px] w-full"
					disabled
					title="Check-in opens 30 minutes before event starts"
				>
					Check-in opens 30 min before start
				</Button>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CheckinClient({
	clubShortName,
	facilityId,
}: {
	clubShortName: string;
	facilityId: string;
}) {
	const { isSignedIn, isLoaded } = useAuth();
	const { toast } = useToast();
	const [confirmReg, setConfirmReg] = useState<Registration | null>(null);

	const currentPath = `/checkin/${clubShortName}/${facilityId}`;

	// QR code sizing — 60% of viewport width, capped at 280px
	const [qrSize, setQrSize] = useState(220);
	useEffect(() => {
		const update = () =>
			setQrSize(Math.min(Math.floor(window.innerWidth * 0.6), 280));
		update();
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, []);

	// Data query (only when signed in)
	const {
		data,
		isLoading: isDashboardLoading,
		error: dashboardError,
	} = api.checkin.getMemberCheckinDashboard.useQuery(
		{ clubShortName, facilityId },
		{ enabled: isSignedIn === true },
	);

	const utils = api.useUtils();

	const selfCheckinMutation = api.checkin.selfCheckin.useMutation({
		onSuccess: (result) => {
			if (result.alreadyCheckedIn) {
				toast("Already checked in", "info");
			} else {
				toast("Checked in!", "success");
			}
			void utils.checkin.getMemberCheckinDashboard.invalidate();
			setConfirmReg(null);
		},
		onError: (err) => {
			toast(err.message, "error");
			setConfirmReg(null);
		},
	});

	const handleCheckin = useCallback((reg: Registration) => {
		setConfirmReg(reg);
	}, []);

	const handleConfirm = useCallback(() => {
		if (!confirmReg) return;
		selfCheckinMutation.mutate({
			registrationId: confirmReg.registrationId,
			facilityId,
		});
	}, [confirmReg, facilityId, selfCheckinMutation]);

	// -----------------------------------------------------------------------
	// Auth loading
	// -----------------------------------------------------------------------
	if (!isLoaded) {
		return (
			<div className="flex min-h-dvh items-center justify-center">
				<p className="text-[var(--muted-foreground)] text-sm">Loading...</p>
			</div>
		);
	}

	// Not signed in
	if (!isSignedIn) {
		return <SignInPrompt redirectUrl={currentPath} />;
	}

	// Dashboard loading
	if (isDashboardLoading) {
		return (
			<div className="flex min-h-dvh items-center justify-center">
				<div className="animate-pulse space-y-3 text-center">
					<div className="mx-auto h-6 w-48 rounded bg-gray-200" />
					<div className="mx-auto h-4 w-32 rounded bg-gray-200" />
				</div>
			</div>
		);
	}

	// Error state
	if (dashboardError || !data) {
		return (
			<div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Something went wrong
				</h1>
				<p className="text-center text-[var(--muted-foreground)] text-sm">
					{dashboardError?.message ?? "Unable to load check-in data."}
				</p>
			</div>
		);
	}

	const { facility, member, registrations } = data;

	return (
		<div className="mx-auto min-h-dvh max-w-lg px-4 py-6">

			{/* Confirm dialog */}
			{confirmReg && (
				<ConfirmDialog
					eventTitle={confirmReg.event.title}
					eventTime={formatTime(confirmReg.event.start)}
					onConfirm={handleConfirm}
					onCancel={() => setConfirmReg(null)}
					isPending={selfCheckinMutation.isPending}
				/>
			)}

			{/* ------- Header ------- */}
			<header className="text-center">
				<h1 className="font-bold text-[var(--foreground)] text-xl">
					{data?.clubName}
				</h1>
				<p className="text-[var(--muted-foreground)] text-sm">
					{facility.name}
				</p>
				<p className="mt-1 text-[var(--muted-foreground)] text-xs">
					{formatDate(new Date())}
				</p>
			</header>

			{/* ------- QR Code ------- */}
			<section className="mt-6 flex flex-col items-center">
				{/* TODO (Phase 6c): upgrade to rotating signed JWT token */}
				<div className="rounded-xl border border-[var(--border)] bg-white p-4">
					<QRCodeSVG
						value={member.userId}
						size={qrSize}
						level="M"
					/>
				</div>
				<p className="mt-3 font-medium text-[var(--foreground)] text-sm">
					{member.firstName} {member.lastName}
				</p>
			</section>

			{/* ------- Today's Events ------- */}
			<section className="mt-8">
				<h2 className="mb-3 font-semibold text-[var(--foreground)] text-lg">
					Today&apos;s Events
				</h2>

				{registrations.length === 0 ? (
					<div className="flex h-32 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
						<p className="text-[var(--muted-foreground)] text-sm">
							No events scheduled for today
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{registrations.map((reg) => (
							<EventCard
								key={reg.registrationId}
								registration={reg as Registration}
								onCheckin={handleCheckin}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
