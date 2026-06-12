"use client";

import {
	LogOut,
	Trophy,
	Unlock,
	UserPlus,
	Users,
	Volume2,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useDebouncedValue } from "~/app/_components/hooks/use-debounced-value";
import { Button } from "~/app/_components/shared/Button";
import { MemberSearchCombobox } from "~/app/_components/shared/MemberSearchCombobox";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

/**
 * Self-contained presentational/leaf components for the drop-in board
 * (DropInEventDetails). Each takes props only — no coupling to the board's
 * session state — so they live here to keep the board component focused.
 */

export function Leaderboard({
	rows,
}: {
	rows: {
		userId: string;
		firstName: string | null;
		lastName: string | null;
		wins: number;
		losses: number;
		pointDiff: number;
	}[];
}) {
	if (rows.length === 0) return null;
	return (
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
					{rows.map((s) => (
						<tr key={s.userId}>
							<td className="text-[var(--foreground)]">
								{`${s.firstName ?? ""} ${s.lastName ?? ""}`.trim() || "Player"}
							</td>
							<td className="text-right">{s.wins}</td>
							<td className="text-right">{s.losses}</td>
							<td className="text-right">{s.pointDiff}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** Format reported per-game scores ("21–18 · 18–21 · 21–15") from the JSON column. */
export function formatGames(gameScores: unknown): string {
	if (!Array.isArray(gameScores)) return "—";
	return (gameScores as { a: number; b: number }[])
		.map((g) => `${g.a}–${g.b}`)
		.join("  ·  ");
}

export function Countdown({
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
export function SwapPlayer({
	name,
	canSwap,
	sessionId,
	onPick,
}: {
	name: string;
	canSwap: boolean;
	sessionId: string;
	onPick: (inUserId: string) => void;
}) {
	if (!canSwap) return <span className="text-[var(--foreground)]">{name}</span>;
	return (
		<MemberSearchPopover sessionId={sessionId} onPick={onPick}>
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

/** Single-select club member typeahead in a popover. Thin wrapper over the
 * shared MemberSearchCombobox, bound to the member-facing
 * `dropIn.searchPartyMembers` API (club-wide; the target's check-in is
 * created on add). Used by player flows (YourPartyCard) and staff flows
 * (SwapPlayer). */
export function MemberSearchPopover({
	children,
	sessionId,
	onPick,
}: {
	children: ReactNode;
	sessionId: string;
	onPick: (userId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const debounced = useDebouncedValue(query.trim(), 300);
	const search = api.dropIn.searchPartyMembers.useQuery(
		{ sessionId, query: debounced },
		{ enabled: open && debounced.length > 0 },
	);
	return (
		<MemberSearchCombobox
			trigger={children}
			open={open}
			onOpenChange={setOpen}
			query={query}
			onQueryChange={setQuery}
			results={search.data}
			isFetching={search.isFetching}
			mode="single"
			onPick={(m) => onPick(m.userId)}
		/>
	);
}

export function ScoreEntry({
	bestOf,
	pending,
	onSubmit,
	onCancel,
	initial,
}: {
	bestOf: number;
	pending: boolean;
	onSubmit: (games: { a: number; b: number }[]) => void;
	onCancel: () => void;
	initial?: { a: number; b: number }[];
}) {
	const [rows, setRows] = useState<{ a: string; b: string }[]>(() => {
		const count = Math.max(bestOf, initial?.length ?? 0);
		return Array.from({ length: count }, (_, i) =>
			initial?.[i]
				? { a: String(initial[i].a), b: String(initial[i].b) }
				: { a: "", b: "" },
		);
	});
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
export function StaffAddToQueue({
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
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const debounced = useDebouncedValue(query.trim(), 300);

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
		<MemberSearchCombobox
			trigger={
				<Button variant="outline" size="sm">
					<UserPlus size={14} /> Add to queue
				</Button>
			}
			open={open}
			onOpenChange={setOpen}
			query={query}
			onQueryChange={setQuery}
			results={search.data?.members}
			isFetching={search.isFetching}
			mode="multi"
			selected={selected}
			onToggle={(m) => toggle(m.userId)}
			footer={
				<>
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
				</>
			}
		/>
	);
}

/**
 * Player-facing "Join queue as a group" popover. Lets the caller create a party with
 * themselves + up to (capacity - 1) other members in one shot, plus an
 * `openToFill` toggle (default OFF — they brought their own people).
 *
 * Wire-up: opens a popover from a trigger button; on Submit it sequences
 *   1) createParty({ sessionId, openToFill })   — returns the caller's party
 *   2) setPartyOpenToFill({ partyId, openToFill })  — covers the case where
 *      the caller already had a solo openToFill=true party (joinQueue default);
 *      we always want their explicit choice to win.
 *   3) addPartyMember({ partyId, targetUserId }) for each selected member.
 *
 * On any step failure, we toast the error; whatever succeeded stays in place
 * (the user can complete the rest manually or try again).
 */
export function JoinPartyPopover({
	sessionId,
	capacity,
	disabled,
	onDone,
}: {
	sessionId: string;
	/** Court capacity for this session (2 for SINGLES, 4 otherwise). Passed in
	 *  rather than re-derived per-component so SINGLES/DOUBLES rules live in
	 *  one place (server's `capacityForFormat`). */
	capacity: number;
	disabled?: boolean;
	onDone: () => void;
}) {
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [openToFill, setOpenToFill] = useState(false);
	const debounced = useDebouncedValue(query.trim(), 300);

	// Player-facing search (club-wide).
	const search = api.dropIn.searchPartyMembers.useQuery(
		{ sessionId, query: debounced },
		{ enabled: open && debounced.length > 0 },
	);
	const createParty = api.dropIn.createParty.useMutation();
	const setOpenToFillM = api.dropIn.setPartyOpenToFill.useMutation();
	const addPartyMember = api.dropIn.addPartyMember.useMutation();

	const maxAddable = capacity - 1; // caller counts as 1 of the party
	const ids = [...selected];
	const submitting =
		createParty.isPending ||
		setOpenToFillM.isPending ||
		addPartyMember.isPending;

	const toggle = (userId: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) {
				next.delete(userId);
			} else if (next.size < maxAddable) {
				next.add(userId);
			} else {
				toast(
					`Party can hold at most ${capacity} (you + ${maxAddable} others).`,
					"info",
				);
			}
			return next;
		});

	const reset = () => {
		setSelected(new Set());
		setQuery("");
		setOpenToFill(false);
	};

	const submit = async () => {
		if (ids.length === 0) return;
		try {
			const { partyId } = await createParty.mutateAsync({
				sessionId,
				openToFill,
			});
			// Re-assert openToFill — handles the case where the user already
			// had a solo openToFill=true party (joinQueue default) and now
			// wants to lock the group closed.
			await setOpenToFillM.mutateAsync({ partyId, openToFill });
			// Sequential adds — each respects B2 snap + capacity validation
			// server-side. Partial success leaves the party with whoever
			// landed; user can re-open and add more.
			for (const targetUserId of ids) {
				await addPartyMember.mutateAsync({ partyId, targetUserId });
			}
			toast(
				`Party created with ${ids.length + 1} player${
					ids.length === 0 ? "" : "s"
				}.`,
				"success",
			);
			reset();
			setOpen(false);
			onDone();
		} catch (e) {
			toast(
				e instanceof Error ? e.message : "Failed to create party.",
				"error",
			);
		}
	};

	return (
		<MemberSearchCombobox
			trigger={
				<Button variant="outline" size="sm" disabled={disabled}>
					<UserPlus size={14} /> Join queue as a group
				</Button>
			}
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) reset();
			}}
			query={query}
			onQueryChange={setQuery}
			results={search.data}
			isFetching={search.isFetching}
			emptyHint={`You + up to ${maxAddable} other player${
				maxAddable === 1 ? "" : "s"
			} — type a name to add.`}
			mode="multi"
			selected={selected}
			onToggle={(m) => toggle(m.userId)}
			footer={
				<>
					<label className="mt-2 flex items-center gap-2 text-[var(--foreground)] text-xs">
						<input
							type="checkbox"
							checked={openToFill}
							onChange={(e) => setOpenToFill(e.target.checked)}
							disabled={submitting}
						/>
						<span>
							Open to filling remaining seats with others (e.g. when 3 of 4)
						</span>
					</label>
					<Button
						size="sm"
						className="mt-2 w-full"
						disabled={ids.length === 0 || submitting}
						onClick={submit}
					>
						{submitting
							? "Creating…"
							: ids.length > 0
								? `Create party (you + ${ids.length})`
								: "Pick at least one"}
					</Button>
				</>
			}
		/>
	);
}

/**
 * "Your party" card — shown when the viewer is in a non-trivial party (size > 1
 * or a closed solo waiting for friends). Lets any member add another player,
 * toggle openToFill, or leave the party.
 *
 * The card is intentionally NOT shown for the trivial case (solo +
 * openToFill=true) because that's just "I joined queue alone" — the existing
 * pool row already conveys that. The card only adds value once the user has
 * party intent.
 */
export function YourPartyCard({
	party,
	sessionId,
	viewerUserId,
	onChange,
	courtName,
}: {
	sessionId: string;
	/** Resolve a courtId → display title, for the court-lock label. */
	courtName?: (id: string) => string;
	party: {
		capacity: number;
		partyId: string;
		openToFill: boolean;
		preferredCourtId: string | null;
		memberCount: number;
		derivedState: "WAITING" | "PLAYING" | "AWAITING_RESULT";
		members: Array<{
			userId: string;
			firstName: string | null;
			lastName: string | null;
			status:
				| "WAITING"
				| "IDLE"
				| "PLAYING"
				| "AWAITING_RESULT"
				| "DONE"
				| "LEFT"
				| "CANCELLED";
		}>;
	};
	viewerUserId: string;
	onChange: () => void;
}) {
	const { toast } = useToast();
	const atCapacity = party.memberCount >= party.capacity;

	const addPartyMember = api.dropIn.addPartyMember.useMutation({
		onSuccess: onChange,
		onError: (e) => toast(e.message, "error"),
	});
	const setOpenToFill = api.dropIn.setPartyOpenToFill.useMutation({
		onSuccess: onChange,
		onError: (e) => toast(e.message, "error"),
	});
	const leaveParty = api.dropIn.leaveParty.useMutation({
		onSuccess: onChange,
		onError: (e) => toast(e.message, "error"),
	});

	const stateLabel =
		party.derivedState === "PLAYING"
			? "On court"
			: party.derivedState === "AWAITING_RESULT"
				? "Awaiting result"
				: party.openToFill
					? `Open to fill (${party.memberCount}/${party.capacity})`
					: `Closed group (${party.memberCount}/${party.capacity})`;

	return (
		<div className="rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-3">
			<div className="mb-2 flex items-center justify-between">
				<span className="font-medium text-[var(--foreground)] text-sm">
					Your party
				</span>
				<span className="text-[11px] text-[var(--muted-foreground)]">
					{stateLabel}
					{party.preferredCourtId &&
						` · ${courtName?.(party.preferredCourtId) ?? "Court"} only`}
				</span>
			</div>
			<ul className="mb-2 flex flex-wrap gap-1.5">
				{party.members.map((m) => {
					const name =
						`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member";
					const isSelf = m.userId === viewerUserId;
					return (
						<li
							key={m.userId}
							className={`rounded-full border px-2 py-0.5 text-xs ${
								isSelf
									? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
									: "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
							}`}
						>
							{name}
							{isSelf && " (you)"}
							{m.status === "PLAYING" && (
								<span className="ml-1 text-[var(--muted-foreground)]">
									· on court
								</span>
							)}
							{m.status === "IDLE" && (
								<span className="ml-1 text-[var(--muted-foreground)]">
									· idle
								</span>
							)}
						</li>
					);
				})}
			</ul>
			<div className="flex flex-wrap gap-2">
				<MemberSearchPopover
					sessionId={sessionId}
					onPick={(targetUserId) =>
						addPartyMember.mutate({ partyId: party.partyId, targetUserId })
					}
				>
					<Button variant="outline" size="sm" disabled={atCapacity}>
						<UserPlus size={14} /> {atCapacity ? "Party full" : "Add member"}
					</Button>
				</MemberSearchPopover>
				<Button
					variant="outline"
					size="sm"
					disabled={setOpenToFill.isPending}
					onClick={() =>
						setOpenToFill.mutate({
							partyId: party.partyId,
							openToFill: !party.openToFill,
						})
					}
				>
					<Unlock size={14} />{" "}
					{party.openToFill ? "Lock party" : "Open to fill"}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={leaveParty.isPending}
					onClick={() => leaveParty.mutate({ partyId: party.partyId })}
				>
					<LogOut size={14} /> Leave party
				</Button>
			</div>
		</div>
	);
}

// =============================================================================
// QueueByParty — grouped waitlist rendering. One row per party with ≥1 WAITING
// member. Replaces the old per-checkin flat list. Position numbers are
// per-party in FIFO order (matches what pickNextOccupants will select against).
//
// Visual rules:
//  - Solo + openToFill=true                → flat row (just name, no border)
//  - Solo + openToFill=false               → bordered row, "Waiting for friends"
//  - Multi-member, complete                → bordered row, "Group of N"
//  - Multi-member, needs more (closed)     → bordered row, "Needs N more — closed group"
//  - Multi-member, needs more (open)       → bordered row, "Needs N more — open to anyone"
//                                            + "Join this group" button for outsiders
//  - Any party w/ PLAYING/AWAITING_RESULT
//    member (A1-blocked, mixed state)      → ghost pills for non-WAITING members
//                                            + "Will play when …" label
// =============================================================================

export type QueueByPartyEntry = {
	partyId: string;
	openToFill: boolean;
	queuedAt: string | Date;
	/** Hard court lock (court-preference feature); null = any court. */
	preferredCourtId: string | null;
	memberCount: number;
	capacity: number;
	needsCount: number;
	derivedState: "WAITING" | "PLAYING" | "AWAITING_RESULT";
	members: Array<{
		userId: string;
		firstName: string | null;
		lastName: string | null;
		status:
			| "WAITING"
			| "IDLE"
			| "PLAYING"
			| "AWAITING_RESULT"
			| "DONE"
			| "LEFT"
			| "CANCELLED";
	}>;
};

type CheckInForQueue = {
	checkInId: string;
	userId: string;
};

const PILL_STATUS_LABEL: Record<string, string> = {
	IDLE: "idle",
	PLAYING: "on court",
	AWAITING_RESULT: "score pending",
	DONE: "done",
};

export function memberDisplayName(m: {
	firstName: string | null;
	lastName: string | null;
}): string {
	return `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Player";
}

export function QueueByParty({
	parties,
	pool,
	viewerUserId,
	viewerPartyId,
	isStaff,
	onChange,
	courtName,
}: {
	parties: QueueByPartyEntry[];
	/** Flat WAITING check-ins — used only to map userId → checkInId for the
	 *  staff X-out button. (The grouping logic itself iterates `parties[]`.) */
	pool: CheckInForQueue[];
	viewerUserId: string;
	viewerPartyId: string | null;
	isStaff: boolean;
	onChange: () => void;
	/** Resolve a courtId → display title, for the "Court N only" chip. */
	courtName?: (id: string) => string;
}) {
	const { toast } = useToast();
	const setCheckInStatus = api.dropIn.setCheckInStatus.useMutation({
		onSuccess: onChange,
		onError: (e) => toast(e.message, "error"),
	});
	const joinExistingParty = api.dropIn.joinExistingParty.useMutation({
		onSuccess: onChange,
		onError: (e) => toast(e.message, "error"),
	});
	// Staff party management — remove a no-show from a group, or disband a
	// group that's blocking rotation. Server allows club staff on any party.
	const removePartyMember = api.dropIn.removePartyMember.useMutation({
		onSuccess: onChange,
		onError: (e) => toast(e.message, "error"),
	});
	const disbandParty = api.dropIn.disbandParty.useMutation({
		onSuccess: onChange,
		onError: (e) => toast(e.message, "error"),
	});

	const checkInByUserId = new Map(pool.map((c) => [c.userId, c.checkInId]));

	// Parties to show in the waitlist: anyone with at least one WAITING member.
	// All-IDLE parties (checked in but not queued) and DEFUNCT parties are
	// implicitly filtered (DEFUNCT was already filtered server-side).
	const queueRows = parties
		.map((p) => ({
			party: p,
			waitingMembers: p.members.filter((m) => m.status === "WAITING"),
			nonWaitingLiveMembers: p.members.filter(
				(m) =>
					m.status !== "WAITING" &&
					m.status !== "LEFT" &&
					m.status !== "CANCELLED",
			),
		}))
		.filter((r) => r.waitingMembers.length > 0);

	if (queueRows.length === 0) {
		return (
			<p className="text-[var(--muted-foreground)] text-sm">No one waiting.</p>
		);
	}

	return (
		<ol className="space-y-1.5">
			{queueRows.map((row, i) => {
				const { party } = row;
				const isSolo = party.memberCount === 1;
				const isViewerInParty = party.partyId === viewerPartyId;
				const isOpenIncomplete =
					party.openToFill && party.needsCount > 0 && party.memberCount > 1;
				const isClosedIncomplete = !party.openToFill && party.needsCount > 0;
				const hasNonReadyMember =
					party.derivedState === "PLAYING" ||
					party.derivedState === "AWAITING_RESULT";

				const showJoinButton =
					isOpenIncomplete && !isViewerInParty && !!viewerUserId;

				// A trivial solo (openToFill=true, party of 1) is rendered as a
				// flat row — no border, no group framing. Anything else gets the
				// party card treatment so the user sees the structure. A
				// court-locked solo is NOT trivial: we want the bordered row so the
				// "Court N only" chip is visible.
				const isTrivialSolo =
					isSolo && party.openToFill && !party.preferredCourtId;

				return (
					<li
						key={party.partyId}
						className={`flex items-start gap-2 text-sm ${
							isTrivialSolo
								? ""
								: "rounded border border-[var(--border)] bg-[var(--muted)]/30 p-2"
						} ${
							isViewerInParty
								? "border-[var(--primary)]/60 bg-[var(--primary)]/5"
								: ""
						}`}
					>
						<span className="pt-0.5 text-[var(--muted-foreground)] text-xs">
							{i + 1}.
						</span>
						<div className="flex-1">
							{/* Header line — only for non-trivial parties */}
							{!isTrivialSolo && (
								<div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
									<span className="inline-flex items-center gap-1 font-medium text-[var(--foreground)]">
										<Users size={12} />
										{isSolo ? "Solo" : `Group of ${party.memberCount}`}
									</span>
									{isClosedIncomplete && (
										<span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
											Needs {party.needsCount} more — closed group
										</span>
									)}
									{isOpenIncomplete && (
										<span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
											Needs {party.needsCount} more — open to anyone
										</span>
									)}
									{hasNonReadyMember && (
										<span className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
											Will play when{" "}
											{row.nonWaitingLiveMembers
												.map((m) => memberDisplayName(m))
												.join(", ")}
											{row.nonWaitingLiveMembers.length === 1
												? " finishes"
												: " finish"}
										</span>
									)}
									{party.preferredCourtId && (
										<span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200">
											{courtName?.(party.preferredCourtId) ?? "Court"} only
										</span>
									)}
									<span className="ml-auto flex items-center gap-1">
										{showJoinButton && (
											<button
												type="button"
												onClick={() =>
													joinExistingParty.mutate({
														partyId: party.partyId,
													})
												}
												disabled={joinExistingParty.isPending}
												className="rounded-full bg-[var(--primary)] px-2 py-0.5 font-medium text-[10px] text-white hover:opacity-90 disabled:opacity-50"
											>
												Join this group
											</button>
										)}
										{isStaff && (
											<button
												type="button"
												title="Disband this group (everyone leaves the queue)"
												onClick={() =>
													disbandParty.mutate({ partyId: party.partyId })
												}
												disabled={disbandParty.isPending}
												className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)] hover:border-red-400 hover:text-red-600 disabled:opacity-50"
											>
												Disband
											</button>
										)}
									</span>
								</div>
							)}

							{/* Member pills (or flat name for trivial solo) */}
							{isTrivialSolo ? (
								<div className="flex items-center gap-2">
									{row.waitingMembers.map((m) => (
										<span
											key={m.userId}
											className={
												m.userId === viewerUserId
													? "font-medium text-[var(--primary)]"
													: "text-[var(--foreground)]"
											}
										>
											{memberDisplayName(m)}
											{isStaff && (
												<button
													type="button"
													title="Take out of the queue (stays checked in)"
													onClick={() => {
														const checkInId = checkInByUserId.get(m.userId);
														if (!checkInId) return;
														setCheckInStatus.mutate({
															checkInId,
															status: "IDLE",
														});
													}}
													className="ml-1 text-[var(--muted-foreground)] hover:text-red-600"
												>
													<X size={12} />
												</button>
											)}
										</span>
									))}
								</div>
							) : (
								<div className="flex flex-wrap items-center gap-1.5">
									{row.waitingMembers.map((m) => (
										<span
											key={m.userId}
											className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
												m.userId === viewerUserId
													? "border-[var(--primary)] bg-[var(--primary)]/10 font-medium text-[var(--primary)]"
													: "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
											}`}
										>
											{memberDisplayName(m)}
											{isStaff && (
												<button
													type="button"
													title="Remove from this group (leaves the queue)"
													onClick={() =>
														removePartyMember.mutate({
															partyId: party.partyId,
															targetUserId: m.userId,
														})
													}
													disabled={removePartyMember.isPending}
													className="text-[var(--muted-foreground)] hover:text-red-600 disabled:opacity-50"
												>
													<X size={12} />
												</button>
											)}
										</span>
									))}
									{/* Ghost pills for non-WAITING members so the user
									    can see "this party has 2 waiting, 2 on courts". */}
									{row.nonWaitingLiveMembers.map((m) => (
										<span
											key={m.userId}
											className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] border-dashed bg-[var(--muted)]/40 px-2 py-0.5 text-[var(--muted-foreground)] text-xs"
											title={`Status: ${m.status}`}
										>
											{memberDisplayName(m)}
											<span className="text-[10px]">
												{PILL_STATUS_LABEL[m.status] ?? m.status.toLowerCase()}
											</span>
										</span>
									))}
								</div>
							)}
						</div>
					</li>
				);
			})}
		</ol>
	);
}
