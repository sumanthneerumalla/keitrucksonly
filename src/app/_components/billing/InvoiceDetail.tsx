"use client";

import { ArrowLeft, CreditCard, Download } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import RecordPaymentModal from "~/app/(app)/clients/[userId]/RecordPaymentModal";
import RefundModal, {
	type RefundContext,
} from "~/app/(app)/clients/[userId]/RefundModal";
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
	/**
	 * Phase 12a Round 3 Stream 6 — whether the invoice's club has a usable
	 * Stripe Connect link (chargesEnabled = true && disconnectedAt = null).
	 * Gates the "Pay $X" button. Resolved server-side by the page rendering
	 * this component (members can't call `payments.getConnectionStatus`,
	 * which is `clubAdminProcedure`); see member + staff page wrappers.
	 * Default `false` so callers that haven't been updated yet stay safe.
	 */
	clubChargesEnabled?: boolean;
}

/**
 * Phase 9b — re-usable "Bill to" / "For" / "Member" block. Renders the
 * name (with a deep-link for staff), email, and phone. The phone field
 * arrives from `billing.getInvoice` via the JSON profileData blob and is
 * null when the member hasn't set it.
 */
function PartyBlock({
	label,
	party,
	isStaff,
}: {
	label: string;
	party: {
		userId: string;
		firstName: string | null;
		lastName: string | null;
		email: string | null;
		phone: string | null;
	};
	isStaff: boolean;
}) {
	return (
		<div>
			<dt className="text-[var(--muted-foreground)] text-xs">{label}</dt>
			<dd className="text-[var(--foreground)]">
				{isStaff ? (
					<Link
						href={`/clients/${party.userId}`}
						className="underline-offset-2 hover:underline"
					>
						{formatPersonName(party)}
					</Link>
				) : (
					formatPersonName(party)
				)}
			</dd>
			{(party.email || party.phone) && (
				<dd className="space-y-0.5 pt-0.5 text-[var(--muted-foreground)] text-xs">
					{party.email && <div>{party.email}</div>}
					{party.phone && <div>{party.phone}</div>}
				</dd>
			)}
		</div>
	);
}

export default function InvoiceDetail({
	invoiceId,
	audience,
	backHref,
	clubChargesEnabled = false,
}: InvoiceDetailProps) {
	const { toast } = useToast();
	const utils = api.useUtils();
	const router = useRouter();
	const isStaff = audience === "staff";

	const {
		data: inv,
		isLoading,
		error,
	} = api.billing.getInvoice.useQuery({ invoiceId });

	const [paymentOpen, setPaymentOpen] = useState(false);
	const [markDueOpen, setMarkDueOpen] = useState(false);
	const [voidOpen, setVoidOpen] = useState(false);
	const [voidReason, setVoidReason] = useState("");
	const [refundCtx, setRefundCtx] = useState<RefundContext | null>(null);

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

	const voidMutation = api.billing.voidInvoice.useMutation({
		onSuccess: async () => {
			toast(`Invoice ${inv?.invoiceNumber ?? ""} voided`, "success");
			// Refresh this page + both parties' BillingPanels + the admin list.
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
				utils.billing.listInvoices.invalidate(),
			]);
			setVoidOpen(false);
			setVoidReason("");
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});
	const voiding = voidMutation.isPending;

	// Phase 12a Round 3 Stream 6 — invoice pay-now. Single click: no
	// BuyerBeneficiaryForm in the middle (the invoice already encodes
	// consumer + billed-to per §7.8.2 invoice-exception). Pushes to
	// `/checkout/[checkoutSessionId]` on success.
	const startInvoiceCheckout = api.payments.startCheckout.invoice.useMutation({
		onSuccess: (result) => {
			router.push(`/checkout/${result.checkoutSessionId}`);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});
	const starting = startInvoiceCheckout.isPending;

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
	// Void is clubAdmin-only and only for a "clean" invoice: no money in (refund
	// first) and no applied account credit. Mirrors the backend guards; the
	// voidInvoice mutation re-checks authoritatively.
	const hasCreditLine = inv.lineItems.some((li) => li.kind === "CREDIT");
	const canVoid =
		isStaff &&
		inv.viewerIsClubAdmin &&
		inv.status !== "void" &&
		inv.amountPaidInCents === 0 &&
		!hasCreditLine;
	// Refund is clubAdmin-only; blocked once this invoice's overpayment credit
	// was consumed elsewhere (D1). Per-payment also requires a positive
	// refundable balance (p.netInCents > 0). The mutation re-checks all of this.
	const canRefund = isStaff && inv.viewerIsClubAdmin && !inv.hasConsumedCredit;

	// Phase 12a Round 3 Stream 6 — "Pay $X" button visibility (§12.1):
	//   - audience is 'member' or 'staff' (admin can ALSO trigger pay-now)
	//   - there's an outstanding (positive) balance
	//   - the invoice isn't void
	//   - the club's Stripe Connect is wired up (chargesEnabled + not disconnected)
	// The server-side `payments.startCheckout.invoice` mutation re-checks all
	// of this authoritatively; the button-visibility gate just avoids showing
	// the user a button that's guaranteed to bounce.
	const outstandingInCents = inv.balanceInCents > 0 ? inv.balanceInCents : 0;
	const canPayNow =
		(audience === "member" || audience === "staff") &&
		outstandingInCents > 0 &&
		inv.status !== "void" &&
		clubChargesEnabled;

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

				{/* Actions. The Download PDF link is shown to every viewer who can
				    see the invoice (members AND staff). Backed by the Phase 9b
				    `/api/invoices/[invoiceId]/pdf` route handler, which re-runs
				    the same consumer-OR-payer-OR-staff auth check. */}
				<div className="flex items-center gap-2">
					<a
						href={`/api/invoices/${inv.invoiceId}/pdf`}
						// `download` forces a save instead of opening inline in a new
						// tab. Left valueless so the browser uses the server's
						// Content-Disposition filename (<Last>_<First>_<INV>.pdf);
						// it's a same-origin request, so that header is honored.
						download
						rel="noreferrer noopener"
						className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 font-medium text-[var(--foreground)] text-xs transition-colors hover:bg-[var(--muted)]"
					>
						<Download size={14} />
						Download PDF
					</a>
					{canPayNow && (
						<Button
							variant="default"
							size="sm"
							disabled={starting}
							onClick={() =>
								startInvoiceCheckout.mutate({ invoiceId: inv.invoiceId })
							}
						>
							<CreditCard size={14} />
							{starting
								? "Starting…"
								: `Pay ${formatCents(outstandingInCents)}`}
						</Button>
					)}
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
					{canVoid && (
						<Button
							variant="outline"
							size="sm"
							className="text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
							onClick={() => setVoidOpen(true)}
						>
							Void
						</Button>
					)}
				</div>
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
						<dl className="space-y-3">
							<PartyBlock
								label="Bill to"
								party={inv.billedTo}
								isStaff={isStaff}
							/>
							<PartyBlock label="For" party={inv.consumer} isStaff={isStaff} />
						</dl>
					) : (
						<dl className="space-y-2">
							<PartyBlock
								label="Member"
								party={inv.consumer}
								isStaff={isStaff}
							/>
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
									{canRefund && p.netInCents > 0 && (
										<Button
											variant="outline"
											size="sm"
											className="mt-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
											onClick={() =>
												setRefundCtx({
													paymentId: p.paymentId,
													invoiceId: inv.invoiceId,
													invoiceNumber: inv.invoiceNumber,
													refundableInCents: p.netInCents,
													paymentLabel: `${PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod} · ${formatCents(p.amountInCents)}`,
													// Phase 12a Round 3 — gates the "Refund to Stripe
													// card" option in RefundModal. Stripe-collected
													// payments can be refunded back to the card;
													// cash/check/etc. cannot.
													processor: p.processor,
												})
											}
										>
											Refund
										</Button>
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

					<AlertDialog
						open={voidOpen}
						destructive
						title={`Void invoice ${inv.invoiceNumber}`}
						description="This cancels the invoice and removes it from balances and reporting. It does NOT revoke any package or credits granted by this sale — reverse those separately if needed. This can't be undone."
						confirmLabel={voiding ? "Voiding…" : "Void invoice"}
						cancelLabel="Cancel"
						confirmDisabled={voiding || voidReason.trim().length === 0}
						onConfirm={() => {
							if (voiding || voidReason.trim().length === 0) return;
							voidMutation.mutate({
								invoiceId,
								reason: voidReason.trim(),
							});
						}}
						onCancel={() => {
							if (voiding) return;
							setVoidOpen(false);
							setVoidReason("");
						}}
					>
						<label className="block space-y-1">
							<span className="text-[var(--muted-foreground)] text-xs">
								Reason (required) — appended to the invoice notes
							</span>
							<textarea
								value={voidReason}
								onChange={(e) => setVoidReason(e.target.value)}
								rows={3}
								maxLength={500}
								placeholder="e.g. Duplicate of INV-000041 / billed in error"
								className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
							/>
						</label>
					</AlertDialog>

					<RefundModal
						open={refundCtx !== null}
						onOpenChange={(o) => {
							if (!o) setRefundCtx(null);
						}}
						refund={refundCtx}
						consumerUserId={inv.consumer.userId}
						payerUserId={inv.billedTo?.userId ?? null}
					/>
				</>
			)}
		</div>
	);
}
