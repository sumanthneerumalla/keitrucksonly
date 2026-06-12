"use client";

import { SignInButton } from "@clerk/nextjs";
import { LogIn, Maximize2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Countdown,
	Leaderboard,
	QueueByParty,
	formatGames,
	memberDisplayName,
} from "~/app/(app)/events/_components/dropin-ui";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

/**
 * Read-only "Rotation Play" board for an UNAUTHENTICATED kiosk display — the
 * iPad on the wall. Mirrors the live view in DropInEventDetails but exposes NO
 * controls (no join/leave/score/staff actions), so players can't manipulate
 * timed matches by tapping the screen. Data comes from the public
 * `dropIn.getPublicBoard` / `getPublicStandings` procedures.
 *
 * Rotation is NOT driven here (by design): a separate logged-in staff device
 * advances the timer (see designFiles/drop-in). The kiosk only displays state
 * and sounds the horn locally when a slot's clock runs out.
 */
export default function KioskBoard({
	eventId,
	eventStart,
	eventTitle,
	clubShortName,
	facilityId,
}: {
	eventId: string;
	eventStart: string | Date;
	eventTitle: string;
	clubShortName: string;
	facilityId: string | null;
}) {
	const { toast } = useToast();

	// Where a logged-out viewer goes to sign in and actually JOIN the queue.
	// Route them to /join with this event's club (+ facility when known) prefilled
	// so onboarding is instant (both present -> /join auto-joins) instead of Clerk
	// dropping them back on the event page where they can't join as a non-member.
	const signInJoinUrl = `/join?clubShortName=${encodeURIComponent(
		clubShortName,
	)}${facilityId ? `&facilityId=${encodeURIComponent(facilityId)}` : ""}`;

	// One occurrence per day; the occurrence key is the event's start (mirrors
	// DropInEventDetails — recurring "daily league" normalization is an R3 concern).
	const occurrenceDate = useMemo(() => new Date(eventStart), [eventStart]);

	const boardQuery = api.dropIn.getPublicBoard.useQuery(
		{ eventId, occurrenceDate },
		{ refetchInterval: 3000 },
	);
	const board = boardQuery.data;
	const session = board?.session ?? null;

	const courtName = useCallback(
		(id: string) =>
			board?.courts.find((c) => c.resourceId === id)?.title ?? "Court",
		[board],
	);

	// QR target: the kiosk is rendered ON the event page, so the current URL is
	// exactly the page we want phones to open to sign in and join the queue.
	// Resolved on mount to avoid SSR/hydration mismatch (no window on the server).
	const [joinUrl, setJoinUrl] = useState("");
	useEffect(() => {
		setJoinUrl(`${window.location.origin}${window.location.pathname}`);
	}, []);

	// ---- audio horn + kiosk fullscreen ---------------------------------------
	// `kioskMode` tracks whether we're actually in the fullscreen kiosk display
	// (entered via the Kiosk button). The "Join the queue" QR shows ONLY then.
	// Synced to the browser's fullscreen state so exiting (e.g. Esc) hides it too.
	const [kioskMode, setKioskMode] = useState(false);
	useEffect(() => {
		const onChange = () => setKioskMode(!!document.fullscreenElement);
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);

	const audioCtxRef = useRef<AudioContext | null>(null);
	const firedHornsRef = useRef<Set<string>>(new Set());
	const playHorn = useCallback(() => {
		const ctx = audioCtxRef.current;
		if (!ctx) return;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "square";
		osc.frequency.value = 440;
		gain.gain.value = 0.2;
		osc.connect(gain).connect(ctx.destination);
		osc.start();
		osc.stop(ctx.currentTime + 0.7);
	}, []);
	const enableKiosk = useCallback(() => {
		// User gesture: create/resume the AudioContext so the horn can play later.
		if (!audioCtxRef.current) {
			audioCtxRef.current = new (
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext })
					.webkitAudioContext
			)();
		}
		void audioCtxRef.current.resume();
		void document.documentElement.requestFullscreen?.().catch(() => {});
		toast("Kiosk mode on — horn enabled.", "success");
	}, [toast]);

	// ---- 1s ticker for countdowns + horn -------------------------------------
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);
	const assignments = useMemo(() => session?.assignments ?? [], [session]);
	useEffect(() => {
		for (const a of assignments) {
			if (!a.expiresAt) continue;
			if (new Date(a.expiresAt).getTime() > now) continue;
			// Slot expired: sound the horn once. (Rotation itself is driven by the
			// staff device — the kiosk just alerts the room.)
			if (!firedHornsRef.current.has(a.assignmentId)) {
				firedHornsRef.current.add(a.assignmentId);
				playHorn();
			}
		}
	}, [assignments, now, playHorn]);

	// ---- standings (MATCH) ---------------------------------------------------
	const standingsQuery = api.dropIn.getPublicStandings.useQuery(
		{ sessionId: session?.sessionId ?? "" },
		{ enabled: !!session && session.mode === "MATCH", refetchInterval: 5000 },
	);

	// -------------------------------------------------------------------------
	if (boardQuery.isLoading) {
		return <div className="h-40 animate-pulse rounded-lg bg-[var(--muted)]" />;
	}

	// No session yet.
	if (!session) {
		return (
			<div className="flex flex-col items-center rounded-lg border border-[var(--border)] p-6 text-center">
				<p className="font-medium text-[var(--foreground)]">{eventTitle}</p>
				<p className="mt-1 text-[var(--muted-foreground)] text-sm">
					This Rotation Play session hasn't started yet. The board will appear
					here once staff open it.
				</p>
				<div className="mt-4 w-full max-w-xs">
					<SignInToJoin url={signInJoinUrl} />
				</div>
				{kioskMode && (
					<div className="mt-4">
						<JoinQueueQR url={joinUrl} />
					</div>
				)}
			</div>
		);
	}

	// Fully closed: cancelled, or ended with no games left to resolve.
	if (
		session.status === "CANCELLED" ||
		(session.status === "ENDED" && assignments.length === 0)
	) {
		return (
			<div className="space-y-4">
				<div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-5 text-center">
					<p className="font-semibold text-[var(--foreground)]">
						{eventTitle} — session ended
					</p>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						{session.mode === "MATCH"
							? "Final results below."
							: "Thanks for playing!"}
					</p>
				</div>
				{session.mode === "MATCH" && (
					<Leaderboard rows={standingsQuery.data ?? []} />
				)}
			</div>
		);
	}

	const isMatch = session.mode === "MATCH";
	const isPaused = session.status === "PAUSED";
	const isWindingDown = session.status === "ENDED";

	const pool = board?.pool ?? [];
	const parties = board?.parties ?? [];

	type Assignment = (typeof assignments)[number];
	const renderSide = (a: Assignment, side: "A" | "B") => {
		const ps = a.participants.filter((p) => p.side === side);
		if (ps.length === 0)
			return (
				<span className="text-[var(--muted-foreground)]">Side {side}</span>
			);
		return ps.map((p, i) => (
			<span key={p.userId} className="inline-flex items-center">
				{i > 0 && (
					<span className="mx-1 text-[var(--muted-foreground)]">&</span>
				)}
				<span className="text-[var(--foreground)]">
					{memberDisplayName(p.user)}
				</span>
			</span>
		));
	};

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="font-semibold text-[var(--foreground)]">
						{eventTitle}
					</h3>
					<p className="text-[var(--muted-foreground)] text-xs">
						{session.mode === "TIMED" ? "Timed rotation" : "Match play"} ·{" "}
						{session.format ?? "—"} ·{" "}
						{isWindingDown ? (
							<span className="text-amber-600">ending</span>
						) : isPaused ? (
							<span className="text-amber-600">paused</span>
						) : (
							<span className="text-green-600">live</span>
						)}
					</p>
				</div>
				<div className="flex items-center gap-3">
					{kioskMode && <JoinQueueQR url={joinUrl} />}
					<Button variant="outline" size="sm" onClick={enableKiosk}>
						<Maximize2 size={14} /> Kiosk
					</Button>
				</div>
			</div>

			{/* Sign-in CTA — logged-out viewers join via /join (club+facility
			    prefilled) so they end up onboarded members who can actually queue,
			    rather than Clerk bouncing them back here as non-members. */}
			<SignInToJoin url={signInJoinUrl} />

			{isPaused && (
				<p className="rounded-md bg-amber-100 px-3 py-2 text-amber-800 text-sm">
					Session paused — waiting for a staff member to resume.
				</p>
			)}
			{isWindingDown && (
				<p className="rounded-md bg-amber-100 px-3 py-2 text-amber-800 text-sm">
					Session ending — the current games are finishing up.
				</p>
			)}

			{/* Courts */}
			<div className="grid gap-3 sm:grid-cols-2">
				{session.courtIds.map((courtId) => {
					const a = assignments.find((x) => x.courtId === courtId);
					return (
						<div
							key={courtId}
							className="rounded-lg border border-[var(--border)] p-3"
						>
							<div className="mb-2 flex items-center justify-between">
								<span className="font-medium text-[var(--foreground)] text-sm">
									{courtName(courtId)}
								</span>
								{a?.expiresAt && (
									<Countdown expiresAt={a.expiresAt} now={now} />
								)}
							</div>

							{!a && (
								<span className="text-[var(--muted-foreground)] text-sm">
									Empty
								</span>
							)}

							{a && (
								<div className="space-y-2">
									{isMatch ? (
										<div className="flex items-center justify-between gap-2 text-sm">
											<span className="flex flex-1 flex-wrap items-center gap-x-1">
												{renderSide(a, "A")}
											</span>
											<span className="shrink-0 text-[var(--muted-foreground)] text-xs">
												{a.reportedScoreA != null
													? `${a.reportedScoreA}–${a.reportedScoreB}`
													: "vs"}
											</span>
											<span className="flex flex-1 flex-wrap items-center justify-end gap-x-1">
												{renderSide(a, "B")}
											</span>
										</div>
									) : (
										<div className="flex flex-wrap gap-1 text-sm">
											{a.participants.map((p) => (
												<span
													key={p.userId}
													className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs"
												>
													{memberDisplayName(p.user)}
												</span>
											))}
										</div>
									)}

									{a.status === "PENDING_CONFIRM" ? (
										<div className="rounded bg-amber-100 px-2 py-1 font-semibold text-amber-800 text-xs">
											⏳ Awaiting confirmation
										</div>
									) : a.status === "DISPUTED" ? (
										<div className="rounded bg-red-100 px-2 py-1 font-semibold text-red-700 text-xs">
											⚠ Disputed — held for staff
										</div>
									) : (
										<div className="text-[var(--muted-foreground)] text-xs">
											In progress
										</div>
									)}

									{isMatch && a.reportedScoreA != null && (
										<div className="font-mono text-[var(--muted-foreground)] text-xs">
											{formatGames(a.gameScores)}
										</div>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Queue (read-only) */}
			<div className="rounded-lg border border-[var(--border)] p-3">
				<div className="mb-2 font-medium text-[var(--foreground)] text-sm">
					Waiting ({pool.length})
				</div>
				<QueueByParty
					parties={parties}
					pool={pool}
					viewerUserId=""
					viewerPartyId={null}
					isStaff={false}
					onChange={() => {
						/* read-only kiosk: nothing to refresh on interaction */
					}}
					courtName={courtName}
				/>
			</div>

			{/* Leaderboard (MATCH) */}
			{isMatch && <Leaderboard rows={standingsQuery.data ?? []} />}
		</div>
	);
}

/**
 * "Sign in to join the queue" CTA for logged-out kiosk viewers. Opens Clerk in a
 * modal and, on success, forces a redirect to `url` (/join with the event's club +
 * facility prefilled) instead of returning to the event page — so a brand-new
 * player flows through onboarding and becomes a member who can actually queue.
 */
function SignInToJoin({ url }: { url: string }) {
	return (
		<SignInButton
			mode="modal"
			forceRedirectUrl={url}
			signUpForceRedirectUrl={url}
		>
			<button
				type="button"
				className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 font-medium text-sm text-white transition-colors hover:bg-[var(--primary-dark)]"
			>
				<LogIn size={16} /> Sign in to join the queue
			</button>
		</SignInButton>
	);
}

/**
 * Small QR code captioned "Join the queue" — points phones at the current event
 * page (sign in → join). Pure SVG via the already-bundled `qrcode.react`; renders
 * nothing until `url` is resolved on the client (avoids an SSR placeholder code).
 */
function JoinQueueQR({ url }: { url: string }) {
	if (!url) return null;
	return (
		<div className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white p-2.5">
			<QRCodeSVG value={url} size={88} level="M" />
			<span className="font-medium text-[var(--foreground)] text-xs">
				Join the queue
			</span>
		</div>
	);
}
