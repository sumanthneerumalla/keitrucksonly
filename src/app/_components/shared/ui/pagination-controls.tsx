/**
 * PaginationControls — shared pagination bar using shadcn Pagination primitives.
 *
 * Usage:
 *   <PaginationControls page={page} pageCount={pageCount} onPageChange={setPage} />
 *
 * Features:
 * - Prev / Next with disabled states
 * - Clickable page numbers with ellipsis for large ranges
 * - "Showing X–Y of Z" summary
 * - Styled with primary color for active page, purple outline for Prev/Next
 *
 * Consumers own the page state (useState or URL search params).
 * This component just renders controls and calls onPageChange.
 */

import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "~/app/_components/shared/ui/pagination";

interface PaginationControlsProps {
	page: number;
	pageCount: number;
	total?: number;
	limit?: number;
	onPageChange: (page: number) => void;
}

/**
 * Build the list of page numbers to display.
 * Always shows first, last, and up to 2 pages around current.
 * Uses null to represent ellipsis gaps.
 */
function getPageNumbers(page: number, pageCount: number): (number | null)[] {
	if (pageCount <= 7) {
		return Array.from({ length: pageCount }, (_, i) => i + 1);
	}

	const pages: (number | null)[] = [1];

	if (page > 3) pages.push(null);

	const start = Math.max(2, page - 1);
	const end = Math.min(pageCount - 1, page + 1);

	for (let i = start; i <= end; i++) {
		pages.push(i);
	}

	if (page < pageCount - 2) pages.push(null);

	pages.push(pageCount);

	return pages;
}

export function PaginationControls({
	page,
	pageCount,
	total,
	limit,
	onPageChange,
}: PaginationControlsProps) {
	if (pageCount <= 1) return null;

	const pages = getPageNumbers(page, pageCount);

	return (
		<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
			{total !== undefined && limit !== undefined ? (
				<span className="text-[var(--muted-foreground)] text-sm">
					Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of{" "}
					{total}
				</span>
			) : (
				<span />
			)}

			<Pagination className="w-auto">
				<PaginationContent>
					<PaginationItem>
						<PaginationPrevious
							onClick={(e) => {
								e.preventDefault();
								if (page > 1) onPageChange(page - 1);
							}}
							className={
								page === 1
									? "pointer-events-none border-gray-200 text-gray-300"
									: "cursor-pointer border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white"
							}
						/>
					</PaginationItem>

					{pages.map((p, i) =>
						p === null ? (
							<PaginationItem key={`ellipsis-${i}`}>
								<PaginationEllipsis />
							</PaginationItem>
						) : (
							<PaginationItem key={p}>
								<PaginationLink
									onClick={(e) => {
										e.preventDefault();
										onPageChange(p);
									}}
									isActive={p === page}
									className={
										p === page
											? "cursor-default border-[var(--primary)] bg-[var(--primary)] text-white hover:bg-[var(--primary)] hover:text-white"
											: "cursor-pointer hover:bg-[var(--accent)]"
									}
								>
									{p}
								</PaginationLink>
							</PaginationItem>
						),
					)}

					<PaginationItem>
						<PaginationNext
							onClick={(e) => {
								e.preventDefault();
								if (page < pageCount) onPageChange(page + 1);
							}}
							className={
								page === pageCount
									? "pointer-events-none border-gray-200 text-gray-300"
									: "cursor-pointer border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white"
							}
						/>
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}
