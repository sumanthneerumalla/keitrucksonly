"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "~/app/_components/shared/Input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";

/** Minimal member shape every search API in the app can satisfy. */
export type SearchedMember = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
};

export function searchedMemberName(m: {
	firstName: string | null;
	lastName: string | null;
}): string {
	return `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member";
}

type SelectionProps =
	| {
			mode: "single";
			/** Called with the picked member; the popover closes and the query resets. */
			onPick: (member: SearchedMember) => void;
	  }
	| {
			mode: "multi";
			selected: ReadonlySet<string>;
			/** Toggle a member in/out of the selection (caller enforces any cap). */
			onToggle: (member: SearchedMember) => void;
	  };

/**
 * The app-standard member-search popover: trigger → input → debounced results
 * list, single- or multi-select. PRESENTATIONAL by design — the caller owns
 * the query state and the tRPC search (APIs differ per surface:
 * `user.searchMembers` is staff/club-wide, `dropIn.searchPartyMembers` is the
 * member-facing one), and passes results down. Pair with `useDebouncedValue`.
 *
 * Replaces the per-surface hand-rolled popover+debounce+list copies that had
 * drifted apart (drop-in's three were the worst offenders).
 */
export function MemberSearchCombobox({
	trigger,
	open,
	onOpenChange,
	query,
	onQueryChange,
	results,
	isFetching,
	placeholder = "Search members…",
	emptyHint = "Type a name to search.",
	itemExtra,
	footer,
	...selection
}: {
	trigger: ReactNode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	query: string;
	onQueryChange: (q: string) => void;
	/** Already-debounced, already-shaped results (undefined while idle). */
	results: SearchedMember[] | undefined;
	isFetching?: boolean;
	placeholder?: string;
	emptyHint?: string;
	/** Optional extra content rendered after a result's name (status, email…). */
	itemExtra?: (member: SearchedMember) => ReactNode;
	/** Optional content below the list (submit buttons, toggles…). */
	footer?: ReactNode;
} & SelectionProps) {
	const showResults = query.trim().length > 0;
	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) onQueryChange("");
	};

	return (
		<Popover open={open} onOpenChange={close}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent className="w-64 p-2" align="start">
				<Input
					placeholder={placeholder}
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
					className="h-8"
				/>
				<div className="mt-2 max-h-48 space-y-0.5 overflow-auto">
					{!showResults && (
						<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
							{emptyHint}
						</p>
					)}
					{showResults && isFetching && (
						<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
							Searching…
						</p>
					)}
					{showResults &&
						results?.map((m) => {
							const isSel =
								selection.mode === "multi" && selection.selected.has(m.userId);
							return (
								<button
									key={m.userId}
									type="button"
									onClick={() => {
										if (selection.mode === "single") {
											selection.onPick(m);
											close(false);
										} else {
											selection.onToggle(m);
										}
									}}
									className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${
										isSel
											? "bg-[var(--primary)]/10 text-[var(--foreground)]"
											: "text-[var(--foreground)] hover:bg-[var(--muted)]"
									}`}
								>
									<span>
										{searchedMemberName(m)}
										{itemExtra?.(m)}
									</span>
									{isSel && (
										<Check size={14} className="text-[var(--primary)]" />
									)}
								</button>
							);
						})}
					{showResults && !isFetching && (results?.length ?? 0) === 0 && (
						<p className="px-2 py-1 text-[var(--muted-foreground)] text-xs">
							No matches.
						</p>
					)}
				</div>
				{footer}
			</PopoverContent>
		</Popover>
	);
}
