"use client";

import { ArrowLeft, Check, Filter, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "~/trpc/react";

type Mode = "filter" | "manual";

interface Props {
	userType: string;
	userId: string;
	clubShortName: string;
	activeFacilityId: string | null;
}

export default function CreateGroupClient({
	userType,
	userId,
	clubShortName,
	activeFacilityId,
}: Props) {
	const router = useRouter();
	const [name, setName] = useState("");
	const [mode, setMode] = useState<Mode>("filter");
	const [isCreating, setIsCreating] = useState(false);

	// ── Filter mode state ──────────────────────────────────────────────────────
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
	const [ageMin, setAgeMin] = useState<string>("");
	const [ageMax, setAgeMax] = useState<string>("");

	// ── Manual mode state ──────────────────────────────────────────────────────
	const [search, setSearch] = useState("");
	const [selectedUsers, setSelectedUsers] = useState<
		{ userId: string; firstName: string; lastName: string; email: string }[]
	>([]);

	// Queries
	const tagsQuery = api.user.listClubTags.useQuery();

	const searchQuery = api.user.listClubUsers.useQuery(
		{ search: search || undefined, limit: 20, page: 1 },
		{ enabled: mode === "manual" && search.length >= 1 },
	);

	const filterConfig = {
		tagIds: selectedTagIds,
		...(ageMin ? { ageMin: Number.parseInt(ageMin) } : {}),
		...(ageMax ? { ageMax: Number.parseInt(ageMax) } : {}),
	};
	const hasFilters = selectedTagIds.length > 0 || ageMin || ageMax;

	const previewQuery = api.emailGroups.getFilterPreview.useQuery(
		{ facilityId: activeFacilityId ?? "", filterConfig },
		{ enabled: mode === "filter" && !!activeFacilityId && !!hasFilters },
	);

	// Mutations
	const utils = api.useUtils();
	const createMutation = api.emailGroups.create.useMutation({
		onSuccess: () => {
			void utils.emailGroups.getMyGroups.invalidate();
			void utils.emailGroups.getAllForFacility.invalidate();
		},
	});
	const addMembersMutation = api.emailGroups.addMembers.useMutation();

	const selectedUserIds = useMemo(
		() => new Set(selectedUsers.map((u) => u.userId)),
		[selectedUsers],
	);

	const toggleUser = (u: {
		userId: string;
		firstName: string;
		lastName: string;
		email: string;
	}) => {
		setSelectedUsers((prev) =>
			prev.some((x) => x.userId === u.userId)
				? prev.filter((x) => x.userId !== u.userId)
				: [...prev, u],
		);
	};

	const removeUser = (userId: string) => {
		setSelectedUsers((prev) => prev.filter((u) => u.userId !== userId));
	};

	const toggleTag = (tagId: string) => {
		setSelectedTagIds((prev) =>
			prev.includes(tagId)
				? prev.filter((id) => id !== tagId)
				: [...prev, tagId],
		);
	};

	const handleCreate = async () => {
		if (!name.trim() || !activeFacilityId) return;
		setIsCreating(true);
		try {
			const group = await createMutation.mutateAsync({
				facilityId: activeFacilityId,
				name: name.trim(),
				filterConfig:
					mode === "filter" && hasFilters ? filterConfig : undefined,
			});
			if (mode === "manual" && selectedUsers.length > 0) {
				await addMembersMutation.mutateAsync({
					emailGroupId: group.emailGroupId,
					userIds: selectedUsers.map((u) => u.userId),
				});
			}
			router.push(`/email-groups/${group.emailGroupId}`);
		} finally {
			setIsCreating(false);
		}
	};

	const canCreate =
		name.trim() &&
		!!activeFacilityId &&
		(mode === "filter" || selectedUsers.length > 0);

	return (
		<div className="mx-auto max-w-2xl p-6">
			<div className="mb-6">
				<Link
					href="/email-groups"
					className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to groups
				</Link>
			</div>

			<h1 className="mb-6 font-bold text-2xl">Create Email Group</h1>

			{/* Group Name */}
			<div className="mb-6">
				<label className="mb-2 block font-medium text-sm">Group Name</label>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g., U15 Boys Training"
					className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
					maxLength={200}
				/>
			</div>

			{/* Mode Toggle */}
			<div className="mb-6 flex rounded-lg border p-1">
				<button
					type="button"
					onClick={() => setMode("filter")}
					className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 font-medium text-sm transition-colors ${
						mode === "filter"
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<Filter className="h-4 w-4" />
					Filter-based
				</button>
				<button
					type="button"
					onClick={() => setMode("manual")}
					className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 font-medium text-sm transition-colors ${
						mode === "manual"
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					<Search className="h-4 w-4" />
					Manual Selection
				</button>
			</div>

			{/* ── Filter Mode ── */}
			{mode === "filter" && (
				<>
					<div className="mb-6 rounded-lg border p-4">
						<h2 className="mb-4 flex items-center gap-2 font-medium text-base">
							<Filter className="h-4 w-4" />
							Filters
						</h2>

						{/* Tag Filter */}
						<div className="mb-4">
							<label className="mb-2 block font-medium text-sm">
								User Tags
							</label>
							<div className="flex flex-wrap gap-2">
								{tagsQuery?.data?.map((tag: any) => (
									<button
										key={tag.tagId}
										type="button"
										onClick={() => toggleTag(tag.tagId)}
										className={`rounded-full px-3 py-1 font-medium text-xs transition-colors ${
											selectedTagIds.includes(tag.tagId)
												? "ring-2 ring-primary ring-offset-1"
												: "opacity-70 hover:opacity-100"
										}`}
										style={{
											backgroundColor: tag.bgColor,
											color: tag.textColor,
										}}
									>
										{tag.name}
									</button>
								))}
								{tagsQuery?.data?.length === 0 && (
									<p className="text-muted-foreground text-sm">
										No tags available. Create tags in the admin panel first.
									</p>
								)}
							</div>
						</div>

						{/* Age Range */}
						<div>
							<label className="mb-2 block font-medium text-sm">
								Age Range
							</label>
							<div className="flex items-center gap-2">
								<input
									type="number"
									value={ageMin}
									onChange={(e) => setAgeMin(e.target.value)}
									placeholder="Min"
									min={0}
									max={100}
									className="w-20 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
								/>
								<span className="text-muted-foreground">to</span>
								<input
									type="number"
									value={ageMax}
									onChange={(e) => setAgeMax(e.target.value)}
									placeholder="Max"
									min={0}
									max={100}
									className="w-20 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
								/>
								<span className="text-muted-foreground text-sm">years old</span>
							</div>
						</div>
					</div>

					{hasFilters && (
						<div className="mb-6 rounded-lg border bg-accent/30 p-4">
							<h3 className="mb-2 flex items-center gap-2 font-medium text-sm">
								<Users className="h-4 w-4" />
								Preview: {previewQuery.data?.count ?? "..."} users match
							</h3>
							{previewQuery.data && previewQuery.data.users.length > 0 && (
								<div className="max-h-40 overflow-y-auto">
									<ul className="space-y-1 text-muted-foreground text-sm">
										{previewQuery.data.users.slice(0, 20).map((u: any) => (
											<li key={u.userId}>
												{u.firstName} {u.lastName} — {u.email}
											</li>
										))}
										{previewQuery.data.users.length > 20 && (
											<li className="italic">
												...and {previewQuery.data.users.length - 20} more
											</li>
										)}
									</ul>
								</div>
							)}
						</div>
					)}
				</>
			)}

			{/* ── Manual Mode ── */}
			{mode === "manual" && (
				<div className="mb-6 space-y-4">
					{/* Search input */}
					<div className="relative">
						<Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search by name or email…"
							className="w-full rounded-md border py-2 pr-3 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
						/>
					</div>

					{/* Search results */}
					{search.length >= 1 && (
						<div className="rounded-md border">
							{searchQuery.isLoading && (
								<p className="px-4 py-3 text-muted-foreground text-sm">
									Searching…
								</p>
							)}
							{searchQuery.data?.users?.length === 0 && (
								<p className="px-4 py-3 text-muted-foreground text-sm">
									No users found.
								</p>
							)}
							{searchQuery.data?.users?.map((u: any) => {
								const selected = selectedUserIds.has(u.userId);
								return (
									<button
										key={u.userId}
										type="button"
										onClick={() => toggleUser(u)}
										className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/50 ${
											selected ? "bg-primary/5" : ""
										}`}
									>
										<div>
											<span className="font-medium">
												{u.firstName} {u.lastName}
											</span>
											<span className="ml-2 text-muted-foreground text-xs">
												{u.email}
											</span>
										</div>
										{selected && <Check className="h-4 w-4 text-primary" />}
									</button>
								);
							})}
						</div>
					)}

					{/* Selected users */}
					{selectedUsers.length > 0 && (
						<div>
							<p className="mb-2 font-medium text-sm">
								Selected ({selectedUsers.length})
							</p>
							<div className="flex flex-wrap gap-2">
								{selectedUsers.map((u) => (
									<span
										key={u.userId}
										className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary text-xs"
									>
										{u.firstName} {u.lastName}
										<button
											type="button"
											onClick={() => removeUser(u.userId)}
											className="ml-0.5 rounded-full hover:text-destructive"
										>
											<X className="h-3 w-3" />
										</button>
									</span>
								))}
							</div>
						</div>
					)}

					{selectedUsers.length === 0 && search.length === 0 && (
						<p className="text-muted-foreground text-sm">
							Search for members to add them to this group.
						</p>
					)}
				</div>
			)}

			{/* Create Button */}
			<div className="flex justify-end gap-3">
				<Link
					href="/email-groups"
					className="rounded-md border px-4 py-2 font-medium text-sm hover:bg-accent"
				>
					Cancel
				</Link>
				<button
					type="button"
					onClick={handleCreate}
					disabled={!canCreate || isCreating}
					className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
				>
					{isCreating ? "Creating…" : "Create Group"}
				</button>
			</div>

			{(createMutation.error ?? addMembersMutation.error) && (
				<p className="mt-4 text-destructive text-sm">
					{(createMutation.error ?? addMembersMutation.error)?.message}
				</p>
			)}
		</div>
	);
}
