"use client";

import {
	CalendarDays,
	Check,
	ChevronsUpDown,
	Receipt,
	Search,
	X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { InvoiceStatusPill } from "~/app/_components/billing/InvoiceStatusPill";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import {
	formatInvoiceDate as formatDate,
	formatPersonName,
} from "~/lib/invoice/format";
import { formatCents } from "~/lib/money";
import { cn } from "~/lib/utils";
import { type RouterInputs, api } from "~/trpc/react";

/**
 * Phase 9a (C13) — staff invoice list with URL-synced filters.
 *
 * All filter state (search, status, date range) lives in the URL so a filtered
 * view is shareable/bookmarkable and survives reload + back/forward. Search
 * filters server-side by the consumer's OR payer's name/email, invoice number,
 * line-item description, note, and payment reference — debounced 250ms and gated
 * at 2+ chars. Status is a multi-select over the stored statuses; the date range
 * filters on issueDate. Results paginate via useInfiniteQuery; each row links to
 * the shared detail page at /admin/invoices/[invoiceId].
 */

// Stored invoice statuses, sourced from the listInvoices server contract so this
// list breaks at compile time if the enum changes. The pill also renders DERIVED
// labels ("Due"/"Credit"); those aren't stored, so they aren't filterable here.
type StoredStatus = NonNullable<
	RouterInputs["billing"]["listInvoices"]["status"]
>[number];

const STATUS_OPTIONS: { value: StoredStatus; label: string }[] = [
	{ value: "draft", label: "Draft" },
	{ value: "open", label: "Open" },
	{ value: "partially_paid", label: "Partially paid" },
	{ value: "paid", label: "Paid" },
	{ value: "void", label: "Void" },
];
const STATUS_VALUES = STATUS_OPTIONS.map((o) => o.value);

// Calendar date sent by <input type="date"> (and accepted by z.string().date()).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function InvoiceListClient() {
	const router = useRouter();
	const searchParams = useSearchParams();

	// Radix Popover generates ids that differ between SSR and first client render;
	// defer mounting it until after hydration to avoid the mismatch warning.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	// --- URL is the source of truth for every filter -------------------------
	const syncUrl = useCallback(
		(updates: Record<string, string | undefined>) => {
			const params = new URLSearchParams(searchParams.toString());
			for (const [key, val] of Object.entries(updates)) {
				if (val === undefined || val === "") params.delete(key);
				else params.set(key, val);
			}
			router.replace(`?${params.toString()}`, { scroll: false });
		},
		[router, searchParams],
	);

	const searchFromUrl = searchParams.get("search") ?? "";
	const startParam = searchParams.get("start") ?? "";
	const endParam = searchParams.get("end") ?? "";

	const selectedStatuses = useMemo<StoredStatus[]>(() => {
		const raw = searchParams.get("status") ?? "";
		return raw
			.split(",")
			.filter((s): s is StoredStatus =>
				STATUS_VALUES.includes(s as StoredStatus),
			);
	}, [searchParams]);

	const setStatusFilter = useCallback(
		(next: StoredStatus[]) =>
			syncUrl({ status: next.length > 0 ? next.join(",") : undefined }),
		[syncUrl],
	);

	const toggleStatus = useCallback(
		(s: StoredStatus) =>
			setStatusFilter(
				selectedStatuses.includes(s)
					? selectedStatuses.filter((x) => x !== s)
					: [...selectedStatuses, s],
			),
		[selectedStatuses, setStatusFilter],
	);

	// --- Search: local input + 250ms debounce before writing to the URL -------
	const [searchInput, setSearchInput] = useState(searchFromUrl);
	const [debouncedSearch, setDebouncedSearch] = useState(searchFromUrl);
	const [statusOpen, setStatusOpen] = useState(false);

	useEffect(() => {
		const t = setTimeout(() => setDebouncedSearch(searchInput), 250);
		return () => clearTimeout(t);
	}, [searchInput]);

	useEffect(() => {
		if (debouncedSearch !== searchFromUrl) {
			syncUrl({ search: debouncedSearch || undefined });
		}
	}, [debouncedSearch, searchFromUrl, syncUrl]);

	const trimmed = debouncedSearch.trim();
	// Gate at 2+ chars; shorter (or empty) shows the full, unfiltered list.
	const effectiveSearch = trimmed.length >= 2 ? trimmed : undefined;

	// Validate before querying so a hand-edited URL can't send junk to the server.
	const startDate = DATE_RE.test(startParam) ? startParam : undefined;
	const endDate = DATE_RE.test(endParam) ? endParam : undefined;

	const hasActiveFilters =
		!!effectiveSearch ||
		selectedStatuses.length > 0 ||
		!!startDate ||
		!!endDate;

	function clearAllFilters() {
		setSearchInput("");
		syncUrl({
			search: undefined,
			status: undefined,
			start: undefined,
			end: undefined,
		});
	}

	const { data, isLoading, isFetching, error, fetchNextPage, hasNextPage } =
		api.billing.listInvoices.useInfiniteQuery(
			{
				search: effectiveSearch,
				status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
				startDate,
				endDate,
			},
			{ getNextPageParam: (last) => last.nextCursor ?? undefined },
		);

	const rows = data?.pages.flatMap((p) => p.items) ?? [];

	return (
		<div className="mx-auto max-w-5xl space-y-6 p-6">
			<div className="flex items-center gap-2">
				<Receipt size={20} className="text-[var(--foreground)]" />
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Invoices
				</h1>
			</div>

			{/* Filters — search, status, and issue-date range, all URL-synced */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative w-full flex-1 sm:w-auto sm:min-w-[220px]">
					<Search
						size={16}
						className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-[var(--muted-foreground)]"
					/>
					<input
						type="search"
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						placeholder="Search by member, email, invoice #, item, note, or ref…"
						className="flex h-9 w-full rounded-md border border-input bg-transparent py-2 pr-3 pl-9 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
					/>
				</div>

				{/* Status multi-select — deferred to client to avoid Radix hydration mismatch */}
				{mounted && (
					<Popover open={statusOpen} onOpenChange={setStatusOpen}>
						<PopoverTrigger asChild>
							<Button
								variant="outline"
								aria-haspopup="listbox"
								aria-expanded={statusOpen}
								className="h-9 w-auto shrink-0 justify-between gap-1"
							>
								Status
								{selectedStatuses.length > 0 && (
									<span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--primary)] px-1.5 font-semibold text-[10px] text-white">
										{selectedStatuses.length}
									</span>
								)}
								<ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[200px] p-1" align="start">
							{selectedStatuses.length > 0 && (
								<button
									type="button"
									onClick={() => setStatusFilter([])}
									className="flex w-full items-center rounded-sm px-2 py-1.5 text-[var(--muted-foreground)] text-sm hover:bg-[var(--accent)]"
								>
									<X className="mr-2 h-4 w-4" />
									Clear
								</button>
							)}
							{STATUS_OPTIONS.map((opt) => {
								const isSelected = selectedStatuses.includes(opt.value);
								return (
									<button
										key={opt.value}
										type="button"
										onClick={() => toggleStatus(opt.value)}
										className="flex w-full items-center rounded-sm px-2 py-1.5 text-[var(--foreground)] text-sm hover:bg-[var(--accent)]"
									>
										<Check
											className={cn(
												"mr-2 h-4 w-4",
												isSelected ? "opacity-100" : "opacity-0",
											)}
										/>
										{opt.label}
									</button>
								);
							})}
						</PopoverContent>
					</Popover>
				)}

				{/* Issue-date range */}
				<div className="flex items-center gap-2 text-[var(--muted-foreground)] text-sm">
					<CalendarDays size={16} className="shrink-0" />
					<Input
						type="date"
						aria-label="Issued on or after"
						value={startParam}
						max={endParam || undefined}
						onChange={(e) => syncUrl({ start: e.target.value || undefined })}
						className="h-9 w-auto shrink-0"
					/>
					<span>–</span>
					<Input
						type="date"
						aria-label="Issued on or before"
						value={endParam}
						min={startParam || undefined}
						onChange={(e) => syncUrl({ end: e.target.value || undefined })}
						className="h-9 w-auto shrink-0"
					/>
				</div>

				{hasActiveFilters && (
					<Button
						variant="ghost"
						size="sm"
						onClick={clearAllFilters}
						className="h-9 shrink-0 gap-1 text-[var(--muted-foreground)]"
					>
						<X size={14} />
						Clear filters
					</Button>
				)}
			</div>

			{isLoading ? (
				<div className="space-y-2">
					<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
					<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
					<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
				</div>
			) : error ? (
				<p className="text-[var(--muted-foreground)] text-sm">
					{error.message}
				</p>
			) : rows.length === 0 ? (
				<p className="text-[var(--muted-foreground)] text-sm">
					{hasActiveFilters
						? "No invoices match your filters."
						: "No invoices yet."}
				</p>
			) : (
				<div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)]">
					<table className="w-full text-sm">
						<thead className="bg-[var(--muted)] text-[var(--muted-foreground)] text-xs">
							<tr>
								<th className="px-3 py-2 text-left font-medium">Invoice</th>
								<th className="px-3 py-2 text-left font-medium">Date</th>
								<th className="px-3 py-2 text-left font-medium">Member</th>
								<th className="px-3 py-2 text-left font-medium">Billed to</th>
								<th className="px-3 py-2 text-left font-medium">Status</th>
								<th className="px-3 py-2 text-right font-medium">Total</th>
								<th className="px-3 py-2 text-right font-medium">Balance</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((inv) => (
								<tr
									key={inv.invoiceId}
									className="border-[var(--border)] border-t"
								>
									<td className="px-3 py-2 font-mono text-xs">
										<Link
											href={`/admin/invoices/${inv.invoiceId}`}
											className="text-[var(--primary)] underline-offset-2 hover:underline"
										>
											{inv.invoiceNumber}
										</Link>
									</td>
									<td className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
										{formatDate(inv.issueDate)}
									</td>
									<td className="px-3 py-2">
										<Link
											href={`/clients/${inv.consumer.userId}`}
											className="text-[var(--foreground)] underline-offset-2 hover:underline"
										>
											{formatPersonName(inv.consumer)}
										</Link>
									</td>
									<td className="px-3 py-2">
										{inv.billedTo ? (
											<Link
												href={`/clients/${inv.billedTo.userId}`}
												className="text-[var(--muted-foreground)] underline-offset-2 hover:underline"
											>
												{formatPersonName(inv.billedTo)}
											</Link>
										) : (
											<span className="text-[var(--muted-foreground)]">—</span>
										)}
									</td>
									<td className="px-3 py-2">
										<InvoiceStatusPill
											inv={{
												status: inv.status,
												closedAt: inv.closedAt,
												dueDate: inv.dueDate,
												balanceInCents: inv.balanceInCents,
											}}
											audience="staff"
										/>
									</td>
									<td className="px-3 py-2 text-right font-mono text-[var(--foreground)] text-xs">
										{formatCents(inv.totalInCents)}
									</td>
									<td className="px-3 py-2 text-right font-mono text-xs">
										{inv.balanceInCents < 0 ? (
											<span className="text-emerald-700 dark:text-emerald-400">
												{formatCents(Math.abs(inv.balanceInCents))} cr
											</span>
										) : (
											<span
												className={
													inv.balanceInCents > 0
														? "font-semibold text-[var(--foreground)]"
														: "text-[var(--muted-foreground)]"
												}
											>
												{formatCents(inv.balanceInCents)}
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{hasNextPage && (
				<div className="flex justify-center">
					<Button
						variant="outline"
						size="sm"
						onClick={() => fetchNextPage()}
						disabled={isFetching}
					>
						{isFetching ? "Loading…" : "Load more"}
					</Button>
				</div>
			)}
		</div>
	);
}
