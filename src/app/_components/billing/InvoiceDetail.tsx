"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import RecordPaymentModal from "~/app/(app)/clients/[userId]/RecordPaymentModal";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import {
	type InvoiceAudience,
	type InvoiceStatusTone,
	invoiceStatusDisplay,
} from "~/lib/invoiceStatus";
import { formatCents } from "~/lib/money";
import { api } from "~/trpc/react";

/**
 * Phase 9a (C14) — shared invoice detail view. This is the page where line
 * items finally RENDER to a human (the BillingPanel only shows per-invoice
 * rollups). ONE component backs every detail route:
 *   - staff:  /clients/[userId]/invoices/[invoiceId]  (drill-down from BillingPanel)
 *   - staff:  /admin/invoices/[invoiceId]
 *   - member: (future) — pass audience="member"
 *
 * `audience` (not the route) decides the labelling + which controls show:
 * staff see revenue categories, who-received-payment, internal action buttons,
 * and operational status words ("Open tab", "Due"); members see member-facing
 * wording and no staff actions. The data + authorization come from the single
 * `billing.getInvoice` query (consumer OR payer OR same-club staff).
 *
 * Money is signed end to end — a negative balance is account CREDIT, a negative
 * line total is a carried-forward credit line. The status label is derived in
 * one place (src/lib/invoiceStatus.ts); the word "closed" never reaches the UI.
 */

// Line-item `kind` (InvoiceLineItemKind) → short badge label. Record<string>
// (not the enum type) so an unmapped future value still renders via the
// `?? kind` fallback rather than throwing.
const KIND_LABELS: Record<string, string> = {
	PACKAGE_SALE: "Package",
	CREDIT: "Credit",
	PRODUCT_SALE: "Product",
	FEE: "Fee",
	EVENT_REGISTRATION: "Event",
	RENTAL: "Rental",
	MEMBERSHIP_FEE: "Membership",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
	cash: "Cash",
	check: "Check",
	credit_card: "Credit card",
	pos_transaction: "POS transaction",
	stripe: "Stripe",
	paysafe: "Paysafe",
	other: "Other",
};

const TONE_PILL_STYLES: Record<InvoiceStatusTone, string> = {
	success:
		"bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
	warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
	neutral: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300",
	muted: "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

// Statuses on which staff may still record a payment (overpaying a `paid`
// invoice adds account credit — Version A). Mirrors BillingPanel.
const PAYMENT_ELIGIBLE_STATUSES = new Set(["open", "partially_paid", "paid"]);

function formatDate(date: Date | string): string {
	return new Date(date).toLocaleDateString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatDateTime(date: Date | string): string {
	return new Date(date).toLocaleString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatPersonName(p: {
	firstName: string | null;
	lastName: string | null;
}): string {
	const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
	return name || "(no name)";
}

/** Render an amount that may be negative (credit) without a bare "-$". */
function signedCents(cents: number): string {
	return cents < 0 ? `−${formatCents(Math.abs(cents))}` : formatCents(cents);
}

interface InvoiceDetailProps {
	invoiceId: string;
	audience: InvoiceAudience;
	/** Optional "back" target (e.g. the client page the staff drilled in from). */
	backHref?: string;
}

export default function InvoiceDetail({
	invoiceId,
	audience,
	backHref,
}: InvoiceDetailProps) {
	const { toast } = useToast();
	const utils = api.useUtils();
	const isStaff = audience === "staff";

	const {
		data: inv,
		isLoading,
		error,
	} = api.billing.getInvoice.useQuery({ invoiceId });

	const [paymentOpen, setPaymentOpen] = useState(false);
	const [markDueOpen, setMarkDueOpen] = useState(false);

	const closeInvoiceMutation = api.billing.closeInvoice.useMutation({
		onSuccess: async () => {
			toast(`Invoice ${inv?.invoiceNumber ?? ""} marked as due`, "success");
			// Refresh this page's query + any cached BillingPanels (consumer's and,
			// when bill-to differs, the payer's).
			await Promise.all([
				utils.billing.getInvoice.invalidate({ invoiceId }),
				inv
					? utils.billing.getMemberBilling.invalidate({
							userId: inv.consumer.userId,
						})
					: Promise.resolve(),
				inv?.billedTo
					? utils.billing.getMemberBilling.invalidate({
							userId: inv.billedTo.userId,
						})
					: Promise.resolve(),
			]);
			setMarkDueOpen(false);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});
	const marking = closeInvoiceMutation.isPending;

	if (isLoading) {
		return (
			<div className="mx-auto max-w-4xl space-y-6 p-6">
				<div className="h-8 w-40 animate-pulse rounded bg-[var(--muted)]" />
				<div className="h-32 animate-pulse rounded-lg bg-[var(--muted)]" />
				<div className="h-64 animate-pulse rounded-lg bg-[var(--muted)]" />
				<div className="h-40 animate-pulse rounded-lg bg-[var(--muted)]" />
			</div>
		);
	}

	if (error || !inv) {
		return (
			<div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-3 p-12 text-center">
				<p className="text-[var(--foreground)] text-sm">
					{error?.message ?? "Invoice not found."}
				</p>
				{backHref && (
					<Button asChild variant="outline" size="sm">
						<Link href={backHref}>Go back</Link>
					</Button>
				)}
			</div>
		);
	}

	// Member-facing guard: void invoices are hidden from members entirely.
	const statusDisplay = invoiceStatusDisplay(
		{
			status: inv.status,
			closedAt: inv.closedAt,
			dueDate: inv.dueDate,
			balanceInCents: inv.balanceInCents,
		},
		audience,
	);
	if (!isStaff && statusDisplay.hiddenFromMember) {
		return (
			<div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-3 p-12 text-center">
				<p className="text-[var(--foreground)] text-sm">
					Invoice not available.
				</p>
				{backHref && (
					<Button asChild variant="outline" size="sm">
						<Link href={backHref}>Go back</Link>
					</Button>
				)}
			</div>
		);
	}

	const hasSeparatePayer =
		inv.billedTo !== null && inv.billedTo.userId !== inv.consumer.userId;
	const isCredit = inv.balanceInCents < 0;

	// Action gating (staff only). Mirrors the BillingPanel contract.
	const canRecordPayment = isStaff && PAYMENT_ELIGIBLE_STATUSES.has(inv.status);
	const canMarkDue =
		isStaff &&
		inv.status !== "void" &&
		inv.status !== "paid" &&
		inv.status !== "draft" &&
		inv.closedAt === null;

	return (
		<div className="mx-auto max-w-4xl space-y-6 p-6">
			{/* Top bar */}
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					{backHref && (
						<Link
							href={backHref}
							className="inline-flex items-center gap-1 text-[var(--muted-foreground)] text-xs transition-colors hover:text-[var(--foreground)]"
						>
							<ArrowLeft size={14} />
							Back
						</Link>
					)}
					<div className="flex items-center gap-3">
						<h1 className="font-semibold text-[var(--foreground)] text-xl">
							Invoice {inv.invoiceNumber}
						</h1>
						<span
							className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs ${TONE_PILL_STYLES[statusDisplay.tone]}`}
						>
							{statusDisplay.label}
						</span>
					</div>
				</div>

				{/* Actions (staff) */}
				{(canRecordPayment || canMarkDue) && (
					<div className="flex items-center gap-2">
						{canRecordPayment && (
							<Button
								variant="default"
								size="sm"
								onClick={() => setPaymentOpen(true)}
							>
								Record Payment
							</Button>
						)}
						{canMarkDue && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setMarkDueOpen(true)}
							>
								Mark as due
							</Button>
						)}
					</div>
				)}
			</div>

			{/* Meta + parties */}
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
						<dt className="text-[var(--muted-foreground)]">Issued</dt>
						<dd className="text-right text-[var(--foreground)]">
							{formatDate(inv.issueDate)}
						</dd>
						{inv.dueDate && (
							<>
								<dt className="text-[var(--muted-foreground)]">Due</dt>
								<dd className="text-right text-[var(--foreground)]">
									{formatDate(inv.dueDate)}
								</dd>
							</>
						)}
						{isStaff && inv.closedBy && inv.closedAt && (
							<>
								<dt className="text-[var(--muted-foreground)]">
									Marked due by
								</dt>
								<dd className="text-right text-[var(--foreground)]">
									{formatPersonName(inv.closedBy)}
								</dd>
							</>
						)}
					</dl>
				</div>

				<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
					{hasSeparatePayer && inv.billedTo ? (
						<dl className="space-y-2">
							<div>
								<dt className="text-[var(--muted-foreground)] text-xs">
									Bill to
								</dt>
								<dd className="text-[var(--foreground)]">
									{formatPersonName(inv.billedTo)}
									{isStaff && inv.billedTo.email && (
										<span className="text-[var(--muted-foreground)]">
											{" "}
											· {inv.billedTo.email}
										</span>
									)}
								</dd>
							</div>
							<div>
								<dt className="text-[var(--muted-foreground)] text-xs">For</dt>
								<dd className="text-[var(--foreground)]">
									{formatPersonName(inv.consumer)}
								</dd>
							</div>
						</dl>
					) : (
						<dl className="space-y-2">
							<div>
								<dt className="text-[var(--muted-foreground)] text-xs">
									Member
								</dt>
								<dd className="text-[var(--foreground)]">
									{formatPersonName(inv.consumer)}
									{isStaff && inv.consumer.email && (
										<span className="text-[var(--muted-foreground)]">
											{" "}
											· {inv.consumer.email}
										</span>
									)}
								</dd>
							</div>
						</dl>
					)}
				</div>
			</div>

			{/* Line items */}
			<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
				<table className="w-full text-sm">
					<thead className="bg-[var(--muted)] text-[var(--muted-foreground)] text-xs">
						<tr>
							<th className="px-4 py-2 text-left font-medium">Description</th>
							<th className="px-4 py-2 text-right font-medium">Qty</th>
							<th className="px-4 py-2 text-right font-medium">Unit</th>
							<th className="px-4 py-2 text-right font-medium">Amount</th>
						</tr>
					</thead>
					<tbody>
						{inv.lineItems.length === 0 ? (
							<tr>
								<td
									colSpan={4}
									className="px-4 py-6 text-center text-[var(--muted-foreground)] text-xs"
								>
									No line items on this invoice.
								</td>
							</tr>
						) : (
							inv.lineItems.map((li) => (
								<tr
									key={li.lineItemId}
									className="border-[var(--border)] border-t align-top"
								>
									<td className="px-4 py-3">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-[var(--foreground)]">
												{li.description}
											</span>
											<span className="inline-flex items-center rounded-full bg-[var(--muted)] px-2 py-0.5 text-[var(--muted-foreground)] text-xs">
												{KIND_LABELS[li.kind] ?? li.kind}
											</span>
										</div>
										{/* CREDIT lines name their source person + invoice. */}
										{li.creditFrom && (
											<div className="mt-1 text-[var(--muted-foreground)] text-xs">
												Credit from {formatPersonName(li.creditFrom)}
												{li.creditFromInvoice &&
													` · ${li.creditFromInvoice.invoiceNumber}`}
											</div>
										)}
										{/* Revenue category is an internal classification. */}
										{isStaff && li.revenueCategory && (
											<div className="mt-1 text-[var(--muted-foreground)] text-xs italic">
												{li.revenueCategory.label}
											</div>
										)}
									</td>
									<td className="px-4 py-3 text-right text-[var(--muted-foreground)] tabular-nums">
										{li.quantity}
									</td>
									<td className="px-4 py-3 text-right font-mono text-[var(--muted-foreground)] text-xs">
										{signedCents(li.unitPriceInCents)}
									</td>
									<td className="px-4 py-3 text-right font-mono text-[var(--foreground)]">
										{signedCents(li.totalInCents)}
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>

				{/* Totals */}
				<div className="border-[var(--border)] border-t bg-[var(--background)] px-4 py-3">
					<dl className="ml-auto max-w-xs space-y-1.5 text-sm">
						<div className="flex justify-between">
							<dt className="text-[var(--muted-foreground)]">Subtotal</dt>
							<dd className="font-mono text-[var(--foreground)]">
								{signedCents(inv.subtotalInCents)}
							</dd>
						</div>
						{inv.taxTotalInCents > 0 && (
							<div className="flex justify-between">
								<dt className="text-[var(--muted-foreground)]">Tax</dt>
								<dd className="font-mono text-[var(--foreground)]">
									{formatCents(inv.taxTotalInCents)}
								</dd>
							</div>
						)}
						<div className="flex justify-between border-[var(--border)] border-t pt-1.5 font-semibold">
							<dt className="text-[var(--foreground)]">Total</dt>
							<dd className="font-mono text-[var(--foreground)]">
								{signedCents(inv.totalInCents)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--muted-foreground)]">Paid</dt>
							<dd className="font-mono text-[var(--muted-foreground)]">
								{formatCents(inv.amountPaidInCents)}
							</dd>
						</div>
						<div className="flex justify-between font-semibold">
							<dt className="text-[var(--foreground)]">
								{isCredit ? (isStaff ? "Credit" : "Account credit") : "Balance"}
							</dt>
							<dd
								className={`font-mono ${
									isCredit
										? "text-emerald-700 dark:text-emerald-400"
										: "text-[var(--foreground)]"
								}`}
							>
								{formatCents(Math.abs(inv.balanceInCents))}
							</dd>
						</div>
					</dl>
				</div>
			</div>

			{/* Payments */}
			{inv.payments.length > 0 && (
				<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
					<h2 className="mb-3 font-semibold text-[var(--foreground)] text-sm">
						Payments
					</h2>
					<div className="space-y-2">
						{inv.payments.map((p) => (
							<div
								key={p.paymentId}
								className="flex items-start justify-between gap-3 border-[var(--border)] border-b pb-2 text-sm last:border-b-0 last:pb-0"
							>
								<div className="space-y-0.5">
									<div className="text-[var(--foreground)]">
										{PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}
										{p.processor && (
											<span className="text-[var(--muted-foreground)]">
												{" "}
												· {p.processor}
											</span>
										)}
									</div>
									<div className="text-[var(--muted-foreground)] text-xs">
										{formatDateTime(p.receivedAt)}
										{isStaff && ` · ${formatPersonName(p.receivedBy)}`}
									</div>
									{p.reference && (
										<div className="text-[var(--muted-foreground)] text-xs">
											Ref: {p.reference}
										</div>
									)}
								</div>
								<div className="text-right">
									<div className="font-mono text-[var(--foreground)]">
										{formatCents(p.amountInCents)}
									</div>
									{p.refundedTotalInCents > 0 && (
										<div className="text-[var(--muted-foreground)] text-xs">
											−{formatCents(p.refundedTotalInCents)} refunded · net{" "}
											{formatCents(p.netInCents)}
										</div>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Refunds */}
			{inv.refunds.length > 0 && (
				<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
					<h2 className="mb-3 font-semibold text-[var(--foreground)] text-sm">
						Refunds
					</h2>
					<div className="space-y-2">
						{inv.refunds.map((r) => (
							<div
								key={r.refundId}
								className="flex items-start justify-between gap-3 border-[var(--border)] border-b pb-2 text-sm last:border-b-0 last:pb-0"
							>
								<div className="space-y-0.5">
									<div className="text-[var(--muted-foreground)] text-xs">
										{formatDateTime(r.refundedAt)}
										{isStaff && ` · ${formatPersonName(r.refundedBy)}`}
									</div>
									{r.reason && (
										<div className="text-[var(--foreground)] text-xs">
											{r.reason}
										</div>
									)}
								</div>
								<div className="font-mono text-[var(--foreground)]">
									−{formatCents(r.amountInCents)}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Invoice-level comment (renders on the PDF later). */}
			{inv.notes && (
				<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
					<h2 className="mb-2 font-semibold text-[var(--foreground)] text-sm">
						Notes
					</h2>
					<p className="whitespace-pre-wrap text-[var(--muted-foreground)] text-sm">
						{inv.notes}
					</p>
				</div>
			)}

			{/* Staff action plumbing */}
			{isStaff && (
				<>
					<RecordPaymentModal
						open={paymentOpen}
						onOpenChange={setPaymentOpen}
						userId={inv.consumer.userId}
						invoice={{
							invoiceId: inv.invoiceId,
							invoiceNumber: inv.invoiceNumber,
							totalInCents: inv.totalInCents,
							amountPaidInCents: inv.amountPaidInCents,
							balanceInCents: inv.balanceInCents,
						}}
					/>

					<AlertDialog
						open={markDueOpen}
						title={`Mark as due — Invoice ${inv.invoiceNumber}`}
						description={
							inv.balanceInCents > 0
								? `Member still owes ${formatCents(inv.balanceInCents)}. Mark this invoice as due? They can still pay the balance later, but new charges will start a fresh invoice.`
								: "Mark this invoice as due? No new charges will be added, and any account credit carries forward to the next invoice."
						}
						confirmLabel={marking ? "Marking…" : "Mark as due"}
						cancelLabel="Cancel"
						onConfirm={() => {
							if (marking) return;
							closeInvoiceMutation.mutate({ invoiceId });
						}}
						onCancel={() => {
							if (marking) return;
							setMarkDueOpen(false);
						}}
					/>
				</>
			)}
		</div>
	);
}
