"use client";

import { Pencil, Search, UserMinus, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useDebouncedValue } from "~/app/_components/hooks/use-debounced-value";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import { api } from "~/trpc/react";

interface FamilyCardProps {
	userId: string;
	memberName: string;
}

type SearchMember = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	profileImage: string | null;
};

// Internal: typeahead popover that searches members club-wide and calls
// onSelect when the admin picks a result.
function MemberTypeahead({
	excludeUserIds,
	disabled,
	onSelect,
	label,
}: {
	excludeUserIds: string[];
	disabled?: boolean;
	onSelect: (member: SearchMember) => void;
	label: string;
}) {
	const [open, setOpen] = useState(false);
	const [searchInput, setSearchInput] = useState("");
	const debouncedQuery = useDebouncedValue(searchInput.trim(), 300);

	// Reset on close
	useEffect(() => {
		if (!open) {
			setSearchInput("");
		}
	}, [open]);

	const { data: searchData, isFetching: isSearching } =
		api.user.searchMembers.useQuery(
			{ query: debouncedQuery },
			{ enabled: !!debouncedQuery && open },
		);

	const all = (searchData?.members ?? []) as SearchMember[];
	const members = all.filter((m) => !excludeUserIds.includes(m.userId));

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm" disabled={disabled}>
					<Search size={14} />
					{label}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-0">
				<div className="p-3">
					<div className="relative">
						<Search
							size={14}
							className="-translate-y-1/2 absolute top-1/2 left-3 text-[var(--muted-foreground)]"
						/>
						<Input
							autoFocus
							value={searchInput}
							onChange={(e) => setSearchInput(e.target.value)}
							placeholder="Search by name or email"
							className="h-9 pl-9 text-sm"
						/>
					</div>
					<div className="mt-2 max-h-64 overflow-y-auto">
						{!debouncedQuery ? (
							<p className="p-3 text-[var(--muted-foreground)] text-xs">
								Type a name or email to search.
							</p>
						) : isSearching ? (
							<p className="p-3 text-[var(--muted-foreground)] text-xs">
								Searching…
							</p>
						) : members.length === 0 ? (
							<p className="p-3 text-[var(--muted-foreground)] text-xs">
								No members match "{debouncedQuery}".
							</p>
						) : (
							<ul className="flex flex-col">
								{members.map((m) => {
									const displayName =
										`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() ||
										m.email ||
										"Unnamed";
									return (
										<li key={m.userId}>
											<button
												type="button"
												onClick={() => {
													setOpen(false);
													onSelect(m);
												}}
												className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--accent)]"
											>
												<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-medium text-[var(--primary)] text-xs">
													{m.profileImage ? (
														// eslint-disable-next-line @next/next/no-img-element
														<img
															src={m.profileImage}
															alt=""
															className="h-7 w-7 rounded-full object-cover"
														/>
													) : (
														(m.firstName?.[0] ?? "?").toUpperCase()
													)}
												</div>
												<div className="min-w-0 flex-1">
													<p className="truncate text-[var(--foreground)] text-sm">
														{displayName}
													</p>
													{m.email && (
														<p className="truncate text-[var(--muted-foreground)] text-xs">
															{m.email}
														</p>
													)}
												</div>
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export default function FamilyCard({ userId, memberName }: FamilyCardProps) {
	const utils = api.useUtils();
	const { toast } = useToast();

	const { data: family, isLoading } = api.user.getFamilyGroup.useQuery({
		userId,
	});

	// Rename state
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");

	// Confirm dialogs
	const [moveConfirm, setMoveConfirm] = useState<{
		target: SearchMember;
		message: string;
	} | null>(null);
	const [removeConfirm, setRemoveConfirm] = useState<{
		userId: string;
		name: string;
	} | null>(null);

	const invalidateFamily = () => {
		// Invalidate everyone affected — getFamilyGroup is keyed by userId.
		void utils.user.getFamilyGroup.invalidate();
	};

	const joinMutation = api.user.joinFamilyGroup.useMutation({
		onSuccess: () => {
			invalidateFamily();
			toast("Family updated", "success");
			setMoveConfirm(null);
		},
		// onError is handled per-call so we can branch on PRECONDITION_FAILED
		// (different-groups → surface confirm dialog) without losing the
		// caller's reference to the picked SearchMember.
	});

	const leaveMutation = api.user.leaveFamilyGroup.useMutation({
		onSuccess: () => {
			invalidateFamily();
			toast("Removed from family", "success");
			setRemoveConfirm(null);
		},
		onError: (err) => {
			toast(err.message, "error");
			setRemoveConfirm(null);
		},
	});

	const renameMutation = api.user.renameFamilyGroup.useMutation({
		onSuccess: () => {
			invalidateFamily();
			toast("Family renamed", "success");
			setRenaming(false);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const handleSelectMember = (member: SearchMember) => {
		// First attempt without confirmMove. If the server replies with
		// PRECONDITION_FAILED, parse the message and surface the confirm dialog.
		joinMutation.mutate(
			{ userId, targetUserId: member.userId },
			{
				onError: (err) => {
					if (err.data?.code === "PRECONDITION_FAILED") {
						setMoveConfirm({ target: member, message: err.message });
						return;
					}
					toast(err.message, "error");
				},
			},
		);
	};

	const handleConfirmMove = () => {
		if (!moveConfirm) return;
		joinMutation.mutate(
			{
				userId,
				targetUserId: moveConfirm.target.userId,
				confirmMove: true,
			},
			{
				onError: (err) => {
					toast(err.message, "error");
					setMoveConfirm(null);
				},
			},
		);
	};

	const handleConfirmRemove = () => {
		if (!removeConfirm) return;
		leaveMutation.mutate({ userId: removeConfirm.userId });
	};

	const handleStartRename = () => {
		setRenameValue(family?.name ?? "");
		setRenaming(true);
	};

	const handleCancelRename = () => {
		setRenaming(false);
		setRenameValue("");
	};

	const handleSaveRename = () => {
		if (!family) return;
		const trimmed = renameValue.trim();
		if (!trimmed) {
			toast("Family name is required", "error");
			return;
		}
		renameMutation.mutate({
			familyGroupId: family.familyGroupId,
			name: trimmed,
		});
	};

	const memberIds = family?.members.map((m) => m.userId) ?? [];
	// Always exclude the current student from search results — they're already
	// implicitly part of any join action they're a participant in.
	const excludeIds = [userId, ...memberIds];

	return (
		<>
			<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
				<div className="mb-3 flex items-center justify-between gap-2">
					<h4 className="flex items-center gap-2 font-semibold text-[var(--foreground)] text-sm">
						<Users size={14} />
						Family
						{family && !renaming && (
							<span className="font-normal text-[var(--muted-foreground)]">
								— {family.name ?? "Family"}
							</span>
						)}
					</h4>
					{family && !renaming && (
						<Button
							variant="ghost"
							size="icon"
							onClick={handleStartRename}
							aria-label="Rename family"
							title="Rename family"
						>
							<Pencil size={14} />
						</Button>
					)}
				</div>

				{family && renaming && (
					<div className="mb-3 flex items-center gap-2">
						<Input
							value={renameValue}
							onChange={(e) => setRenameValue(e.target.value)}
							placeholder="Family name"
							maxLength={200}
							disabled={renameMutation.isPending}
							className="h-9 text-sm"
						/>
						<Button
							size="sm"
							onClick={handleSaveRename}
							disabled={renameMutation.isPending}
						>
							{renameMutation.isPending ? "Saving…" : "Save"}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleCancelRename}
							disabled={renameMutation.isPending}
						>
							Cancel
						</Button>
					</div>
				)}

				{isLoading ? (
					<p className="text-[var(--muted-foreground)] text-xs">Loading…</p>
				) : !family ? (
					<div className="space-y-3">
						<p className="text-[var(--muted-foreground)] text-sm">
							Not in a family group.
						</p>
						<MemberTypeahead
							excludeUserIds={excludeIds}
							disabled={joinMutation.isPending}
							onSelect={handleSelectMember}
							label="Add a family member"
						/>
					</div>
				) : (
					<div className="space-y-3">
						<ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)]">
							{family.members.map((m) => {
								const displayName =
									`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() ||
									m.email ||
									"Unnamed";
								const isSelf = m.userId === userId;
								return (
									<li
										key={m.userId}
										className="flex items-center justify-between gap-2 px-3 py-2"
									>
										<div className="min-w-0 flex-1">
											<Link
												href={`/clients/${m.userId}`}
												className="block truncate font-medium text-[var(--foreground)] text-sm hover:underline"
											>
												{displayName}
												{isSelf && (
													<span className="ml-1 font-normal text-[var(--muted-foreground)]">
														(you)
													</span>
												)}
											</Link>
											{m.email && (
												<p className="truncate text-[var(--muted-foreground)] text-xs">
													{m.email}
												</p>
											)}
										</div>
										{!isSelf && (
											<Button
												variant="ghost"
												size="icon"
												onClick={() =>
													setRemoveConfirm({
														userId: m.userId,
														name: displayName,
													})
												}
												disabled={leaveMutation.isPending}
												aria-label={`Remove ${displayName} from family`}
												title="Remove from family"
												className="hover:bg-red-50 hover:text-red-600"
											>
												<UserMinus size={14} />
											</Button>
										)}
									</li>
								);
							})}
						</ul>

						<MemberTypeahead
							excludeUserIds={excludeIds}
							disabled={joinMutation.isPending}
							onSelect={handleSelectMember}
							label="Add another member"
						/>
					</div>
				)}
			</div>

			{/* Move confirm dialog (PRECONDITION_FAILED path) */}
			<AlertDialog
				open={!!moveConfirm}
				title="Move to this family?"
				description={moveConfirm?.message ?? ""}
				confirmLabel={joinMutation.isPending ? "Moving…" : "Move"}
				cancelLabel="Cancel"
				onConfirm={handleConfirmMove}
				onCancel={() => setMoveConfirm(null)}
			/>

			{/* Remove-from-family confirm */}
			<AlertDialog
				open={!!removeConfirm}
				title="Remove from family?"
				description={
					removeConfirm
						? `${removeConfirm.name} will no longer share packages with ${memberName}.`
						: ""
				}
				confirmLabel={leaveMutation.isPending ? "Removing…" : "Remove"}
				cancelLabel="Cancel"
				destructive
				onConfirm={handleConfirmRemove}
				onCancel={() => setRemoveConfirm(null)}
			/>
		</>
	);
}
