"use client";

import { Check, Maximize2, Trophy, UserPlus, Volume2 } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
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
	const swapParticipant = api.dropIn.swapParticipant.useMutation({
		onSuccess: refresh,
		onError: (e) => toast(e.message, "error"),
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

	// Staff can swap a player on a live game (e.g. seat a test account).
	type Assignment = (typeof assignments)[number];
	const canSwapPlayers = (status: string) =>
		isStaff && (status === "IN_PROGRESS" || status === "PENDING_CONFIRM");
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
				<SwapPlayer
					name={fullName(p.user)}
					canSwap={canSwapPlayers(a.status)}
					onPick={(inUserId) =>
						swapParticipant.mutate({
							assignmentId: a.assignmentId,
							outUserId: p.userId,
							inUserId,
						})
					}
				/>
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
													<SwapPlayer
														name={fullName(p.user)}
														canSwap={canSwapPlayers(a.status)}
														onPick={(inUserId) =>
															swapParticipant.mutate({
																assignmentId: a.assignmentId,
																outUserId: p.userId,
																inUserId,
															})
														}
													/>
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
						{isStaff && (
							<StaffAddToQueue
								sessionId={session.sessionId}
								format={session.format}
								onAdded={refresh}
							/>
						)}
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

/** A player's name. For staff (canSwap), it's a typeahead trigger to replace the
 *  player with another member; otherwise a plain label. */
function SwapPlayer({
	name,
	canSwap,
	onPick,
}: {
	name: string;
	canSwap: boolean;
	onPick: (inUserId: string) => void;
}) {
	if (!canSwap) return <span className="text-[var(--foreground)]">{name}</span>;
	return (
		<MemberSearchPopover onPick={onPick}>
			<button
				type="button"
				title="Swap player"
				className="rounded text-[var(--foreground)] underline decoration-dotted underline-offset-2 hover:text-[var(--primary)]"
			>
				{name}
			</button>
		</MemberSearchPopover>
	);
}

/** Single-select club member typeahead in a popover. */
function MemberSearchPopover({
	children,
	onPick,
}: {
	children: ReactNode;
	onPick: (userId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setDebounced(query.trim()), 300);
		return () => clearTimeout(t);
	}, [query]);
	const search = api.user.searchMembers.useQuery(
		{ query: debounced },
		{ enabled: open && debounced.length > 0 },
	);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent className="w-64 p-2" align="start">
				<Input
					placeholder="Search members…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="h-8"
				/>
				<div className="mt-2 max-h-48 space-y-0.5 overflow-auto">
					{debounced.length === 0 && (
						<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
							Type a name to search.
						</p>
					)}
					{search.data?.members.map((m) => {
						const name =
							`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() ||
							m.email ||
							"Member";
						return (
							<button
								key={m.userId}
								type="button"
								onClick={() => {
									onPick(m.userId);
									setOpen(false);
									setQuery("");
								}}
								className="block w-full rounded px-2 py-1 text-left text-[var(--foreground)] text-sm hover:bg-[var(--muted)]"
							>
								{name}
							</button>
						);
					})}
					{debounced.length > 0 && (search.data?.members.length ?? 0) === 0 && (
						<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
							No matches.
						</p>
					)}
				</div>
			</PopoverContent>
		</Popover>
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

/**
 * Staff (facility+) control to add member(s) to the waiting pool. Multi-select so
 * staff can drop in a pair/group at once (they queue together → doubles pairs them
 * by queue order). Reuses the club member search (`user.searchMembers`).
 */
function StaffAddToQueue({
	sessionId,
	format,
	onAdded,
}: {
	sessionId: string;
	format: string | null;
	onAdded: () => void;
}) {
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());

	useEffect(() => {
		const t = setTimeout(() => setDebounced(query.trim()), 300);
		return () => clearTimeout(t);
	}, [query]);

	const search = api.user.searchMembers.useQuery(
		{ query: debounced },
		{ enabled: open && debounced.length > 0 },
	);
	const addToQueue = api.dropIn.addToQueue.useMutation({
		onSuccess: (res) => {
			toast(`Added ${res.added} to the queue.`, "success");
			setSelected(new Set());
			setQuery("");
			setOpen(false);
			onAdded();
		},
		onError: (e) => toast(e.message, "error"),
	});

	const toggle = (userId: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return next;
		});

	const ids = [...selected];

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm">
					<UserPlus size={14} /> Add to queue
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-2" align="end">
				<Input
					placeholder="Search members…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="h-8"
				/>
				<div className="mt-2 max-h-48 space-y-0.5 overflow-auto">
					{debounced.length === 0 && (
						<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
							Type a name to search.
						</p>
					)}
					{debounced.length > 0 && search.isFetching && (
						<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
							Searching…
						</p>
					)}
					{search.data?.members.map((m) => {
						const name =
							`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() ||
							m.email ||
							"Member";
						const isSel = selected.has(m.userId);
						return (
							<button
								key={m.userId}
								type="button"
								onClick={() => toggle(m.userId)}
								className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${
									isSel
										? "bg-[var(--primary)]/10 text-[var(--foreground)]"
										: "text-[var(--foreground)] hover:bg-[var(--muted)]"
								}`}
							>
								<span>{name}</span>
								{isSel && <Check size={14} className="text-[var(--primary)]" />}
							</button>
						);
					})}
					{debounced.length > 0 &&
						!search.isFetching &&
						(search.data?.members.length ?? 0) === 0 && (
							<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
								No matches.
							</p>
						)}
				</div>
				<Button
					size="sm"
					className="mt-2 w-full"
					disabled={ids.length === 0 || addToQueue.isPending}
					onClick={() => addToQueue.mutate({ sessionId, userIds: ids })}
				>
					{addToQueue.isPending
						? "Adding…"
						: ids.length > 0
							? `Add ${ids.length} to queue`
							: "Add to queue"}
				</Button>
				<p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
					{format === "SINGLES"
						? "Add players individually."
						: "Pick 2 (or 4) — they queue together for doubles pairing."}
				</p>
			</PopoverContent>
		</Popover>
	);
}
