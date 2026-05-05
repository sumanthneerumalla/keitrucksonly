"use client";

import { Receipt } from "lucide-react";
import { api } from "~/trpc/react";

/**
 * Phase 9-EOD billing panel (2026-05-02).
 *
 * Read-only view: three rollup numbers + invoice list. Existing pre-2026-05-02
 * MemberPackage rows have no invoice (line-in-the-sand) and contribute $0;
 * new package sales append a line item to the member's running-tab invoice.
 */

interface BillingPanelProps {
	userId: string;
}

function formatCents(cents: number): string {
	return (cents / 100).toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
	});
}

function formatDate(date: Date | string): string {
	return new Date(date).toLocaleDateString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

const STATUS_PILL_STYLES: Record<string, string> = {
	open: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
	partially_paid:
		"bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300",
	paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
	overdue: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300",
	void: "bg-[var(--muted)] text-[var(--muted-foreground)]",
	draft: "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

function StatusPill({ status }: { status: string }) {
	const cls =
		STATUS_PILL_STYLES[status] ??
		"bg-[var(--muted)] text-[var(--muted-foreground)]";
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs capitalize ${cls}`}
		>
			{status.replace(/_/g, " ")}
		</span>
	);
}

export default function BillingPanel({ userId }: BillingPanelProps) {
	const { data, isLoading, error } = api.billing.getMemberBilling.useQuery(
		{ userId },
		{ enabled: !!userId },
	);

	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
			<h4 className="mb-3 flex items-center gap-2 font-semibold text-[var(--foreground)] text-sm">
				<Receipt size={14} />
				Billing
			</h4>

			{isLoading && (
				<div className="space-y-3">
					<div className="h-16 animate-pulse rounded bg-[var(--muted)]" />
					<div className="h-12 animate-pulse rounded bg-[var(--muted)]" />
				</div>
			)}

			{error && (
				<p className="text-[var(--muted-foreground)] text-xs">
					{error.message}
				</p>
			)}

			{data && (
				<>
					<div className="mb-4 grid grid-cols-3 gap-3">
						<RollupTile
							label="Total billed"
							value={formatCents(data.totalBilledInCents)}
						/>
						<RollupTile
							label="Total paid"
							value={formatCents(data.totalPaidInCents)}
						/>
						<RollupTile
							label="Outstanding"
							value={formatCents(data.outstandingInCents)}
							emphasize={data.outstandingInCents > 0}
						/>
					</div>

					{data.invoices.length === 0 ? (
						<p className="text-[var(--muted-foreground)] text-xs">
							No invoices yet. Selling a package will create one.
						</p>
					) : (
						<div className="overflow-hidden rounded-md border border-[var(--border)]">
							<table className="w-full text-sm">
								<thead className="bg-[var(--muted)] text-[var(--muted-foreground)] text-xs">
									<tr>
										<th className="px-3 py-2 text-left font-medium">Invoice</th>
										<th className="px-3 py-2 text-left font-medium">Date</th>
										<th className="px-3 py-2 text-left font-medium">Status</th>
										<th className="px-3 py-2 text-right font-medium">Total</th>
										<th className="px-3 py-2 text-right font-medium">Paid</th>
										<th className="px-3 py-2 text-right font-medium">
											Balance
										</th>
									</tr>
								</thead>
								<tbody>
									{data.invoices.map((inv) => (
										<tr
											key={inv.invoiceId}
											className="border-[var(--border)] border-t"
										>
											<td className="px-3 py-2 font-mono text-[var(--foreground)] text-xs">
												{inv.invoiceNumber}
											</td>
											<td className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
												{formatDate(inv.issueDate)}
											</td>
											<td className="px-3 py-2">
												<StatusPill status={inv.status} />
											</td>
											<td className="px-3 py-2 text-right font-mono text-[var(--foreground)] text-xs">
												{formatCents(inv.totalInCents)}
											</td>
											<td className="px-3 py-2 text-right font-mono text-[var(--muted-foreground)] text-xs">
												{formatCents(inv.amountPaidInCents)}
											</td>
											<td
												className={`px-3 py-2 text-right font-mono text-xs ${
													inv.balanceInCents > 0
														? "font-semibold text-[var(--foreground)]"
														: "text-[var(--muted-foreground)]"
												}`}
											>
												{formatCents(inv.balanceInCents)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</>
			)}
		</div>
	);
}

function RollupTile({
	label,
	value,
	emphasize,
}: {
	label: string;
	value: string;
	emphasize?: boolean;
}) {
	return (
		<div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
			<div className="text-[var(--muted-foreground)] text-xs">{label}</div>
			<div
				className={`mt-1 font-semibold text-lg ${
					emphasize
						? "text-red-700 dark:text-red-400"
						: "text-[var(--foreground)]"
				}`}
			>
				{value}
			</div>
		</div>
	);
}
