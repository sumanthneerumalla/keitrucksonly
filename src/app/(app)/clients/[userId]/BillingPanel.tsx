"use client";

import { Receipt } from "lucide-react";
import { useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";
import RecordPaymentModal from "./RecordPaymentModal";

/**
 * Phase 9-EOD billing panel (2026-05-02), extended for Phase 9a (C11 + signed
 * credit display) and Phase 9a Round 4 (manual close-tab action).
 *
 * Shows three rollup numbers + invoice list. Existing pre-2026-05-02
 * MemberPackage rows have no invoice (line-in-the-sand) and contribute $0;
 * new package sales append a line item to the member's running-tab invoice.
 *
 * Phase 9a additions:
 *  - "Record Payment" action on each open/partially_paid/paid/overdue invoice
 *    row, opening a slide-out RecordPaymentModal.
 *  - Signed-credit display (decision 104, Version A overpayment): when the
 *    invoice balance or overall outstanding goes negative, render it as
 *    "Account credit" / "(credit)" in a neutral tone rather than a red number.
 *    The backend un-floor lives in `billing.ts` (backlog B8) — this UI is
 *    forward-compatible: while the floor remains, balances simply never go
 *    negative; once removed, credit surfaces here without further UI changes.
 *
 * Phase 9a Round 4 additions:
 *  - "Close Tab" action on each open/partially_paid/overdue invoice that
 *    isn't already closed. Fires a balance-aware AlertDialog before calling
 *    `billing.closeInvoice`. Paid invoices auto-close server-side on full
 *    payment, so the button is omitted for them.
 *  - "Closed [date]" badge under the StatusPill when `inv.closedAt !== null`.
 */

interface BillingPanelProps {
	userId: string;
}

type InvoiceRow = {
	invoiceId: string;
	invoiceNumber: string;
	totalInCents: number;
	amountPaidInCents: number;
	balanceInCents: number;
};

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

const PAYMENT_ELIGIBLE_STATUSES = new Set([
	"open",
	"partially_paid",
	"paid",
	"overdue",
]);

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
	const { toast } = useToast();
	const utils = api.useUtils();

	const { data, isLoading, error } = api.billing.getMemberBilling.useQuery(
		{ userId },
		{ enabled: !!userId },
	);

	const [paymentInvoice, setPaymentInvoice] = useState<InvoiceRow | null>(null);
	// Close-tab confirmation target — when non-null, the AlertDialog is open
	// for this invoice. Stored as a snapshot so the dialog copy stays stable
	// while the mutation runs (the underlying row may flip to closed mid-flight).
	const [closeTarget, setCloseTarget] = useState<{
		invoice: InvoiceRow;
	} | null>(null);

	const closeInvoiceMutation = api.billing.closeInvoice.useMutation({
		onSuccess: async (result) => {
			const invoiceNumber =
				closeTarget?.invoice.invoiceNumber ?? result.invoice.invoiceId;
			toast(`Invoice ${invoiceNumber} closed`, "success");
			await utils.billing.getMemberBilling.invalidate({ userId });
			setCloseTarget(null);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	// Matches RecordPaymentModal's pattern: tRPC's `isPending` is the single
	// source of truth for the in-flight flag — no separate useState to drift.
	const closing = closeInvoiceMutation.isPending;

	// Derive the outstanding-tile presentation from the (potentially signed)
	// `outstandingInCents`. When `< 0`, the club holds member credit — neutral
	// tone, "Account credit" label. When `> 0`, money owed — red emphasis.
	// When `= 0`, neutral.
	const outstandingDisplay = (() => {
		if (!data)
			return { label: "Outstanding", value: formatCents(0), emphasize: false };
		const cents = data.outstandingInCents;
		if (cents < 0) {
			return {
				label: "Account credit",
				value: formatCents(Math.abs(cents)),
				emphasize: false,
			};
		}
		return {
			label: "Outstanding",
			value: formatCents(cents),
			emphasize: cents > 0,
		};
	})();

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
							label={outstandingDisplay.label}
							value={outstandingDisplay.value}
							emphasize={outstandingDisplay.emphasize}
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
										<th className="px-3 py-2 text-right font-medium">
											Actions
										</th>
									</tr>
								</thead>
								<tbody>
									{data.invoices.map((inv) => {
										const canRecordPayment = PAYMENT_ELIGIBLE_STATUSES.has(
											inv.status,
										);
										// Round 4 close-tab gating mirrors the backend contract:
										// not void / paid / draft, and not already closed. Paid
										// invoices auto-close server-side on full payment, so the
										// button never needs to appear on them.
										const canCloseTab =
											inv.status !== "void" &&
											inv.status !== "paid" &&
											inv.status !== "draft" &&
											inv.closedAt === null;
										return (
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
													<div className="flex flex-col gap-1">
														<StatusPill status={inv.status} />
														{inv.closedAt !== null && (
															<span className="text-[var(--muted-foreground)] text-xs">
																Closed {formatDate(inv.closedAt)}
															</span>
														)}
													</div>
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
													{inv.balanceInCents < 0 ? (
														<>
															{formatCents(Math.abs(inv.balanceInCents))}{" "}
															<span className="text-[var(--muted-foreground)]">
																(credit)
															</span>
														</>
													) : (
														formatCents(inv.balanceInCents)
													)}
												</td>
												<td className="px-3 py-2 text-right">
													<div className="flex flex-col items-end gap-1">
														{canRecordPayment ? (
															<Button
																variant="outline"
																size="sm"
																onClick={() =>
																	setPaymentInvoice({
																		invoiceId: inv.invoiceId,
																		invoiceNumber: inv.invoiceNumber,
																		totalInCents: inv.totalInCents,
																		amountPaidInCents: inv.amountPaidInCents,
																		balanceInCents: inv.balanceInCents,
																	})
																}
															>
																Record Payment
															</Button>
														) : null}
														{canCloseTab ? (
															<Button
																variant="outline"
																size="sm"
																onClick={() =>
																	setCloseTarget({
																		invoice: {
																			invoiceId: inv.invoiceId,
																			invoiceNumber: inv.invoiceNumber,
																			totalInCents: inv.totalInCents,
																			amountPaidInCents: inv.amountPaidInCents,
																			balanceInCents: inv.balanceInCents,
																		},
																	})
																}
															>
																Close Tab
															</Button>
														) : null}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</>
			)}

			<RecordPaymentModal
				open={paymentInvoice !== null}
				onOpenChange={(o) => {
					if (!o) setPaymentInvoice(null);
				}}
				userId={userId}
				invoice={paymentInvoice}
			/>

			<AlertDialog
				open={closeTarget !== null}
				title={
					closeTarget
						? `Close Tab — Invoice ${closeTarget.invoice.invoiceNumber}`
						: ""
				}
				description={
					closeTarget
						? closeTarget.invoice.balanceInCents > 0
							? `Member still owes ${formatCents(closeTarget.invoice.balanceInCents)}. Close anyway? They can still pay this balance later, but new charges will start a fresh invoice.`
							: "Close this tab? No new charges will be added."
						: ""
				}
				confirmLabel={closing ? "Closing…" : "Close Tab"}
				cancelLabel="Cancel"
				onConfirm={() => {
					if (!closeTarget || closing) return;
					closeInvoiceMutation.mutate({
						invoiceId: closeTarget.invoice.invoiceId,
					});
				}}
				onCancel={() => {
					if (closing) return;
					setCloseTarget(null);
				}}
			/>
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
