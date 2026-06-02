"use client";

import { AnnouncementStatus } from "@prisma/client";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useToast } from "~/app/_components/shared/Toast";
import { canModifyAnnouncementClient } from "~/lib/announcement";
import { api } from "~/trpc/react";

type Filter = AnnouncementStatus | "ALL";

// Phase 15 Step 6 — scope filter for PLATFORM_ADMIN.
//   "ALL"    → omit clubShortName (all clubs)
//   <string> → that clubShortName
// (Note: NO "Platform" option — announcements are always per-club.)
type ScopeFilter = "ALL" | string;

interface AnnouncementListProps {
	initialFilter?: Filter;
	currentUser: {
		userId: string;
		userType: string;
		clubShortName: string;
	};
}

export default function AnnouncementList({
	initialFilter = "ALL",
	currentUser,
}: AnnouncementListProps) {
	const utils = api.useUtils();
	const { toast } = useToast();
	const [filter, setFilter] = useState<Filter>(initialFilter);
	const [scope, setScope] = useState<ScopeFilter>("ALL");

	const isPlatformAdmin = currentUser.userType === "PLATFORM_ADMIN";

	// Map UI scope state → router param.
	const scopeParam: { clubShortName?: string } = useMemo(() => {
		if (!isPlatformAdmin) return {};
		if (scope === "ALL") return {};
		return { clubShortName: scope };
	}, [isPlatformAdmin, scope]);

	const clubsQuery = api.clubs.list.useQuery(undefined, {
		// Only platform admins need the clubs list (for the scope chips +
		// scope-column display).
		enabled: isPlatformAdmin,
	});

	const listQuery = api.announcements.adminList.useQuery({
		...(filter === "ALL" ? {} : { status: filter }),
		...scopeParam,
	});

	const deleteMutation = api.announcements.delete.useMutation({
		onSuccess: () => {
			void utils.announcements.adminList.invalidate();
			toast("Announcement deleted", "success");
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const handleDelete = (id: string, label: string) => {
		if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
		deleteMutation.mutate({ id });
	};

	const announcements = listQuery.data ?? [];
	const clubs = clubsQuery.data ?? [];

	// Resolve clubShortName → clubName for the Scope column.
	const clubNameByShort = useMemo(() => {
		const map = new Map<string, string>();
		for (const c of clubs) {
			map.set(c.clubShortName, c.clubName);
		}
		return map;
	}, [clubs]);

	const scopeLabel = (clubShortName: string): string => {
		return clubNameByShort.get(clubShortName) ?? clubShortName;
	};

	return (
		<div className="p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between gap-4">
				<div>
					<h1 className="font-semibold text-2xl text-[var(--foreground)]">
						Announcements
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Post and manage your club's announcements.
					</p>
				</div>
				<Link
					href="/admin/announcements/new"
					className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" />
					New announcement
				</Link>
			</div>

			{/* Scope chips — platform admin only. NO "Platform" option (announcements are always per-club). */}
			{isPlatformAdmin && (
				<div className="mb-3 flex flex-wrap items-center gap-2">
					<span className="font-medium text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
						Scope:
					</span>
					<FilterChip
						label="All"
						active={scope === "ALL"}
						onClick={() => setScope("ALL")}
					/>
					{clubs.map((c) => (
						<FilterChip
							key={c.clubShortName}
							label={c.clubName}
							active={scope === c.clubShortName}
							onClick={() => setScope(c.clubShortName)}
						/>
					))}
				</div>
			)}

			{/* Filter chips */}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<FilterChip
					label="All"
					active={filter === "ALL"}
					onClick={() => setFilter("ALL")}
				/>
				<FilterChip
					label="Drafts"
					active={filter === AnnouncementStatus.DRAFT}
					onClick={() => setFilter(AnnouncementStatus.DRAFT)}
				/>
				<FilterChip
					label="Published"
					active={filter === AnnouncementStatus.PUBLISHED}
					onClick={() => setFilter(AnnouncementStatus.PUBLISHED)}
				/>
			</div>

			{/* Table */}
			<div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
				{listQuery.isLoading ? (
					<div className="flex items-center justify-center gap-2 p-8 text-[var(--muted-foreground)]">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading announcements…
					</div>
				) : listQuery.error ? (
					<div className="p-8 text-destructive text-sm">
						Failed to load announcements: {listQuery.error.message}
					</div>
				) : announcements.length === 0 ? (
					<div className="p-8 text-center text-[var(--muted-foreground)] text-sm">
						No announcements yet.{" "}
						<Link
							href="/admin/announcements/new"
							className="text-primary hover:underline"
						>
							Post your first announcement.
						</Link>
					</div>
				) : (
					<table className="w-full text-sm">
						<thead className="border-b bg-gray-50 text-[var(--muted-foreground)] text-xs uppercase">
							<tr>
								<th className="px-4 py-2 text-left font-medium">Title</th>
								{isPlatformAdmin && (
									<th className="px-4 py-2 text-left font-medium">Scope</th>
								)}
								<th className="px-4 py-2 text-left font-medium">Status</th>
								<th className="px-4 py-2 text-left font-medium">Published</th>
								<th className="px-4 py-2 text-left font-medium">Updated</th>
								<th className="px-4 py-2 text-left font-medium">Author</th>
								<th className="px-4 py-2 text-right font-medium">Actions</th>
							</tr>
						</thead>
						<tbody>
							{announcements.map((announcement) => {
								// Q10 — client-side: any staff in the announcement's club can
								// edit/delete (server enforces; this is for UI affordances).
								const canEdit = canModifyAnnouncementClient(
									currentUser,
									announcement,
								);
								const titleLabel = announcement.title ?? "(no title)";
								return (
									<tr
										key={announcement.id}
										className="border-b last:border-b-0 hover:bg-gray-50"
									>
										<td className="px-4 py-3">
											{canEdit ? (
												<Link
													href={`/admin/announcements/${announcement.id}/edit`}
													className={`font-medium text-[var(--foreground)] hover:text-primary ${
														announcement.title
															? ""
															: "text-[var(--muted-foreground)] italic"
													}`}
												>
													{titleLabel}
												</Link>
											) : (
												<span
													className={`font-medium ${
														announcement.title
															? "text-[var(--foreground)]"
															: "text-[var(--muted-foreground)] italic"
													}`}
												>
													{titleLabel}
												</span>
											)}
										</td>
										{isPlatformAdmin && (
											<td className="px-4 py-3 text-[var(--muted-foreground)]">
												{scopeLabel(announcement.clubShortName)}
											</td>
										)}
										<td className="px-4 py-3">
											<StatusBadge status={announcement.status} />
										</td>
										<td className="px-4 py-3 text-[var(--muted-foreground)]">
											{announcement.publishedAt
												? formatDate(announcement.publishedAt)
												: "—"}
										</td>
										<td className="px-4 py-3 text-[var(--muted-foreground)]">
											{formatRelative(announcement.updatedAt)}
										</td>
										<td className="px-4 py-3 text-[var(--muted-foreground)]">
											{announcement.authorName}
										</td>
										<td className="px-4 py-3 text-right">
											<div className="inline-flex items-center gap-1">
												{canEdit ? (
													<>
														<Link
															href={`/admin/announcements/${announcement.id}/edit`}
															className="inline-flex items-center gap-1 rounded p-1.5 text-[var(--muted-foreground)] hover:bg-accent hover:text-foreground"
															title="Edit"
														>
															<Pencil className="h-4 w-4" />
														</Link>
														<button
															type="button"
															onClick={() =>
																handleDelete(announcement.id, titleLabel)
															}
															disabled={deleteMutation.isPending}
															className="inline-flex items-center gap-1 rounded p-1.5 text-[var(--muted-foreground)] hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
															title="Delete"
														>
															<Trash2 className="h-4 w-4" />
														</button>
													</>
												) : (
													<span
														className="text-[var(--muted-foreground)] text-xs"
														title="Only staff in this announcement's club can edit"
													>
														—
													</span>
												)}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}

function FilterChip({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-full px-3 py-1 text-sm transition-colors ${
				active
					? "bg-primary text-primary-foreground"
					: "border bg-background text-muted-foreground hover:bg-accent"
			}`}
		>
			{label}
		</button>
	);
}

function StatusBadge({ status }: { status: AnnouncementStatus }) {
	if (status === AnnouncementStatus.PUBLISHED) {
		return (
			<span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 text-xs">
				Published
			</span>
		);
	}
	return (
		<span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 text-xs">
			Draft
		</span>
	);
}

function formatDate(date: Date): string {
	return new Date(date).toLocaleDateString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatRelative(date: Date): string {
	const now = Date.now();
	const then = new Date(date).getTime();
	const diffSec = Math.round((then - now) / 1000);
	const abs = Math.abs(diffSec);

	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

	if (abs < 60) return rtf.format(diffSec, "second");
	if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
	if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
	if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
	if (abs < 86400 * 365)
		return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
	return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}
