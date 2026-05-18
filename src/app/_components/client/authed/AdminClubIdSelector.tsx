"use client";

import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { ErrorBanner } from "~/app/_components/shared/ErrorBanner";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

type ClubOption = {
	clubShortName: string;
	clubName: string;
};

// Default (admin) mode: caller owns selection state via selectedClubShortName + onSelect.
// Switch mode: component owns the active-club state via user.switchClub; caller provides onSwitch callback.
type AdminClubIdSelectorProps =
	| {
			mode?: "admin";
			selectedClubShortName: string;
			selectedClubName: string;
			onSelect: (club: ClubOption) => void;
			onSwitch?: never;
			className?: string;
	  }
	| {
			mode: "switch";
			selectedClubShortName?: never;
			selectedClubName?: never;
			onSelect?: never;
			/** Called after a successful club switch so the parent can refetch / refresh. */
			onSwitch?: () => void;
			/** "all" fetches every club (admins); "memberships" (default) fetches only the user's clubs. */
			scope?: "all" | "memberships";
			className?: string;
	  };

export default function AdminClubIdSelector(props: AdminClubIdSelectorProps) {
	const { mode = "admin", className } = props;
	const switchScope = mode === "switch"
		? ((props as Extract<AdminClubIdSelectorProps, { mode: "switch" }>).scope ?? "memberships")
		: "memberships";
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);

	// Close dropdown when clicking outside the component
	useEffect(() => {
		if (!isOpen) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setIsOpen(false);
				setQuery("");
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isOpen]);

	// In switch mode, fetch only the user's own memberships; admin mode fetches all clubs.
	const {
		data: clubs,
		isLoading,
		error,
	} = api.user.getAvailableClubs.useQuery(
		mode === "switch" ? { scope: switchScope } : { scope: "all" },
		{ enabled: true },
	);

	// Active club from memberships query (switch mode only)
	const { data: memberships } = api.user.getClubMemberships.useQuery(
		undefined,
		{ enabled: mode === "switch" },
	);
	const activeClub = memberships?.find((m) => m.isActive);

	const utils = api.useUtils();

	// Capture callbacks before closures so TS can narrow the discriminated union
	const onSwitch = mode === "switch" ? props.onSwitch : undefined;
	const onSelect = mode !== "switch" ? props.onSelect : undefined;
	const switchClub = api.user.switchClub.useMutation({
		onSuccess: () => {
			// A club switch changes User.clubShortName, userType, AND activeFacilityId
			// server-side — which makes virtually every per-club tRPC query stale
			// (facility memberships, calendar events, clients list, etc.).
			// Nuclear invalidate-all is correct here: club switches are rare admin
			// actions, and this future-proofs against any new club-scoped queries
			// without having to remember to enumerate them here.
			void utils.invalidate();
			setIsOpen(false);
			setQuery("");
			onSwitch?.();
		},
	});

	const filteredClubs = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const list: ClubOption[] = clubs ?? [];
		if (!normalizedQuery) return list;
		return list.filter(
			(club) =>
				club.clubShortName.toLowerCase().includes(normalizedQuery) ||
				club.clubName.toLowerCase().includes(normalizedQuery),
		);
	}, [clubs, query]);

	// In switch mode, don't render if user only belongs to one club — placed AFTER all hooks
	if (mode === "switch" && !isLoading && (clubs?.length ?? 0) <= 1) return null;

	const currentLabel =
		mode === "switch"
			? activeClub
				? `${activeClub.clubName} (${activeClub.clubShortName})`
				: isLoading
					? "Loading..."
					: "Select a club"
			: props.selectedClubName
				? `${props.selectedClubName} (${props.selectedClubShortName})`
				: props.selectedClubShortName || "Select a club";

	const labelText = mode === "switch" ? "Active Club" : "Club ID";
	const hintText =
		mode === "switch"
			? "Switching clubs updates your active role and permissions."
			: "Admins can only select from existing clubs.";

	return (
		<div ref={containerRef} className={cn("space-y-2", className)}>
			<div className="flex items-center justify-between">
				<label className="block font-medium text-gray-700 text-sm">
					{labelText}
				</label>
			</div>

			<Button
				type="button"
				onClick={() => setIsOpen((v) => !v)}
				variant="outline"
				className="w-full justify-between"
				disabled={isLoading}
			>
				<span className="truncate">{currentLabel}</span>
				{isOpen ? (
					<ChevronUp className="h-4 w-4 shrink-0" />
				) : (
					<ChevronDown className="h-4 w-4 shrink-0" />
				)}
			</Button>

			{isOpen && (
				<div className="glass-panel overflow-hidden rounded-lg">
					<div className="border-gray-200 border-b p-3">
						<input
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
							placeholder="Search clubs by id or name"
							autoFocus
						/>
					</div>

					{isLoading ? (
						<div className="px-3 py-2 text-gray-500 text-sm">Loading...</div>
					) : error ? (
						<div className="px-3 py-2">
							<ErrorBanner message={error.message} />
						</div>
					) : filteredClubs.length === 0 ? (
						<div className="px-3 py-2 text-gray-500 text-sm">
							No clubs found
						</div>
					) : (
						<div className="max-h-56 overflow-y-auto">
							{filteredClubs.map((club) => {
								const isActive =
									mode === "switch"
										? club.clubShortName === activeClub?.clubShortName
										: club.clubShortName ===
											(props as { selectedClubShortName: string })
												.selectedClubShortName;
								const isPending =
									mode === "switch" &&
									switchClub.isPending &&
									switchClub.variables?.clubShortName === club.clubShortName;

								return (
									<button
										key={club.clubShortName}
										type="button"
										className="dropdown-item w-full text-left"
										disabled={mode === "switch" && switchClub.isPending}
										onClick={() => {
											if (mode === "switch") {
												switchClub.mutate({
													clubShortName: club.clubShortName,
												});
											} else {
												onSelect?.(club);
												setIsOpen(false);
												setQuery("");
											}
										}}
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<div className="truncate text-gray-900 text-sm">
													{club.clubShortName}
												</div>
												<div className="truncate text-gray-500 text-xs">
													{club.clubName}
												</div>
											</div>
											{isPending ? (
												<Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-gray-400" />
											) : isActive ? (
												<Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" />
											) : null}
										</div>
									</button>
								);
							})}
						</div>
					)}

					{mode === "switch" && switchClub.isError && (
						<div className="border-gray-200 border-t px-3 py-2">
							<ErrorBanner message={switchClub.error.message} />
						</div>
					)}
				</div>
			)}

			<p className="text-gray-500 text-xs">{hintText}</p>
		</div>
	);
}
