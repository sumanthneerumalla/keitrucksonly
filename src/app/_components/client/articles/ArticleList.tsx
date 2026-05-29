"use client";

import { ArticleStatus } from "@prisma/client";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

type Filter = ArticleStatus | "ALL";

// Phase 15 Stage 2 — scope filter for PLATFORM_ADMIN.
//   "ALL"      → omit clubShortName (all scopes)
//   "PLATFORM" → clubShortName === null (platform only)
//   <string>   → that clubShortName (one club)
type ScopeFilter = "ALL" | "PLATFORM" | string;

interface ArticleListProps {
	initialFilter?: Filter;
	currentUser: {
		userId: string;
		userType: string;
		clubShortName: string;
	};
}

export default function ArticleList({
	initialFilter = "ALL",
	currentUser,
}: ArticleListProps) {
	const utils = api.useUtils();
	const { toast } = useToast();
	const [filter, setFilter] = useState<Filter>(initialFilter);
	const [scope, setScope] = useState<ScopeFilter>("ALL");

	const isPlatformAdmin = currentUser.userType === "PLATFORM_ADMIN";

	// Map UI scope state → router param.
	const scopeParam: { clubShortName?: string | null } = useMemo(() => {
		if (!isPlatformAdmin) return {};
		if (scope === "ALL") return {};
		if (scope === "PLATFORM") return { clubShortName: null };
		return { clubShortName: scope };
	}, [isPlatformAdmin, scope]);

	const clubsQuery = api.clubs.list.useQuery(undefined, {
		// Only platform admins need the clubs list (for the scope chips).
		enabled: isPlatformAdmin,
	});

	const listQuery = api.articles.adminList.useQuery({
		...(filter === "ALL" ? {} : { status: filter }),
		...scopeParam,
	});

	const deleteMutation = api.articles.delete.useMutation({
		onSuccess: () => {
			void utils.articles.adminList.invalidate();
			toast("Article deleted", "success");
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const handleDelete = (id: string, title: string) => {
		if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
		deleteMutation.mutate({ id });
	};

	const articles = listQuery.data ?? [];
	const clubs = clubsQuery.data ?? [];

	// Resolve a clubShortName → clubName (for the Scope column display).
	const clubNameByShort = useMemo(() => {
		const map = new Map<string, string>();
		for (const c of clubs) {
			map.set(c.clubShortName, c.clubName);
		}
		return map;
	}, [clubs]);

	const scopeLabel = (clubShortName: string | null): string => {
		if (clubShortName === null) return "Platform";
		return clubNameByShort.get(clubShortName) ?? clubShortName;
	};

	return (
		<div className="p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between gap-4">
				<div>
					<h1 className="font-semibold text-2xl text-[var(--foreground)]">
						Articles
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Write and manage articles.
					</p>
				</div>
				<Link
					href="/admin/articles/new"
					className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" />
					New article
				</Link>
			</div>

			{/* Scope chips — platform admin only */}
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
					<FilterChip
						label="Platform"
						active={scope === "PLATFORM"}
						onClick={() => setScope("PLATFORM")}
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
					active={filter === ArticleStatus.DRAFT}
					onClick={() => setFilter(ArticleStatus.DRAFT)}
				/>
				<FilterChip
					label="Published"
					active={filter === ArticleStatus.PUBLISHED}
					onClick={() => setFilter(ArticleStatus.PUBLISHED)}
				/>
			</div>

			{/* Table */}
			<div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
				{listQuery.isLoading ? (
					<div className="flex items-center justify-center gap-2 p-8 text-[var(--muted-foreground)]">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading articles…
					</div>
				) : listQuery.error ? (
					<div className="p-8 text-destructive text-sm">
						Failed to load articles: {listQuery.error.message}
					</div>
				) : articles.length === 0 ? (
					<div className="p-8 text-center text-[var(--muted-foreground)] text-sm">
						No articles yet.{" "}
						<Link
							href="/admin/articles/new"
							className="text-primary hover:underline"
						>
							Write your first article.
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
							{articles.map((article) => (
								<tr
									key={article.id}
									className="border-b last:border-b-0 hover:bg-gray-50"
								>
									<td className="px-4 py-3">
										{(() => {
											// Phase 15 fixup F2: unauthorized callers (per Q9
											// per-author rule) must NOT land on the editor page —
											// link them to the public reading surface where one
											// exists. Club public pages don't exist yet (Step 4),
											// so unauthorized club-published rows render as plain
											// text for now. Drafts likewise render as plain text
											// (Q11 hides other authors' drafts from the list, but
											// this is defense-in-depth).
											const titleClass = "font-medium text-[var(--foreground)]";
											if (article.canEdit) {
												return (
													<Link
														href={`/admin/articles/${article.id}/edit`}
														className={`${titleClass} hover:text-primary`}
													>
														{article.title}
													</Link>
												);
											}
											if (
												article.status === ArticleStatus.PUBLISHED &&
												article.clubShortName === null
											) {
												return (
													<Link
														href={`/articles/${article.slug}`}
														className={`${titleClass} hover:text-primary`}
													>
														{article.title}
													</Link>
												);
											}
											return (
												<span
													className={titleClass}
													title={
														article.status === ArticleStatus.PUBLISHED
															? "View on club's public page coming soon"
															: undefined
													}
												>
													{article.title}
												</span>
											);
										})()}
										<div className="text-[var(--muted-foreground)] text-xs">
											/{article.slug}
										</div>
									</td>
									{isPlatformAdmin && (
										<td className="px-4 py-3 text-[var(--muted-foreground)]">
											{scopeLabel(article.clubShortName)}
										</td>
									)}
									<td className="px-4 py-3">
										<StatusBadge status={article.status} />
									</td>
									<td className="px-4 py-3 text-[var(--muted-foreground)]">
										{article.publishedAt
											? formatDate(article.publishedAt)
											: "—"}
									</td>
									<td className="px-4 py-3 text-[var(--muted-foreground)]">
										{formatRelative(article.updatedAt)}
									</td>
									<td className="px-4 py-3 text-[var(--muted-foreground)]">
										{article.authorName}
									</td>
									<td className="px-4 py-3 text-right">
										<div className="inline-flex items-center gap-1">
											{article.canEdit ? (
												<>
													<Link
														href={`/admin/articles/${article.id}/edit`}
														className="inline-flex items-center gap-1 rounded p-1.5 text-[var(--muted-foreground)] hover:bg-accent hover:text-foreground"
														title="Edit"
													>
														<Pencil className="h-4 w-4" />
													</Link>
													<button
														type="button"
														onClick={() =>
															handleDelete(article.id, article.title)
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
													title="Only the author or a club admin can edit this"
												>
													—
												</span>
											)}
										</div>
									</td>
								</tr>
							))}
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

function StatusBadge({ status }: { status: ArticleStatus }) {
	if (status === ArticleStatus.PUBLISHED) {
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

	// Use Intl.RelativeTimeFormat if available (es2022 target).
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

	if (abs < 60) return rtf.format(diffSec, "second");
	if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
	if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
	if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
	if (abs < 86400 * 365)
		return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
	return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}
