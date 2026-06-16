"use client";

import { ChevronsUpDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useDebouncedValue } from "~/app/_components/hooks/use-debounced-value";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "~/app/_components/shared/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import { api } from "~/trpc/react";

type BillToUser = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
};

function formatUserName(u: {
	firstName: string | null;
	lastName: string | null;
}): string {
	const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
	return name || "(no name)";
}

interface BillToUserPickerProps {
	/**
	 * The consumer's user ID — when selected, the picker shows "Self-pay" instead.
	 * The consumer is filtered from the dropdown results.
	 */
	consumerId: string;
	/** Current selected user (null = self-pay). */
	value: BillToUser | null;
	/** Called when user selects a person or clears. */
	onChange: (user: BillToUser | null) => void;
	/** When true, disables the entire picker. */
	disabled?: boolean;
	/** Label text (e.g., "Bill to", "Charge parent"). Default: "Bill to". */
	label?: string;
	/** Help text below the picker. */
	helperText?: string;
	/** Optional CSS class for the container. */
	className?: string;
	/**
	 * Called when the "typed but not selected" state changes. True means the
	 * staff member typed a search query but hasn't picked anyone — parents
	 * should disable submit until this is false (forces an explicit choice
	 * between a person and self-pay rather than silently defaulting).
	 */
	onTypedButUnselectedChange?: (typedButUnselected: boolean) => void;
}

export default function BillToUserPicker({
	consumerId,
	value,
	onChange,
	disabled = false,
	label = "Bill to",
	helperText = "Leave blank to charge the member directly (self-pay). Or pick a parent/payer.",
	className = "",
	onTypedButUnselectedChange,
}: BillToUserPickerProps) {
	const pickerId = useId();
	const [query, setQuery] = useState<string>("");
	const debouncedQuery = useDebouncedValue(query, 200);
	const [showDropdown, setShowDropdown] = useState<boolean>(false);
	const wrapperRef = useRef<HTMLDivElement>(null);

	// Close dropdown on outside click
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(e.target as Node)
			) {
				setShowDropdown(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const trimmedQuery = query.trim();
	const trimmedDebouncedQuery = debouncedQuery.trim();

	// Gate the server query on the debounced value; 4-char minimum to avoid
	// firing on every keystroke.
	const searchEnabled = value === null && trimmedDebouncedQuery.length >= 4;

	const billToSearch = api.user.searchMembers.useQuery(
		{ query: trimmedDebouncedQuery },
		{ enabled: searchEnabled },
	);

	const billToResults = (billToSearch.data?.members ?? []).filter(
		(r) => r.userId !== consumerId,
	);

	// True when the user has typed something but hasn't picked from the dropdown.
	const typedButUnselected = trimmedQuery.length > 0 && value === null;

	// Surface the typed-but-unselected state to parents so they can block submit.
	useEffect(() => {
		onTypedButUnselectedChange?.(typedButUnselected);
	}, [typedButUnselected, onTypedButUnselectedChange]);

	const selectedLabel = value
		? `${formatUserName(value)} (${value.email || "no email"})`
		: "Self-pay";

	return (
		<div ref={wrapperRef} className={className}>
			<label
				htmlFor={pickerId}
				className="font-medium text-[var(--foreground)] text-sm"
			>
				{label}
			</label>
			<Popover open={showDropdown} onOpenChange={setShowDropdown}>
				<PopoverTrigger asChild>
					<button
						id={pickerId}
						type="button"
						disabled={disabled}
						className="mt-1 flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
					>
						<span
							className={
								value
									? "truncate text-[var(--foreground)]"
									: "truncate text-[var(--muted-foreground)]"
							}
						>
							{selectedLabel}
						</span>
						<ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
					</button>
				</PopoverTrigger>
				<PopoverContent
					className="w-[--radix-popover-trigger-width] p-0"
					align="start"
				>
					<Command>
						<CommandInput
							placeholder="Search by name or email…"
							value={query}
							onValueChange={setQuery}
							maxLength={100}
						/>
						<CommandList>
							<CommandEmpty>No people found.</CommandEmpty>
							{billToSearch.isError && (
								<div className="px-3 py-2 text-red-700 text-xs">
									Couldn't load people — try again.
								</div>
							)}
							<CommandGroup>
								<CommandItem
									value="self-pay"
									onSelect={() => {
										onChange(null);
										setQuery("");
										setShowDropdown(false);
									}}
								>
									Self-pay (charge the member directly)
								</CommandItem>
								{billToResults.map((person) => (
									<CommandItem
										key={person.userId}
										value={`${person.firstName || ""} ${person.lastName || ""} ${person.email || ""}`}
										onSelect={() => {
											onChange(person);
											setQuery("");
											setShowDropdown(false);
										}}
									>
										<div className="flex flex-col">
											<span>{formatUserName(person)}</span>
											<span className="text-[var(--muted-foreground)] text-xs">
												{person.email}
											</span>
										</div>
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{typedButUnselected && (
				<p className="mt-1 text-red-600 text-xs">
					Pick someone from the dropdown or clear to use self-pay.
				</p>
			)}
			<p className="mt-1 text-[var(--muted-foreground)] text-xs">
				{helperText}
			</p>
		</div>
	);
}
