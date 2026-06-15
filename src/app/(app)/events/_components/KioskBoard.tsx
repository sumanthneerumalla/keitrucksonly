"use client";

import { SignInButton } from "@clerk/nextjs";
import { LogIn, Maximize2, Minimize2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CourtCard,
	Leaderboard,
	QueueByParty,
	memberDisplayName,
} from "~/app/(app)/events/_components/dropin-ui";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

/**
 * Read-only "Rotation Play" board for an UNAUTHENTICATED kiosk / TV display — the
 * screen on the gym wall. Composes the SAME shared building blocks as the
 * logged-in board (CourtCard + QueueByParty) so styling/colors are single-sourced
 * — it just omits every control (no join/leave/score/staff actions) and renders
 * the whole board at in-app sizes scaled up by one responsive transform wrapper,
 * so a TV shows it large and glanceable without any duplicate styling.
 *
 * Data comes from the public `dropIn.getPublicBoard` / `getPublicStandings`
 * procedures. Rotation is NOT driven here (a logged-in staff device advances the
 * timer); the kiosk only displays state and sounds the horn when a slot expires.
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

	const signInJoinUrl = `/join?clubShortName=${encodeURIComponent(
		clubShortName,
	)}${facilityId ? `&facilityId=${encodeURIComponent(facilityId)}` : ""}`;

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

	// QR target: the current event page (phones scan → sign in → join the queue).
	const [joinUrl, setJoinUrl] = useState("");
	useEffect(() => {
		setJoinUrl(`${window.location.origin}${window.location.pathname}`);
	}, []);

	// TV scale: render the board at in-app sizes, then scale the whole thing up on
	// wide screens. Divisor (1500) is larger than the centered column's max-width
	// (1000) so the scaled column always leaves symmetric margins — i.e. it reads
	// as a centered column (like the logged-in view), not edge-to-edge. No scale
	// ≤1500px (phones/laptops stay 1:1, centered), capped at 2× for large TVs.
	const [scale, setScale] = useState(1);
	useEffect(() => {
		const update = () =>
			setScale(Math.min(Math.max(window.innerWidth / 1500, 1), 2));
		update();
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, []);

	// ---- audio horn + kiosk fullscreen ---------------------------------------
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
	const toggleKiosk = useCallback(() => {
		// Already fullscreen → exit kiosk.
		if (document.fullscreenElement) {
			void document.exitFullscreen?.().catch(() => {});
			return;
		}
		// Enter: user gesture lets us unlock audio for the horn, then go fullscreen.
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
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<p className="text-[var(--muted-foreground)]">Loading board…</p>
			</div>
		);
	}

	// No session yet.
	if (!session) {
		return (
			<div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
				<h1 className="font-bold text-2xl text-[var(--foreground)]">
					{eventTitle}
				</h1>
				<p className="text-[var(--muted-foreground)]">
					This Rotation Play session hasn't started yet — the board will appear
					here once staff open it.
				</p>
				<div className="w-full max-w-sm">
					<SignInToJoin url={signInJoinUrl} />
				</div>
				{kioskMode && <JoinQueueQR url={joinUrl} />}
			</div>
		);
	}

	const isMatch = session.mode === "MATCH";
	const isPaused = session.status === "PAUSED";
	const isWindingDown = session.status === "ENDED";

	// Fully closed: cancelled, or ended with no games left to resolve.
	if (
		session.status === "CANCELLED" ||
		(session.status === "ENDED" && assignments.length === 0)
	) {
		return (
			<div className="mx-auto max-w-2xl space-y-4 p-6">
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

	const pool = board?.pool ?? [];
	const parties = board?.parties ?? [];

	return (
		<div style={{ zoom: scale }}>
			<div className="mx-auto w-full max-w-[1000px] space-y-5 p-5">
				{/* Header */}
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<div className="flex items-center gap-2">
							<h3 className="font-semibold text-[var(--foreground)]">
								{eventTitle}
							</h3>
							<span
								className={`rounded-full px-2 py-0.5 font-medium text-xs ${
									isWindingDown || isPaused
										? "bg-amber-50 text-amber-700"
										: "bg-green-50 text-green-700"
								}`}
							>
								{isWindingDown ? "Ending" : isPaused ? "Paused" : "Live"}
							</span>
						</div>
						<p className="mt-0.5 text-[var(--muted-foreground)] text-sm">
							{isMatch ? "Match play" : "Timed rotation"} ·{" "}
							{session.format ?? "—"}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{kioskMode && <JoinQueueQR url={joinUrl} />}
						<Button variant="outline" size="sm" onClick={toggleKiosk}>
							{kioskMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
							{kioskMode ? "Exit kiosk" : "Kiosk"}
						</Button>
					</div>
				</div>

				{/* Sign-in CTA — logged-out viewers join via /join (club+facility prefilled). */}
				<div className="mx-auto w-full max-w-md">
					<SignInToJoin url={signInJoinUrl} />
				</div>

				{isPaused && (
					<p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 text-sm">
						Session paused — waiting for a staff member to resume.
					</p>
				)}
				{isWindingDown && (
					<p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 text-sm">
						Session ending — the current games are finishing up.
					</p>
				)}

				{/* Courts (read-only — same CourtCard as the logged-in board). */}
				<div className="grid gap-3 sm:grid-cols-2">
					{session.courtIds.map((courtId) => (
						<CourtCard
							key={courtId}
							title={courtName(courtId)}
							assignment={assignments.find((x) => x.courtId === courtId)}
							now={now}
							isMatch={isMatch}
							renderPlayer={(p) => (
								<span className="text-[var(--foreground)]">
									{memberDisplayName(p.user)}
								</span>
							)}
						/>
					))}
				</div>

				{/* Queue (read-only — same QueueByParty as the logged-in board). */}
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
		</div>
	);
}

/**
 * "Sign in to join the queue" CTA for logged-out kiosk viewers. Opens Clerk in a
 * modal and redirects to `url` (/join with the event's club + facility prefilled)
 * so a new player flows through onboarding and can queue.
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
 * QR code captioned "Join the queue" — points phones at the current event page
 * (sign in → join). Renders nothing until `url` is resolved on the client.
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
