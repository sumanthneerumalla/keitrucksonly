"use client";

import { Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import {
	type InvoiceStatusTone,
	invoiceStatusDisplay,
} from "~/lib/invoiceStatus";
import { formatCents } from "~/lib/money";
import { api } from "~/trpc/react";
import AddChargeModal from "./AddChargeModal";
import RecordPaymentModal from "./RecordPaymentModal";
import UncoveredEventsCard from "./UncoveredEventsCard";

/**
 * Phase 9-EOD billing panel (2026-05-02), extended for Phase 9a (C11 + signed
 * credit display), Round 4 (manual close-tab), and Round 5 (bill-to context).
 *
 * Shows three rollup numbers + invoice list. Existing pre-2026-05-02
 * MemberPackage rows have no invoice (line-in-the-sand) and contribute $0;
 * new package sales append a line item to the member's running-tab invoice.
 *
 * Phase 9a additions:
 *  - "Record Payment" action on each open/partially_paid/paid/overdue invoice
 *    row, opening a slide-out RecordPaymentModal.
 *  - Signed-credit display (decision 104, Version A overpayment): when an
 *    invoice balance goes negative, render it as "(credit)" in a neutral tone
 *    rather than a red number. The backend un-floor lives in `billing.ts`
 *    (backlog B8).
 *
 * Phase 9a Round 4 additions (status relabel):
 *  - "Mark as due" action on each open/partially_paid invoice that isn't
 *    already marked due. Fires a balance-aware AlertDialog before calling
 *    `billing.closeInvoice` (which internally stamps closedAt/closedBy +
 *    dueDate = now). Paid invoices auto-settle server-side on full payment,
 *    so the button is omitted for them. The word "closed" never reaches the
 *    UI — staff see "Mark as due" and a "Due" pill (src/lib/invoiceStatus.ts).
 *  - "due [date]" subtext under the status pill when an invoice has been
 *    marked due and still carries a positive balance.
 *
 * Phase 9a Round 5 additions:
 *  - Invoice list is now widened server-side to include rows where the viewed
 *    user is EITHER the consumer OR the billed-to party. We annotate each row
 *    under the invoice number so staff can see at a glance whether the row is
 *    a self-pay invoice ("billed to <other>" when this user is the consumer
 *    but someone else pays) or a third-party payment ("for <consumer>" when
 *    this user is the payer for someone else's package). Self-pay rows
 *    (consumer === viewed user, no separate billed-to) get no annotation.
 */

interface BillingPanelProps {
	userId: string;
	/**
	 * Who's looking at the panel — controls which actions + sections render.
	 * `"staff"` (default) is the full client-profile view (Add charge, Needs
	 * billing card, Record Payment / Mark as due actions). `"member"` is the
	 * read-only self-service view rendered on the member's own /invoices page
	 * (rollups + invoice list + click-into-detail only; no staff actions,
	 * void rows hidden, invoice-detail links route to /invoices/[id] instead
	 * of /clients/[userId]/invoices/[id]).
	 */
	audience?: "staff" | "member";
}

type InvoiceRow = {
	invoiceId: string;
	invoiceNumber: string;
	totalInCents: number;
	amountPaidInCents: number;
	balanceInCents: number;
};

function formatDate(date: Date | string): string {
	return new Date(date).toLocaleDateString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatPersonName(p: {
	firstName: string | null;
	lastName: string | null;
}): string {
	const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
	return name || "(no name)";
}

/**
 * Decide what (if anything) to show under the invoice number, based on how
 * the viewed user relates to this invoice's consumer + billed-to fields. The
 * server widens results to rows where the viewed user is EITHER side, so
 * there are three observable cases:
 *
 *   - viewed user is the consumer and no separate billed-to: self-pay, no annotation
 *   - viewed user is the consumer but someone else pays: "billed to <payer>"
 *   - viewed user is the payer for someone else's consumer: "for <consumer>"
 */
function annotationFor(
	viewedUserId: string,
	inv: {
		billedToUserId: string | null;
		consumer: {
			userId: string;
			firstName: string | null;
			lastName: string | null;
		};
		billedTo: {
			userId: string;
			firstName: string | null;
			lastName: string | null;
		} | null;
	},
): string | null {
	if (inv.consumer.userId === viewedUserId) {
		// Viewed user is the consumer. Only annotate when a different user
		// pays. Self-pay (billedToUserId null or equal to consumer) is the
		// default — no annotation needed.
		if (
			inv.billedToUserId !== null &&
			inv.billedToUserId !== viewedUserId &&
			inv.billedTo
		) {
			return `billed to ${formatPersonName(inv.billedTo)}`;
		}
		return null;
	}
	// Viewed user is NOT the consumer — they must be the bill-to party for the
	// row to surface in this query. Annotate with the consumer's name.
	if (inv.billedToUserId === viewedUserId) {
		return `for ${formatPersonName(inv.consumer)}`;
	}
	// Defensive: shouldn't reach here given the server-side OR clause, but
	// returning null is safe — we just skip the annotation.
	return null;
}

// Pill colors keyed by the DERIVED tone (src/lib/invoiceStatus.ts), not the
// stored status — so "Paid" and "Credit" share the success green, "Due" warns
// amber, open/partially-paid tabs read neutral blue, and void/draft sit muted.
const TONE_PILL_STYLES: Record<InvoiceStatusTone, string> = {
	success:
		"bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
	warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
	neutral: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300",
	muted: "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

const PAYMENT_ELIGIBLE_STATUSES = new Set(["open", "partially_paid", "paid"]);

function StatusPill({
	label,
	tone,
}: {
	label: string;
	tone: InvoiceStatusTone;
}) {
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs ${TONE_PILL_STYLES[tone]}`}
		>
			{label}
		</span>
	);
}

export default function BillingPanel({
	userId,
	audience = "staff",
}: BillingPanelProps) {
	const isStaff = audience === "staff";
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
	const [addChargeOpen, setAddChargeOpen] = useState(false);

	const closeInvoiceMutation = api.billing.closeInvoice.useMutation({
		onSuccess: async (result) => {
			const invoiceNumber =
				closeTarget?.invoice.invoiceNumber ?? result.invoice.invoiceId;
			toast(`Invoice ${invoiceNumber} marked as due`, "success");
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

	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h4 className="flex items-center gap-2 font-semibold text-[var(--foreground)] text-sm">
					<Receipt size={14} />
					{isStaff ? "Billing" : "Your invoices"}
				</h4>
				{isStaff && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setAddChargeOpen(true)}
					>
						Add charge
					</Button>
				)}
			</div>

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
					<BalanceSummary data={data} />

					{isStaff && <UncoveredEventsCard userId={userId} />}

					{data.invoices.length === 0 ? (
						<p className="text-[var(--muted-foreground)] text-xs">
							{isStaff
								? "No invoices yet. Selling a package will create one."
								: "You don't have any invoices yet."}
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
										{isStaff && (
											<th className="px-3 py-2 text-right font-medium">
												Actions
											</th>
										)}
									</tr>
								</thead>
								<tbody>
									{data.invoices.map((inv) => {
										const canRecordPayment = PAYMENT_ELIGIBLE_STATUSES.has(
											inv.status,
										);
										// Single source of truth for the status label + tone
										// (src/lib/invoiceStatus.ts). Staff audience, so a voided
										// invoice reads "Voided" rather than being hidden.
										const statusDisplay = invoiceStatusDisplay(
											{
												status: inv.status,
												closedAt: inv.closedAt,
												dueDate: inv.dueDate,
												balanceInCents: inv.balanceInCents,
											},
											audience,
										);
										// Members never see voided invoices (per
										// invoiceStatusDisplay's `hiddenFromMember` contract).
										if (!isStaff && statusDisplay.hiddenFromMember) {
											return null;
										}
										// Round 4 "mark as due" gating mirrors the backend
										// contract: not void / paid / draft, and not already
										// marked due. Paid invoices auto-settle server-side on
										// full payment, so the button never appears on them.
										const canMarkDue =
											inv.status !== "void" &&
											inv.status !== "paid" &&
											inv.status !== "draft" &&
											inv.closedAt === null;
										// Surface the marked-due date only while a balance is
										// still owed (i.e. the pill reads "Due").
										const showDueDate =
											inv.closedAt !== null &&
											inv.balanceInCents > 0 &&
											inv.status !== "void";
										const annotation = annotationFor(userId, inv);
										return (
											<tr
												key={inv.invoiceId}
												className="border-[var(--border)] border-t"
											>
												<td className="px-3 py-2 font-mono text-[var(--foreground)] text-xs">
													<Link
														href={
															isStaff
																? `/clients/${userId}/invoices/${inv.invoiceId}`
																: `/invoices/${inv.invoiceId}`
														}
														className="text-[var(--primary)] underline-offset-2 hover:underline"
													>
														{inv.invoiceNumber}
													</Link>
													{annotation && (
														<div className="mt-0.5 font-sans text-[var(--muted-foreground)] text-xs italic">
															{annotation}
														</div>
													)}
												</td>
												<td className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
													{formatDate(inv.issueDate)}
												</td>
												<td className="px-3 py-2">
													<div className="flex flex-col gap-1">
														<StatusPill
															label={statusDisplay.label}
															tone={statusDisplay.tone}
														/>
														{showDueDate && inv.dueDate !== null && (
															<span className="text-[var(--muted-foreground)] text-xs">
																due {formatDate(inv.dueDate)}
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
														<div className="flex flex-col items-end">
															<span>
																{formatCents(Math.abs(inv.balanceInCents))}{" "}
																<span className="text-[var(--muted-foreground)]">
																	(credit)
																</span>
															</span>
															{inv.availableCreditInCents <
																Math.abs(inv.balanceInCents) && (
																<span className="text-[11px] text-[var(--muted-foreground)] italic">
																	{inv.availableCreditInCents > 0
																		? `${formatCents(inv.availableCreditInCents)} available`
																		: "fully applied"}
																</span>
															)}
														</div>
													) : (
														formatCents(inv.balanceInCents)
													)}
												</td>
												{isStaff && (
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
															{canMarkDue ? (
																<Button
																	variant="outline"
																	size="sm"
																	onClick={() =>
																		setCloseTarget({
																			invoice: {
																				invoiceId: inv.invoiceId,
																				invoiceNumber: inv.invoiceNumber,
																				totalInCents: inv.totalInCents,
																				amountPaidInCents:
																					inv.amountPaidInCents,
																				balanceInCents: inv.balanceInCents,
																			},
																		})
																	}
																>
																	Mark as due
																</Button>
															) : null}
														</div>
													</td>
												)}
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</>
			)}

			{isStaff && (
				<>
					<RecordPaymentModal
						open={paymentInvoice !== null}
						onOpenChange={(o) => {
							if (!o) setPaymentInvoice(null);
						}}
						userId={userId}
						invoice={paymentInvoice}
					/>

					<AddChargeModal
						open={addChargeOpen}
						onOpenChange={setAddChargeOpen}
						userId={userId}
					/>

					<AlertDialog
						open={closeTarget !== null}
						title={
							closeTarget
								? `Mark as due — Invoice ${closeTarget.invoice.invoiceNumber}`
								: ""
						}
						description={
							closeTarget
								? closeTarget.invoice.balanceInCents > 0
									? `Member still owes ${formatCents(closeTarget.invoice.balanceInCents)}. Mark this invoice as due? They can still pay the balance later, but new charges will start a fresh invoice.`
									: "Mark this invoice as due? No new charges will be added, and any account credit carries forward to the next invoice."
								: ""
						}
						confirmLabel={closing ? "Marking…" : "Mark as due"}
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
				</>
			)}
		</div>
	);
}

// Simplified balance summary — the older big-number tile layout. We
// deliberately show only the three numbers staff act on: what's owed
// (Outstanding), what credit is on file (Available credit), and the net after
// applying that credit (Net owed). The backend still returns totalBilled /
// totalPaid / billedToOthers / creditApplied — we can surface "total billed,
// paid, and credited to/from others" here later when we're ready.
function BalanceSummary({
	data,
}: {
	data: { outstandingInCents: number; availableCreditInCents: number };
}) {
	const netOwed = Math.max(
		0,
		data.outstandingInCents - data.availableCreditInCents,
	);
	return (
		<div className="mb-4 grid grid-cols-3 gap-3">
			<RollupTile
				label="Outstanding balance"
				value={formatCents(data.outstandingInCents)}
				valueClassName={
					data.outstandingInCents > 0
						? "text-[var(--foreground)]"
						: "text-[var(--muted-foreground)]"
				}
			/>
			<RollupTile
				label="Available credit"
				value={formatCents(data.availableCreditInCents)}
				valueClassName={
					data.availableCreditInCents > 0
						? "text-emerald-700 dark:text-emerald-400"
						: "text-[var(--muted-foreground)]"
				}
			/>
			<RollupTile
				label="Net owed"
				value={formatCents(netOwed)}
				valueClassName={
					netOwed > 0
						? "text-red-700 dark:text-red-400"
						: "text-[var(--muted-foreground)]"
				}
			/>
		</div>
	);
}

function RollupTile({
	label,
	value,
	valueClassName,
}: {
	label: string;
	value: string;
	/** Override the value color (e.g. red for owed, emerald for credit). */
	valueClassName?: string;
}) {
	return (
		<div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
			<div className="text-[var(--muted-foreground)] text-xs">{label}</div>
			<div
				className={`mt-1 font-semibold text-lg ${
					valueClassName ?? "text-[var(--foreground)]"
				}`}
			>
				{value}
			</div>
		</div>
	);
}
