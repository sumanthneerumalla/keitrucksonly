"use client";

import { Maximize2, Trophy, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { Select } from "~/app/_components/shared/ui/select";
import { api } from "~/trpc/react";

/**
 * Live drop-in "Rotation Play" board (DI-2 TIMED + DI-4 MATCH), rendered on the
 * event page when event.eventType === 'DROP_IN'. Polls ~3s. Renders per-role:
 * staff get session + court controls; members self-serve the queue and report/
 * confirm scores. Happy-path (see designFiles/drop-in): doubles auto-pairs from
 * queue order; "start next" is explicit; GBR sync is stubbed.
 */
export default function DropInEventDetails({
	eventId,
	eventStart,
	eventTitle,
	isStaff,
	userId,
}: {
	eventId: string;
	eventStart: string | Date;
	eventTitle: string;
	isStaff: boolean;
	userId: string;
}) {
	const { toast } = useToast();
	const utils = api.useUtils();

	// One occurrence per day; for the (non-recurring) demo the occurrence key is
	// the event's start. Recurring "daily league" normalization is an R3 concern.
	const occurrenceDate = useMemo(() => new Date(eventStart), [eventStart]);

	const isLoggedIn = userId !== "";

	const boardQuery = api.dropIn.getBoard.useQuery(
		{ eventId, occurrenceDate },
		{ enabled: isLoggedIn, refetchInterval: 3000 },
	);
	const board = boardQuery.data;
	const session = board?.session ?? null;

	const resourcesQuery = api.calendar.getResources.useQuery(
		{},
		{ enabled: isLoggedIn },
	);
	const courtName = useCallback(
		(id: string) =>
			resourcesQuery.data?.resources.find((r) => r.resourceId === id)?.title ??
			"Court",
		[resourcesQuery.data],
	);

	const refresh = useCallback(() => {
		void utils.dropIn.getBoard.invalidate({ eventId, occurrenceDate });
	}, [utils, eventId, occurrenceDate]);

	// ---- mutations -----------------------------------------------------------
	const startSession = api.dropIn.startSession.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
	});
	const endSession = api.dropIn.endSession.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
	});
	const formNext = api.dropIn.formNext.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
	});
	const endSlot = api.dropIn.endSlot.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
	});
	const joinQueue = api.dropIn.joinQueue.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
	});
	const leaveQueue = api.dropIn.leaveQueue.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
	});
	const rejoin = api.dropIn.rejoin.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
	});
	const reportScore = api.dropIn.reportScore.useMutation({
		onSuccess: () => {
			setReportingFor(null);
			refresh();
		},
		onError: (e) => toast(e.message, "error"),
	});
	const confirmScore = api.dropIn.confirmScore.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
	});
	// Background auto-rotation tick (TIMED). Fired when a slot expires; silent on
	// error (it's a background poll, not a user action).
	const tickTimed = api.dropIn.tickTimed.useMutation({
		onSuccess: (res) => {
			if (res.rotated > 0) refresh();
		},
	});

	// ---- start-session form (staff, before a session exists) -----------------
	const [mode, setMode] = useState<"TIMED" | "MATCH">("TIMED");
	const [format, setFormat] = useState<"SINGLES" | "DOUBLES">("DOUBLES");
	const [rotationMinutes, setRotationMinutes] = useState(15);

	// ---- score reporting -----------------------------------------------------
	const [reportingFor, setReportingFor] = useState<string | null>(null);

	// ---- audio horn + kiosk --------------------------------------------------
	const audioCtxRef = useRef<AudioContext | null>(null);
	const firedHornsRef = useRef<Set<string>>(new Set());
	const tickedRef = useRef<Set<string>>(new Set());
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
		let shouldTick = false;
		for (const a of assignments) {
			if (!a.expiresAt) continue;
			if (new Date(a.expiresAt).getTime() > now) continue;
			// Slot expired: fire the horn once, and trigger a server rotation once.
			if (!firedHornsRef.current.has(a.assignmentId)) {
				firedHornsRef.current.add(a.assignmentId);
				playHorn();
			}
			if (!tickedRef.current.has(a.assignmentId)) {
				tickedRef.current.add(a.assignmentId);
				shouldTick = true;
			}
		}
		if (shouldTick && session && session.mode === "TIMED") {
			tickTimed.mutate({ sessionId: session.sessionId });
		}
	}, [assignments, now, playHorn, session, tickTimed]);

	// ---- standings (MATCH) ---------------------------------------------------
	const standingsQuery = api.dropIn.getStandings.useQuery(
		{ sessionId: session?.sessionId ?? "" },
		{ enabled: isLoggedIn && !!session && session.mode === "MATCH" },
	);

	// -------------------------------------------------------------------------
	if (!isLoggedIn) {
		return (
			<div className="rounded-lg border border-[var(--border)] p-6 text-center">
				<p className="font-medium text-[var(--foreground)]">{eventTitle}</p>
				<p className="mt-1 text-[var(--muted-foreground)] text-sm">
					Rotation Play — sign in to join the queue and play.
				</p>
			</div>
		);
	}

	if (boardQuery.isLoading) {
		return <div className="h-40 animate-pulse rounded-lg bg-[var(--muted)]" />;
	}

	// No session yet.
	if (!session) {
		if (!isStaff) {
			return (
				<div className="rounded-lg border border-[var(--border)] p-6 text-center text-[var(--muted-foreground)] text-sm">
					This Rotation Play session hasn't started yet. Check back when staff
					open it.
				</div>
			);
		}
		return (
			<div className="space-y-3 rounded-lg border border-[var(--border)] p-5">
				<h3 className="font-semibold text-[var(--foreground)]">
					Start Rotation Play
				</h3>
				<div className="flex flex-wrap gap-3">
					<label className="space-y-1">
						<span className="text-[var(--muted-foreground)] text-xs">Mode</span>
						<Select
							value={mode}
							onChange={(e) => setMode(e.target.value as "TIMED" | "MATCH")}
							className="h-9"
						>
							<option value="TIMED">Timed rotation</option>
							<option value="MATCH">Match (scored)</option>
						</Select>
					</label>
					<label className="space-y-1">
						<span className="text-[var(--muted-foreground)] text-xs">
							Format
						</span>
						<Select
							value={format}
							onChange={(e) =>
								setFormat(e.target.value as "SINGLES" | "DOUBLES")
							}
							className="h-9"
						>
							<option value="SINGLES">Singles</option>
							<option value="DOUBLES">Doubles</option>
						</Select>
					</label>
					{mode === "TIMED" && (
						<label className="space-y-1">
							<span className="text-[var(--muted-foreground)] text-xs">
								Minutes / slot
							</span>
							<Select
								value={String(rotationMinutes)}
								onChange={(e) => setRotationMinutes(Number(e.target.value))}
								className="h-9"
							>
								{[10, 15, 20, 25, 30].map((m) => (
									<option key={m} value={m}>
										{m}
									</option>
								))}
							</Select>
						</label>
					)}
				</div>
				<Button
					size="sm"
					disabled={startSession.isPending}
					onClick={() =>
						startSession.mutate({
							eventId,
							occurrenceDate,
							mode,
							format,
							...(mode === "TIMED" && { rotationMinutes }),
						})
					}
				>
					{startSession.isPending ? "Starting…" : "Start session"}
				</Button>
			</div>
		);
	}

	// Active session.
	const viewerCheckIn = session.checkIns.find((c) => c.userId === userId);
	const viewerStatus = viewerCheckIn?.status ?? null;
	const isMatch = session.mode === "MATCH";
	const playersPerCourt = session.format === "SINGLES" ? 2 : 4;

	const pool = board?.pool ?? [];
	const fullName = (u: { firstName: string | null; lastName: string | null }) =>
		`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Player";

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
						<span className="text-green-600">live</span>
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={enableKiosk}>
						<Maximize2 size={14} /> Kiosk
					</Button>
					{isStaff && (
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								endSession.mutate({ sessionId: session.sessionId })
							}
						>
							End session
						</Button>
					)}
				</div>
			</div>

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
								<div className="flex items-center justify-between">
									<span className="text-[var(--muted-foreground)] text-sm">
										Empty
									</span>
									{isStaff && (
										<Button
											size="sm"
											disabled={
												formNext.isPending || pool.length < playersPerCourt
											}
											onClick={() =>
												formNext.mutate({
													sessionId: session.sessionId,
													courtId,
												})
											}
										>
											Start next
										</Button>
									)}
								</div>
							)}

							{a && (
								<div className="space-y-2">
									{isMatch ? (
										<div className="flex items-center justify-between text-sm">
											<TeamNames
												label="A"
												names={a.participants
													.filter((p) => p.side === "A")
													.map((p) => fullName(p.user))}
											/>
											<span className="text-[var(--muted-foreground)] text-xs">
												{a.reportedScoreA != null
													? `${a.reportedScoreA}–${a.reportedScoreB}`
													: "vs"}
											</span>
											<TeamNames
												label="B"
												names={a.participants
													.filter((p) => p.side === "B")
													.map((p) => fullName(p.user))}
											/>
										</div>
									) : (
										<div className="flex flex-wrap gap-1 text-sm">
											{a.participants.map((p) => (
												<span
													key={p.userId}
													className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs"
												>
													{fullName(p.user)}
												</span>
											))}
										</div>
									)}

									<div className="text-[var(--muted-foreground)] text-xs">
										{a.status === "PENDING_CONFIRM"
											? "Reported — awaiting confirmation"
											: a.status === "IN_PROGRESS"
												? "In progress"
												: a.status}
									</div>

									{/* Controls */}
									{!isMatch && isStaff && (
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												endSlot.mutate({ assignmentId: a.assignmentId })
											}
										>
											End slot
										</Button>
									)}

									{isMatch &&
										a.status === "IN_PROGRESS" &&
										a.participants.some((p) => p.userId === userId) && (
											<Button
												size="sm"
												onClick={() => setReportingFor(a.assignmentId)}
											>
												Report score
											</Button>
										)}

									{isMatch &&
										a.status === "PENDING_CONFIRM" &&
										a.participants.some((p) => p.userId === userId) &&
										a.reportedByUserId !== userId && (
											<Button
												size="sm"
												disabled={confirmScore.isPending}
												onClick={() =>
													confirmScore.mutate({ assignmentId: a.assignmentId })
												}
											>
												Confirm {a.reportedScoreA}–{a.reportedScoreB}
											</Button>
										)}

									{reportingFor === a.assignmentId && (
										<ScoreEntry
											bestOf={session.bestOf ?? 3}
											pending={reportScore.isPending}
											onCancel={() => setReportingFor(null)}
											onSubmit={(gameScores) =>
												reportScore.mutate({
													assignmentId: a.assignmentId,
													gameScores,
												})
											}
										/>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Queue + your controls */}
			<div className="rounded-lg border border-[var(--border)] p-3">
				<div className="mb-2 flex items-center justify-between">
					<span className="font-medium text-[var(--foreground)] text-sm">
						Waiting ({pool.length})
					</span>
					<div className="flex gap-2">
						{viewerStatus === "WAITING" ? (
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									leaveQueue.mutate({ sessionId: session.sessionId })
								}
							>
								Leave queue
							</Button>
						) : viewerStatus === "AWAITING_RESULT" ? (
							<Button
								size="sm"
								onClick={() => rejoin.mutate({ sessionId: session.sessionId })}
							>
								Rejoin queue
							</Button>
						) : viewerStatus === "PLAYING" ? (
							<span className="text-[var(--muted-foreground)] text-xs">
								You're on a court
							</span>
						) : (
							<Button
								size="sm"
								onClick={() =>
									joinQueue.mutate({ sessionId: session.sessionId })
								}
							>
								Join queue
							</Button>
						)}
					</div>
				</div>
				{pool.length === 0 ? (
					<p className="text-[var(--muted-foreground)] text-sm">
						No one waiting.
					</p>
				) : (
					<ol className="space-y-1">
						{pool.map((c, i) => (
							<li
								key={c.checkInId}
								className={`flex items-center gap-2 text-sm ${
									c.userId === userId
										? "font-medium text-[var(--primary)]"
										: "text-[var(--foreground)]"
								}`}
							>
								<span className="text-[var(--muted-foreground)] text-xs">
									{i + 1}.
								</span>
								{fullName(c.user)}
							</li>
						))}
					</ol>
				)}
			</div>

			{/* Leaderboard (MATCH) */}
			{isMatch && (standingsQuery.data?.length ?? 0) > 0 && (
				<div className="rounded-lg border border-[var(--border)] p-3">
					<div className="mb-2 flex items-center gap-1.5 font-medium text-[var(--foreground)] text-sm">
						<Trophy size={14} /> Leaderboard
					</div>
					<table className="w-full text-sm">
						<thead>
							<tr className="text-[var(--muted-foreground)] text-xs">
								<th className="text-left font-normal">Player</th>
								<th className="text-right font-normal">W</th>
								<th className="text-right font-normal">L</th>
								<th className="text-right font-normal">+/−</th>
							</tr>
						</thead>
						<tbody>
							{standingsQuery.data?.map((s) => (
								<tr key={s.userId}>
									<td className="text-[var(--foreground)]">{fullName(s)}</td>
									<td className="text-right">{s.wins}</td>
									<td className="text-right">{s.losses}</td>
									<td className="text-right">{s.pointDiff}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function Countdown({
	expiresAt,
	now,
}: { expiresAt: string | Date; now: number }) {
	const ms = new Date(expiresAt).getTime() - now;
	const expired = ms <= 0;
	const total = Math.max(0, Math.floor(ms / 1000));
	const mm = String(Math.floor(total / 60)).padStart(2, "0");
	const ss = String(total % 60).padStart(2, "0");
	return (
		<span
			className={`flex items-center gap-1 font-mono text-xs ${
				expired ? "text-red-600" : "text-[var(--foreground)]"
			}`}
		>
			{expired && <Volume2 size={12} />}
			{expired ? "Time!" : `${mm}:${ss}`}
		</span>
	);
}

function TeamNames({ label, names }: { label: string; names: string[] }) {
	return (
		<span className="text-[var(--foreground)]">
			{names.length ? names.join(" & ") : `Side ${label}`}
		</span>
	);
}

function ScoreEntry({
	bestOf,
	pending,
	onSubmit,
	onCancel,
}: {
	bestOf: number;
	pending: boolean;
	onSubmit: (games: { a: number; b: number }[]) => void;
	onCancel: () => void;
}) {
	const [rows, setRows] = useState<{ a: string; b: string }[]>(
		Array.from({ length: bestOf }, () => ({ a: "", b: "" })),
	);
	const submit = () => {
		const games = rows
			.filter((r) => r.a !== "" && r.b !== "")
			.map((r) => ({ a: Number(r.a), b: Number(r.b) }));
		if (games.length === 0) return;
		onSubmit(games);
	};
	return (
		<div className="space-y-2 rounded-md bg-[var(--muted)] p-2">
			{rows.map((r, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length score rows
				<div key={i} className="flex items-center gap-2">
					<span className="text-[var(--muted-foreground)] text-xs">
						G{i + 1}
					</span>
					<input
						type="number"
						min={0}
						value={r.a}
						onChange={(e) =>
							setRows((prev) =>
								prev.map((p, j) => (j === i ? { ...p, a: e.target.value } : p)),
							)
						}
						className="h-8 w-14 rounded border border-input bg-transparent px-2 text-sm"
					/>
					<span className="text-[var(--muted-foreground)] text-xs">–</span>
					<input
						type="number"
						min={0}
						value={r.b}
						onChange={(e) =>
							setRows((prev) =>
								prev.map((p, j) => (j === i ? { ...p, b: e.target.value } : p)),
							)
						}
						className="h-8 w-14 rounded border border-input bg-transparent px-2 text-sm"
					/>
				</div>
			))}
			<div className="flex gap-2">
				<Button size="sm" disabled={pending} onClick={submit}>
					{pending ? "Submitting…" : "Submit"}
				</Button>
				<Button variant="outline" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}
