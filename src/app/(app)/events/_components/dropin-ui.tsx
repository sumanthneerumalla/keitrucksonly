"use client";

import { Check, LogOut, Trophy, Unlock, UserPlus, Volume2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
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
export function MemberSearchPopover({
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
	format,
	disabled,
	onDone,
}: {
	sessionId: string;
	format: "SINGLES" | "DOUBLES" | "MIXED_DOUBLES" | null;
	disabled?: boolean;
	onDone: () => void;
}) {
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [openToFill, setOpenToFill] = useState(false);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(query.trim()), 300);
		return () => clearTimeout(t);
	}, [query]);

	const search = api.user.searchMembers.useQuery(
		{ query: debounced },
		{ enabled: open && debounced.length > 0 },
	);
	const createParty = api.dropIn.createParty.useMutation();
	const setOpenToFillM = api.dropIn.setPartyOpenToFill.useMutation();
	const addPartyMember = api.dropIn.addPartyMember.useMutation();

	const capacity = format === "SINGLES" ? 2 : 4;
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
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm" disabled={disabled}>
					<UserPlus size={14} /> Join queue as a group
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-2" align="end">
				<p className="px-1 pb-1 text-[var(--muted-foreground)] text-xs">
					You + up to {maxAddable} other player
					{maxAddable === 1 ? "" : "s"} — queues together.
				</p>
				<Input
					placeholder="Search members…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="h-8"
				/>
				<div className="mt-2 max-h-44 space-y-0.5 overflow-auto">
					{debounced.length === 0 && (
						<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
							Type a name to add.
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
								{isSel && (
									<Check size={14} className="text-[var(--primary)]" />
								)}
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
				<label className="mt-2 flex items-center gap-2 text-xs text-[var(--foreground)]">
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
			</PopoverContent>
		</Popover>
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
	viewerUserId,
	format,
	onChange,
}: {
	party: {
		partyId: string;
		openToFill: boolean;
		memberCount: number;
		hasGuest: boolean;
		isReady: boolean;
		derivedState: "WAITING" | "PLAYING" | "AWAITING_RESULT";
		members: Array<{
			userId: string;
			firstName: string | null;
			lastName: string | null;
			isGuest: boolean;
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
	format: "SINGLES" | "DOUBLES" | "MIXED_DOUBLES" | null;
	onChange: () => void;
}) {
	const { toast } = useToast();
	const capacity = format === "SINGLES" ? 2 : 4;
	const atCapacity = party.memberCount >= capacity;

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
					? `Open to fill (${party.memberCount}/${capacity})`
					: `Closed group (${party.memberCount}/${capacity})`;

	return (
		<div className="rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-3">
			<div className="mb-2 flex items-center justify-between">
				<span className="font-medium text-[var(--foreground)] text-sm">
					Your party
				</span>
				<span className="text-[11px] text-[var(--muted-foreground)]">
					{stateLabel}
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
							{m.isGuest && (
								<span className="ml-1 text-[var(--muted-foreground)]">
									· guest
								</span>
							)}
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
					onPick={(targetUserId) =>
						addPartyMember.mutate({ partyId: party.partyId, targetUserId })
					}
				>
					<Button variant="outline" size="sm" disabled={atCapacity}>
						<UserPlus size={14} />{" "}
						{atCapacity ? "Party full" : "Add member"}
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
