"use client";

import { Check, Trophy, UserPlus, Volume2 } from "lucide-react";
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
