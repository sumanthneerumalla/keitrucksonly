"use client";

import { UserType } from "@prisma/client";
import { Search } from "lucide-react";
import Link from "next/link";
import { useUrlPagination } from "~/app/_components/hooks/use-url-pagination";
import { PaginationControls } from "~/app/_components/shared/ui/pagination-controls";
import { Select } from "~/app/_components/shared/ui/select";
import { hasCoachingAccess, isFacilityOrAbove } from "~/lib/utils";
import { getYouTubeThumbnailUrl } from "~/lib/videoUtils";
import { api } from "~/trpc/react";

const PAGE_SIZE_OPTIONS = [12, 24, 48];

interface VideoCollectionsListingProps {
	userType: UserType;
	userId: string;
}

export function VideoCollectionsListing({
	userType,
	userId,
}: VideoCollectionsListingProps) {
	const {
		page,
		limit,
		search,
		searchInput,
		setSearchInput,
		setPage,
		setLimit,
	} = useUrlPagination({ defaultLimit: 12, validLimits: PAGE_SIZE_OPTIONS });

	const { data, isLoading } = api.videoCollection.getAll.useQuery({
		page,
		limit,
		search: search || undefined,
	});

	const canCreate =
		userType === UserType.STUDENT ||
		(userType ? isFacilityOrAbove({ userType }) : false);

	const isCoach = userType === UserType.COACH;
	const isAdminOrCoach = userType ? hasCoachingAccess({ userType }) : false;

	return (
		<div className="container mx-auto px-4 py-8">
			<div className="mx-auto max-w-5xl">
				{/* Header */}
				<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
					<h1 className="section-heading">Video Collections</h1>
					{canCreate && (
						<Link
							href="/video-collections/create"
							className="rounded-lg bg-[var(--primary)] px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-[var(--primary)]/90"
						>
							Create New
						</Link>
					)}
				</div>

				{/* Search + page-size controls */}
				<div className="mb-6 flex flex-wrap items-center gap-3">
					<div className="relative min-w-0 flex-1 sm:min-w-[200px]">
						<Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-gray-400" />
						<input
							type="text"
							value={searchInput}
							onChange={(e) => setSearchInput(e.target.value)}
							placeholder="Search collections…"
							className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-9 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
						/>
					</div>
					<div className="flex items-center gap-2 text-gray-600 text-sm">
						<span>Show</span>
						<Select
							value={limit}
							onChange={(e) => setLimit(Number(e.target.value))}
						>
							{PAGE_SIZE_OPTIONS.map((n) => (
								<option key={n} value={n}>
									{n}
								</option>
							))}
						</Select>
						<span>per page</span>
					</div>
				</div>

				{/* Collection grid */}
				{isLoading ? (
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
						{Array.from({ length: limit }).map((_, i) => (
							<div
								key={i}
								className="animate-pulse rounded-xl bg-gray-100"
								style={{ height: 220 }}
							/>
						))}
					</div>
				) : !data?.collections.length ? (
					<div className="glass-panel p-6 text-center">
						{isCoach ? (
							<p className="mb-4 text-gray-600">
								No video collections have been assigned to you yet.
							</p>
						) : (
							<>
								<p className="mb-4 text-gray-600">
									{search
										? `No collections match "${search}".`
										: "No video collections found."}
								</p>
								{canCreate && !search && (
									<Link
										href="/video-collections/create"
										className="rounded-lg bg-[var(--primary)] px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-[var(--primary)]/90"
									>
										Create your first video collection
									</Link>
								)}
							</>
						)}
					</div>
				) : (
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
						{data.collections.map((collection) => (
							<Link
								key={collection.collectionId}
								href={`/video-collections/${collection.collectionId}`}
								className="glass-card transition-shadow hover:shadow-md"
							>
								{/* Thumbnail */}
								<div className="aspect-video overflow-hidden rounded-t-lg bg-gray-100">
									{collection.media[0]?.thumbnailUrl ||
									(collection.media[0]?.videoUrl &&
										getYouTubeThumbnailUrl(collection.media[0].videoUrl)) ? (
										<img
											src={
												collection.media[0]?.thumbnailUrl ||
												getYouTubeThumbnailUrl(
													collection.media[0]?.videoUrl ?? "",
												) ||
												""
											}
											alt={collection.title}
											className="h-full w-full object-cover"
										/>
									) : (
										<div className="flex h-full w-full items-center justify-center bg-gray-200">
											<span className="text-gray-500">No thumbnail</span>
										</div>
									)}
								</div>

								<div className="p-4">
									<h2 className="mb-1 truncate font-semibold text-lg">
										{collection.title}
									</h2>

									{collection.description && (
										<p className="mb-2 line-clamp-2 text-gray-600 text-sm">
											{collection.description}
										</p>
									)}

									<div className="mt-2 flex items-center justify-between text-gray-500 text-xs">
										<span>
											{collection._count.media} video
											{collection._count.media !== 1 ? "s" : ""}
										</span>

										{/* Show creator for admin/coach */}
										{isAdminOrCoach && collection.user && (
											<span>
												By: {collection.user.firstName ?? ""}{" "}
												{collection.user.lastName ?? ""}
											</span>
										)}
									</div>

									{/* Assigned coach */}
									{collection.assignedCoach && (
										<div className="mt-2 text-blue-600 text-xs">
											Coach: {collection.assignedCoach.firstName}{" "}
											{collection.assignedCoach.lastName}
											{collection.assignedCoach.coachProfile
												?.displayUsername && (
												<span className="text-gray-500">
													{" "}
													(@
													{
														collection.assignedCoach.coachProfile
															.displayUsername
													}
													)
												</span>
											)}
										</div>
									)}

									{/* No coach assigned — students' own unassigned collections */}
									{userType === UserType.STUDENT &&
										collection.userId === userId &&
										!collection.assignedCoach && (
											<div className="mt-2 text-gray-400 text-xs">
												No coach assigned
											</div>
										)}
								</div>
							</Link>
						))}
					</div>
				)}

				{/* Pagination controls */}
				{data?.pagination && (
					<PaginationControls
						page={data.pagination.page}
						pageCount={data.pagination.pageCount}
						total={data.pagination.total}
						limit={data.pagination.limit}
						onPageChange={setPage}
					/>
				)}
			</div>
		</div>
	);
}
