"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { ArrowLeft, Search, Users, Filter } from "lucide-react";
import Link from "next/link";

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
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
	const [ageMin, setAgeMin] = useState<string>("");
	const [ageMax, setAgeMax] = useState<string>("");
	const [isCreating, setIsCreating] = useState(false);

	// Fetch available tags for the club
	const tagsQuery = api.user.listClubTags.useQuery();

	// Preview filter results
	const filterConfig = {
		tagIds: selectedTagIds,
		...(ageMin ? { ageMin: Number.parseInt(ageMin) } : {}),
		...(ageMax ? { ageMax: Number.parseInt(ageMax) } : {}),
	};

	const hasFilters = selectedTagIds.length > 0 || ageMin || ageMax;

	const previewEnabled = !!activeFacilityId && !!hasFilters;
	const previewQuery = api.emailGroups.getFilterPreview.useQuery(
		{ facilityId: activeFacilityId ?? "", filterConfig },
		{ enabled: previewEnabled as boolean },
	);

	const createMutation = api.emailGroups.create.useMutation({
		onSuccess: (data) => {
			router.push(`/email-groups/${data.emailGroupId}`);
		},
	});

	const handleCreate = async () => {
		if (!name.trim() || !activeFacilityId) return;
		setIsCreating(true);
		try {
			await createMutation.mutateAsync({
				facilityId: activeFacilityId,
				name: name.trim(),
				filterConfig: hasFilters ? filterConfig : undefined,
			});
		} finally {
			setIsCreating(false);
		}
	};

	const toggleTag = (tagId: string) => {
		setSelectedTagIds((prev) =>
			prev.includes(tagId)
				? prev.filter((id) => id !== tagId)
				: [...prev, tagId],
		);
	};

	return (
		<div className="mx-auto max-w-2xl p-6">
			<div className="mb-6">
				<Link
					href="/email-groups"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to groups
				</Link>
			</div>

			<h1 className="mb-6 text-2xl font-bold">Create Email Group</h1>

			{/* Group Name */}
			<div className="mb-6">
				<label className="mb-2 block text-sm font-medium">
					Group Name
				</label>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g., U15 Boys Training"
					className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
					maxLength={200}
				/>
			</div>

			{/* Filters Section */}
			<div className="mb-6 rounded-lg border p-4">
				<h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
					<Filter className="h-5 w-5" />
					Filters
				</h2>

				{/* Tag Filter */}
				<div className="mb-4">
					<label className="mb-2 block text-sm font-medium">
						User Tags
					</label>
					<div className="flex flex-wrap gap-2">
						{tagsQuery?.data?.map((tag: any) => (
							<button
								key={tag.tagId}
								type="button"
								onClick={() => toggleTag(tag.tagId)}
								className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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
							<p className="text-sm text-muted-foreground">
								No tags available. Create tags in the admin panel first.
							</p>
						)}
					</div>
				</div>

				{/* Age Range Filter */}
				<div>
					<label className="mb-2 block text-sm font-medium">
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
						<span className="text-sm text-muted-foreground">years old</span>
					</div>
				</div>
			</div>

			{/* Filter Preview */}
			{hasFilters && (
				<div className="mb-6 rounded-lg border bg-accent/30 p-4">
					<h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
						<Users className="h-4 w-4" />
						Preview: {previewQuery.data?.count ?? "..."} users match
					</h3>
					{previewQuery.data && previewQuery.data.users.length > 0 && (
						<div className="max-h-40 overflow-y-auto">
							<ul className="space-y-1 text-sm text-muted-foreground">
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

			{/* Create Button */}
			<div className="flex justify-end gap-3">
				<Link
					href="/email-groups"
					className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
				>
					Cancel
				</Link>
				<button
					type="button"
					onClick={handleCreate}
					disabled={!name.trim() || isCreating}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{isCreating ? "Creating..." : "Create Group"}
				</button>
			</div>

			{createMutation.error && (
				<p className="mt-4 text-sm text-destructive">
					{createMutation.error.message}
				</p>
			)}
		</div>
	);
}
