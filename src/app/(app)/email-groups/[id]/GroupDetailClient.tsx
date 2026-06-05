"use client";

import {
	ArrowLeft,
	Check,
	Filter,
	History,
	LogOut,
	Mail,
	Pencil,
	RefreshCw,
	Search,
	Tag,
	Trash2,
	UserPlus,
	Users,
	X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/app/_components/shared/dialog";
import { isAnyAdmin } from "~/lib/utils";
import { api } from "~/trpc/react";

interface Props {
	emailGroupId: string;
	userType: string;
	userId: string;
}

export default function GroupDetailClient({
	emailGroupId,
	userType,
	userId,
}: Props) {
	const router = useRouter();
	const [syncing, setSyncing] = useState(false);
	const [editingFilters, setEditingFilters] = useState(false);
	const [editTagIds, setEditTagIds] = useState<string[]>([]);
	const [editAgeMin, setEditAgeMin] = useState("");
	const [editAgeMax, setEditAgeMax] = useState("");
	const [showAddModal, setShowAddModal] = useState(false);
	const [addSearch, setAddSearch] = useState("");
	const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

	const utils = api.useUtils();

	const groupQuery = api.emailGroups.getById.useQuery({ emailGroupId });
	const historyQuery = api.emailGroups.getSendHistory.useQuery({
		emailGroupId,
	});
	const tagsQuery = api.user.listClubTags.useQuery();

	const group = groupQuery.data;
	const isCreator = group?.createdByUserId === userId;
	const isAdmin = isAnyAdmin({ userType });
	const canManage = isCreator || isAdmin;

	const syncMutation = api.emailGroups.syncMembers.useMutation({
		onSuccess: () => {
			utils.emailGroups.getById.invalidate({ emailGroupId });
		},
	});

	const leaveMutation = api.emailGroups.leave.useMutation({
		onSuccess: () => {
			router.push("/email-groups");
		},
	});

	const deleteMutation = api.emailGroups.delete.useMutation({
		onSuccess: () => {
			router.push("/email-groups");
		},
	});

	const updateMutation = api.emailGroups.update.useMutation({
		onSuccess: () => {
			utils.emailGroups.getById.invalidate({ emailGroupId });
			setEditingFilters(false);
		},
	});

	const addMembersMutation = api.emailGroups.addMembers.useMutation({
		onSuccess: () => {
			utils.emailGroups.getById.invalidate({ emailGroupId });
			setShowAddModal(false);
			setSelectedUserIds([]);
			setAddSearch("");
		},
	});

	const searchUsersQuery = api.user.listClubUsers.useQuery(
		{ search: addSearch || undefined, limit: 20, page: 1 },
		{ enabled: showAddModal },
	);

	const existingMemberIds = useMemo(
		() => new Set(group?.members.map((m: any) => m.user.userId) ?? []),
		[group?.members],
	);

	const filteredSearchUsers = useMemo(
		() =>
			(searchUsersQuery.data?.users ?? []).filter(
				(u: any) => !existingMemberIds.has(u.userId),
			),
		[searchUsersQuery.data?.users, existingMemberIds],
	);

	const toggleSelectUser = (uid: string) => {
		setSelectedUserIds((prev) =>
			prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
		);
	};

	const handleAddMembers = () => {
		if (selectedUserIds.length === 0) return;
		addMembersMutation.mutate({ emailGroupId, userIds: selectedUserIds });
	};

	const startEditingFilters = () => {
		const fc = (group?.filterConfig as any) ?? {};
		setEditTagIds(fc.tagIds ?? []);
		setEditAgeMin(fc.ageMin !== undefined ? String(fc.ageMin) : "");
		setEditAgeMax(fc.ageMax !== undefined ? String(fc.ageMax) : "");
		setEditingFilters(true);
	};

	const saveFilters = async () => {
		await updateMutation.mutateAsync({
			emailGroupId,
			filterConfig: {
				tagIds: editTagIds,
				...(editAgeMin ? { ageMin: Number.parseInt(editAgeMin) } : {}),
				...(editAgeMax ? { ageMax: Number.parseInt(editAgeMax) } : {}),
			},
		});
	};

	const toggleEditTag = (tagId: string) => {
		setEditTagIds((prev) =>
			prev.includes(tagId)
				? prev.filter((id) => id !== tagId)
				: [...prev, tagId],
		);
	};

	// Build the current edit filter config for the preview query
	const editFilterConfig = useMemo(() => {
		if (!editingFilters) return null;
		return {
			tagIds: editTagIds,
			...(editAgeMin ? { ageMin: Number.parseInt(editAgeMin) } : {}),
			...(editAgeMax ? { ageMax: Number.parseInt(editAgeMax) } : {}),
		};
	}, [editingFilters, editTagIds, editAgeMin, editAgeMax]);

	const hasAnyFilter =
		editingFilters &&
		editFilterConfig &&
		(editFilterConfig.tagIds.length > 0 ||
			editFilterConfig.ageMin !== undefined ||
			editFilterConfig.ageMax !== undefined);

	const previewQuery = api.emailGroups.getFilterPreview.useQuery(
		{
			facilityId: group?.facility?.facilityId ?? "",
			filterConfig: editFilterConfig!,
		},
		{
			enabled: !!hasAnyFilter && !!group?.facility?.facilityId,
		},
	);

	const handleSync = async () => {
		setSyncing(true);
		try {
			await syncMutation.mutateAsync({ emailGroupId });
		} finally {
			setSyncing(false);
		}
	};

	if (groupQuery.isLoading) {
		return (
			<div className="flex items-center justify-center p-12">
				<RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!group) {
		return (
			<div className="p-6 text-center text-muted-foreground">
				Group not found or you don&apos;t have access.
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-4xl p-6">
			{/* Header */}
			<div className="mb-6">
				<Link
					href="/email-groups"
					className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to groups
				</Link>
			</div>

			<div className="mb-6 flex items-start justify-between">
				<div>
					<h1 className="font-bold text-2xl">{group.name}</h1>
					<p className="mt-1 text-muted-foreground text-sm">
						{group.facility.name} · Created by {group.createdByUser.firstName}{" "}
						{group.createdByUser.lastName}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Link
						href={`/email-groups/${emailGroupId}/compose`}
						className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
					>
						<Mail className="h-4 w-4" />
						Compose Email
					</Link>
				</div>
			</div>

			{/* Actions Bar */}
			<div className="mb-6 flex flex-wrap items-center gap-2">
				{canManage && (
					<>
						<button
							type="button"
							onClick={handleSync}
							disabled={syncing}
							className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
						>
							<RefreshCw
								className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
							/>
							Sync Members
						</button>
						<button
							type="button"
							onClick={() => {
								setShowAddModal(true);
								setSelectedUserIds([]);
								setAddSearch("");
							}}
							className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
						>
							<UserPlus className="h-3.5 w-3.5" />
							Add Members
						</button>
						<button
							type="button"
							onClick={() => {
								if (confirm("Are you sure you want to delete this group?")) {
									deleteMutation.mutate({ emailGroupId });
								}
							}}
							className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-destructive text-sm hover:bg-destructive/10"
						>
							<Trash2 className="h-3.5 w-3.5" />
							Delete Group
						</button>
					</>
				)}
				{!isCreator && (
					<button
						type="button"
						onClick={() => {
							if (confirm("Are you sure you want to leave this group?")) {
								leaveMutation.mutate({ emailGroupId });
							}
						}}
						className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
					>
						<LogOut className="h-3.5 w-3.5" />
						Leave Group
					</button>
				)}
			</div>

			{/* Filters */}
			<div className="mb-6 rounded-lg border">
				<div className="flex items-center justify-between border-b px-4 py-3">
					<h2 className="flex items-center gap-2 font-medium">
						<Filter className="h-4 w-4" />
						Filters
					</h2>
					{canManage && !editingFilters && (
						<button
							type="button"
							onClick={startEditingFilters}
							className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
						>
							<Pencil className="h-3 w-3" />
							Edit
						</button>
					)}
					{editingFilters && (
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={saveFilters}
								disabled={updateMutation.isPending}
								className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-50"
							>
								<Check className="h-3 w-3" />
								{updateMutation.isPending ? "Saving..." : "Save"}
							</button>
							<button
								type="button"
								onClick={() => setEditingFilters(false)}
								className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
							>
								<X className="h-3 w-3" />
								Cancel
							</button>
						</div>
					)}
				</div>

				{editingFilters ? (
					<div className="space-y-4 px-4 py-3">
						{/* Tag selection */}
						<div>
							<label className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
								<Tag className="h-3 w-3" />
								Tags
							</label>
							<div className="flex flex-wrap gap-1.5">
								{tagsQuery.data?.map((tag: any) => {
									const isSelected = editTagIds.includes(tag.tagId);
									return (
										<button
											key={tag.tagId}
											type="button"
											onClick={() => toggleEditTag(tag.tagId)}
											className={`rounded-full px-2.5 py-1 font-medium text-xs transition-colors ${
												isSelected
													? "bg-primary text-primary-foreground"
													: "bg-accent text-muted-foreground hover:bg-accent/80"
											}`}
										>
											{tag.name}
										</button>
									);
								})}
								{(!tagsQuery.data || tagsQuery.data.length === 0) && (
									<span className="text-muted-foreground text-xs">
										No tags available
									</span>
								)}
							</div>
						</div>

						{/* Age range */}
						<div>
							<label className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
								<Users className="h-3 w-3" />
								Age Range
							</label>
							<div className="flex items-center gap-2">
								<input
									type="number"
									value={editAgeMin}
									onChange={(e) => setEditAgeMin(e.target.value)}
									placeholder="Min"
									min={0}
									className="w-20 rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
								/>
								<span className="text-muted-foreground text-sm">to</span>
								<input
									type="number"
									value={editAgeMax}
									onChange={(e) => setEditAgeMax(e.target.value)}
									placeholder="Max"
									min={0}
									className="w-20 rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
								/>
							</div>
						</div>

						{updateMutation.error && (
							<p className="text-destructive text-xs">
								{updateMutation.error.message}
							</p>
						)}
					</div>
				) : (
					<div className="space-y-2 px-4 py-3">
						{(group.filterConfig as any)?.tagIds?.length > 0 && (
							<div className="flex items-start gap-2">
								<Tag className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
								<div>
									<span className="font-medium text-muted-foreground text-xs">
										Tags
									</span>
									<div className="mt-1 flex flex-wrap gap-1.5">
										{((group.filterConfig as any).tagIds as string[]).map(
											(tagId: string) => {
												const tag = tagsQuery.data?.find(
													(t: any) => t.tagId === tagId,
												);
												return (
													<span
														key={tagId}
														className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary text-xs"
													>
														{tag?.name ?? tagId}
													</span>
												);
											},
										)}
									</div>
								</div>
							</div>
						)}
						{((group.filterConfig as any)?.ageMin !== undefined ||
							(group.filterConfig as any)?.ageMax !== undefined) && (
							<div className="flex items-center gap-2">
								<Users className="h-3.5 w-3.5 text-muted-foreground" />
								<div>
									<span className="font-medium text-muted-foreground text-xs">
										Age Range:{" "}
									</span>
									<span className="text-sm">
										{(group.filterConfig as any).ageMin ?? "any"} –{" "}
										{(group.filterConfig as any).ageMax ?? "any"}
									</span>
								</div>
							</div>
						)}
						{!(group.filterConfig as any)?.tagIds?.length &&
							(group.filterConfig as any)?.ageMin === undefined &&
							(group.filterConfig as any)?.ageMax === undefined && (
								<p className="text-muted-foreground text-sm">
									No filters configured. Click Edit to add filters.
								</p>
							)}
					</div>
				)}
			</div>

			{/* Members List */}
			<div className="mb-8 rounded-lg border">
				<div className="border-b px-4 py-3">
					<h2 className="flex items-center gap-2 font-medium">
						<Users className="h-4 w-4" />
						{editingFilters && hasAnyFilter ? (
							<>
								Filter Preview
								{previewQuery.isFetching ? (
									<RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
								) : (
									<span className="font-normal text-muted-foreground text-sm">
										({previewQuery.data?.count ?? 0} users matched)
									</span>
								)}
							</>
						) : (
							<>Members ({group.members.length})</>
						)}
					</h2>
				</div>
				<div className="max-h-80 overflow-y-auto">
					{editingFilters && hasAnyFilter ? (
						<>
							{previewQuery.data?.users?.map((user: any) => (
								<div
									key={user.userId}
									className="flex items-center justify-between border-b px-4 py-2 last:border-b-0"
								>
									<div>
										<span className="font-medium text-sm">
											{user.firstName} {user.lastName}
										</span>
										<span className="ml-2 text-muted-foreground text-xs">
											{user.email}
										</span>
									</div>
									<span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 text-xs">
										preview
									</span>
								</div>
							))}
							{previewQuery.data?.count === 0 && (
								<p className="px-4 py-6 text-center text-muted-foreground text-sm">
									No users match the current filters.
								</p>
							)}
						</>
					) : (
						<>
							{group.members.map((member: any) => (
								<div
									key={member.id}
									className="flex items-center justify-between border-b px-4 py-2 last:border-b-0"
								>
									<div>
										<span className="font-medium text-sm">
											{member.user.firstName} {member.user.lastName}
										</span>
										<span className="ml-2 text-muted-foreground text-xs">
											{member.user.email}
										</span>
									</div>
									<span className="rounded-full bg-accent px-2 py-0.5 text-muted-foreground text-xs">
										{member.source}
									</span>
								</div>
							))}
							{group.members.length === 0 && (
								<p className="px-4 py-6 text-center text-muted-foreground text-sm">
									No members yet. Sync from filters or add manually.
								</p>
							)}
						</>
					)}
				</div>
			</div>

			{/* Send History */}
			<div className="rounded-lg border">
				<div className="border-b px-4 py-3">
					<h2 className="flex items-center gap-2 font-medium">
						<History className="h-4 w-4" />
						Send History
					</h2>
				</div>
				{historyQuery.data && historyQuery.data.length > 0 ? (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b bg-accent/30 font-medium text-muted-foreground text-xs">
									<th className="px-4 py-2.5 text-left">Resend ID</th>
									<th className="px-4 py-2.5 text-left">Subject</th>
									<th className="px-4 py-2.5 text-left">Recipients</th>
									<th className="px-4 py-2.5 text-left">Status</th>
									<th className="px-4 py-2.5 text-left">Sent</th>
								</tr>
							</thead>
							<tbody>
								{historyQuery.data.map((log: any) => (
									<tr
										key={log.sendLogId}
										className="border-b last:border-b-0 hover:bg-accent/20"
									>
										{/* Resend ID */}
										<td className="px-4 py-3">
											{log.resendId ? (
												<span
													title={log.resendId}
													className="font-mono text-muted-foreground text-xs"
												>
													{log.resendId.slice(0, 16)}…
												</span>
											) : (
												<span className="text-muted-foreground/50 text-xs">
													—
												</span>
											)}
										</td>
										{/* Subject */}
										<td className="px-4 py-3">
											<span className="font-medium">{log.subject}</span>
										</td>
										{/* Group name + recipient count */}
										<td className="px-4 py-3 text-muted-foreground">
											{log.emailGroup?.name ?? group.name}
											<span className="ml-1 text-xs">
												· {log.recipientCount} sent
												{log.skippedCount > 0 && (
													<span className="ml-1 text-amber-600">
														/ {log.skippedCount} skipped
													</span>
												)}
											</span>
										</td>
										{/* Status badge */}
										<td className="px-4 py-3">
											<div className="flex flex-wrap gap-1">
												{log.status === "sent" && (
													<span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 text-xs">
														sent
													</span>
												)}
												{log.status === "partial_failure" && (
													<span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 text-xs">
														partial
													</span>
												)}
												{log.status === "failed" && (
													<span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 text-xs">
														API rejected
													</span>
												)}
												{log.status === "sending" && (
													<span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 text-xs">
														sending
													</span>
												)}
												{!log.status && (
													<span className="rounded-full bg-accent px-2 py-0.5 text-muted-foreground text-xs">
														—
													</span>
												)}
												{(log._count?.recipients ?? 0) > 0 && (
													<span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-700 text-xs">
														{log._count.recipients} bounced
													</span>
												)}
											</div>
										</td>
										{/* Sent date */}
										<td className="whitespace-nowrap px-4 py-3 text-muted-foreground text-xs">
											{new Date(log.sentAt).toLocaleDateString(undefined, {
												day: "numeric",
												month: "short",
												year: "numeric",
											})}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p className="px-4 py-6 text-center text-muted-foreground text-sm">
						No emails sent yet.
					</p>
				)}
			</div>
			{/* Add Members Modal */}
			<Dialog open={showAddModal} onOpenChange={setShowAddModal}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Add Members</DialogTitle>
						<DialogDescription>
							Search and select users to add to this group.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<div className="relative">
							<Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
							<input
								type="text"
								placeholder="Search by name or email…"
								value={addSearch}
								onChange={(e) => setAddSearch(e.target.value)}
								className="w-full rounded-md border py-2 pr-3 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
							/>
						</div>
						<div className="max-h-60 overflow-y-auto rounded-md border">
							{searchUsersQuery.isLoading ? (
								<div className="flex items-center justify-center py-6">
									<RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
								</div>
							) : filteredSearchUsers.length === 0 ? (
								<p className="px-3 py-6 text-center text-muted-foreground text-sm">
									{addSearch
										? "No matching users found."
										: "No users available to add."}
								</p>
							) : (
								filteredSearchUsers.map((user: any) => {
									const isSelected = selectedUserIds.includes(user.userId);
									return (
										<button
											key={user.userId}
											type="button"
											onClick={() => toggleSelectUser(user.userId)}
											className={`flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent ${
												isSelected ? "bg-primary/5" : ""
											}`}
										>
											<div>
												<span className="font-medium">
													{user.firstName} {user.lastName}
												</span>
												<span className="ml-2 text-muted-foreground text-xs">
													{user.email}
												</span>
											</div>
											{isSelected && <Check className="h-4 w-4 text-primary" />}
										</button>
									);
								})
							)}
						</div>
						{selectedUserIds.length > 0 && (
							<p className="text-muted-foreground text-xs">
								{selectedUserIds.length} user
								{selectedUserIds.length > 1 ? "s" : ""} selected
							</p>
						)}
						{addMembersMutation.error && (
							<p className="text-destructive text-xs">
								{addMembersMutation.error.message}
							</p>
						)}
					</DialogBody>
					<DialogFooter>
						<button
							type="button"
							onClick={() => setShowAddModal(false)}
							className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleAddMembers}
							disabled={
								selectedUserIds.length === 0 || addMembersMutation.isPending
							}
							className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
						>
							<UserPlus className="h-3.5 w-3.5" />
							{addMembersMutation.isPending ? "Adding…" : "Add Members"}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
