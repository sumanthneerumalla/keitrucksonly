"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { formatCents } from "~/lib/money";
import { api } from "~/trpc/react";

/**
 * Phase 9a (C12) — Refund modal. clubAdmin-gated; launched per-payment from the
 * invoice detail page's payment history. Mirrors RecordPaymentModal's slide-out
 * shell + string-based cents parsing.
 *
 * Bookkeeping only (D3): `billing.recordRefund` records an `InvoiceRefund` row —
 * staff hand back cash / refund in the processor dashboard separately. The
 * mutation blocks refunds on invoices whose overpayment credit was consumed
 * elsewhere (D1) and leaves an auto-closed invoice closed (D2). The button
 * that opens this is already gated on `viewerIsClubAdmin`,
 * `!hasConsumedCredit`, and a positive refundable balance — but the mutation
 * re-checks everything authoritatively.
 *
 * Phase 12a Round 3 Stream 5 — added a "Refund method" selector. The default
 * is **Account credit** per the locked design decision (user-confirmed).
 *
 * Routing (Round 3 cleanup — schema gap closed):
 *   - `account_credit` → `billing.issueAccountCreditFromPayment` (appends a
 *     negative CREDIT line item to the invoice; no money moves).
 *   - `cash` / `check` → `billing.recordRefund` (bookkeeping; staff hands
 *     money back outside the system).
 *   - `stripe_card` → `payments.refundStripePayment` (real Stripe refund);
 *     gated to payments with `processor === 'stripe'`.
 */

// Mirrors RecordPaymentModal.dollarStringToCents — string parse avoids IEEE-754
// drift (e.g. `Math.round(1.005 * 100)` = 100). Null for empty/invalid; 0–2
// fractional digits.
function dollarStringToCents(input: string): number | null {
	const trimmed = input.trim();
	if (trimmed === "") return null;
	const match = trimmed.match(/^(\d+)(?:\.(\d{1,2}))?$/);
	if (!match) return null;
	const [, dollarsStr = "0", fractionalStr = ""] = match;
	return (
		Number.parseInt(dollarsStr, 10) * 100 +
		Number.parseInt(fractionalStr.padEnd(2, "0"), 10)
	);
}

/**
 * Phase 12a Round 3 — refund method options.
 *
 * - `account_credit` (DEFAULT): the user keeps the money on their account as
 *   positive balance. Routed to `billing.issueAccountCreditFromPayment`,
 *   which appends a negative CREDIT line item to the invoice. No money
 *   moves; the buyer can spend the credit on a future invoice.
 *
 * - `cash` / `check`: routed to `billing.recordRefund`. The refund row
 *   inherits the original payment's method (the mutation doesn't accept a
 *   paymentMethod input today); the staff-entered reason captures intent
 *   for the bookkeeper.
 *
 * - `stripe_card`: routed to the dedicated `payments.refundStripePayment`
 *   mutation, which DOES call Stripe. Only enabled when the originating
 *   payment was itself made via Stripe (processor === 'stripe'), since
 *   you can't push money back to a card that never charged.
 */
type RefundMethod = "account_credit" | "cash" | "check" | "stripe_card";

const REFUND_METHOD_OPTIONS: Array<{ value: RefundMethod; label: string }> = [
	{ value: "account_credit", label: "Account credit" },
	{ value: "cash", label: "Cash" },
	{ value: "check", label: "Check" },
	{ value: "stripe_card", label: "Refund to Stripe card" },
];

export interface RefundContext {
	paymentId: string;
	invoiceId: string;
	invoiceNumber: string;
	/** Not-yet-refunded balance on this payment (= net), the refund cap. */
	refundableInCents: number;
	/** e.g. "Cash · $50.00" — display only. */
	paymentLabel: string;
	/**
	 * Phase 12a Round 3 — processor of the originating payment. Gates the
	 * "Refund to Stripe card" option: only enabled when this === 'stripe'.
	 * Undefined / null for manual payments.
	 */
	processor?: string | null;
}

interface RefundModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	refund: RefundContext | null;
	/** Invoice consumer + payer — both BillingPanels are refreshed on success. */
	consumerUserId: string;
	payerUserId: string | null;
}

export default function RefundModal({
	open,
	onOpenChange,
	refund,
	consumerUserId,
	payerUserId,
}: RefundModalProps) {
	const { toast } = useToast();
	const utils = api.useUtils();

	const [amountDollars, setAmountDollars] = useState<string>("");
	const [reason, setReason] = useState<string>("");
	const [method, setMethod] = useState<RefundMethod>("account_credit");
	const [confirmStripeOpen, setConfirmStripeOpen] = useState(false);

	// Reset on open for a new payment. id-only dep (matches RecordPaymentModal):
	// the whole `refund` object is a fresh literal each render.
	// biome-ignore lint/correctness/useExhaustiveDependencies: id-only reset dep is the intentional contract
	useEffect(() => {
		if (open && refund) {
			setAmountDollars((refund.refundableInCents / 100).toFixed(2));
			setReason("");
			setMethod("account_credit");
			setConfirmStripeOpen(false);
		}
	}, [open, refund?.paymentId]);

	const invalidateAll = async () => {
		if (!refund) return;
		await Promise.all([
			utils.billing.getInvoice.invalidate({ invoiceId: refund.invoiceId }),
			utils.billing.getMemberBilling.invalidate({ userId: consumerUserId }),
			payerUserId
				? utils.billing.getMemberBilling.invalidate({ userId: payerUserId })
				: Promise.resolve(),
			utils.billing.listInvoices.invalidate(),
		]);
	};

	const bookkeepingMutation = api.billing.recordRefund.useMutation({
		onSuccess: async (data) => {
			toast(
				`Refunded ${formatCents(data.refund.amountInCents)} — Invoice ${refund?.invoiceNumber ?? ""}`,
				"success",
			);
			await invalidateAll();
			onOpenChange(false);
		},
		onError: (err) => toast(err.message, "error"),
	});

	const accountCreditMutation =
		api.billing.issueAccountCreditFromPayment.useMutation({
			onSuccess: async () => {
				toast(
					`Issued account credit — Invoice ${refund?.invoiceNumber ?? ""}`,
					"success",
				);
				await invalidateAll();
				onOpenChange(false);
			},
			onError: (err) => toast(err.message, "error"),
		});

	const stripeRefundMutation = api.payments.refundStripePayment.useMutation({
		onSuccess: async (data) => {
			toast(
				`Refunded ${formatCents(data.amountInCents)} to card — Invoice ${refund?.invoiceNumber ?? ""}`,
				"success",
			);
			setConfirmStripeOpen(false);
			await invalidateAll();
			onOpenChange(false);
		},
		onError: (err) => {
			toast(err.message, "error");
			setConfirmStripeOpen(false);
		},
	});

	const saving =
		bookkeepingMutation.isPending ||
		accountCreditMutation.isPending ||
		stripeRefundMutation.isPending;

	if (!open || !refund) return null;

	const stripeAvailable = refund.processor === "stripe";

	const close = () => {
		if (!saving) onOpenChange(false);
	};

	const validate = (): { cents: number; reason: string } | null => {
		const cents = dollarStringToCents(amountDollars);
		if (cents === null || cents <= 0) {
			toast("Enter a valid refund amount greater than zero", "error");
			return null;
		}
		if (cents > refund.refundableInCents) {
			toast(
				`Refund cannot exceed ${formatCents(refund.refundableInCents)}`,
				"error",
			);
			return null;
		}
		const trimmedReason = reason.trim();
		if (trimmedReason === "") {
			toast("A reason is required", "error");
			return null;
		}
		return { cents, reason: trimmedReason };
	};

	const handleSubmit = (e?: React.FormEvent) => {
		e?.preventDefault();
		const v = validate();
		if (!v) return;

		if (method === "stripe_card") {
			// Real-money path — gate behind explicit confirmation.
			setConfirmStripeOpen(true);
			return;
		}

		if (method === "account_credit") {
			// Round 3 cleanup — account-credit "refund" appends a CREDIT line
			// item to the invoice instead of an InvoiceRefund row.
			accountCreditMutation.mutate({
				paymentId: refund.paymentId,
				amountInCents: v.cents,
				reason: v.reason,
			});
			return;
		}

		// Bookkeeping path — cash / check. The reason captures intent for the
		// bookkeeper; refund row's processor metadata inherits from the parent
		// payment (the mutation doesn't accept paymentMethod today).
		bookkeepingMutation.mutate({
			paymentId: refund.paymentId,
			amountInCents: v.cents,
			reason: v.reason,
		});
	};

	const submitStripeRefund = () => {
		const v = validate();
		if (!v) return;
		stripeRefundMutation.mutate({
			paymentId: refund.paymentId,
			amountInCents: v.cents,
			reason: v.reason,
		});
	};

	return (
		<>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop scrim; focus stays in the modal (matches RecordPaymentModal) */}
			<div
				className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
				onClick={saving ? undefined : () => onOpenChange(false)}
			/>

			<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
				<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
					<h2 className="font-semibold text-[var(--foreground)] text-base">
						Refund — Invoice {refund.invoiceNumber}
					</h2>
					<button
						onClick={close}
						disabled={saving}
						className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
						aria-label="Close"
						type="button"
					>
						<X size={18} />
					</button>
				</div>

				<form
					onSubmit={handleSubmit}
					className="flex flex-1 flex-col overflow-hidden"
				>
					<div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
						<div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-sm">
							<div className="grid grid-cols-2 gap-2">
								<div className="text-[var(--muted-foreground)]">Payment</div>
								<div className="text-right text-[var(--foreground)]">
									{refund.paymentLabel}
								</div>
								<div className="text-[var(--muted-foreground)]">Refundable</div>
								<div className="text-right font-mono text-[var(--foreground)]">
									{formatCents(refund.refundableInCents)}
								</div>
							</div>
						</div>

						{/* Refund method — Phase 12a Round 3 Stream 5 */}
						<fieldset className="space-y-2">
							<legend className="font-medium text-[var(--foreground)] text-sm">
								Refund method <span className="text-red-500">*</span>
							</legend>
							<div className="space-y-1.5">
								{REFUND_METHOD_OPTIONS.map((opt) => {
									const disabled =
										opt.value === "stripe_card" && !stripeAvailable;
									return (
										<label
											key={opt.value}
											className={`flex items-center gap-2 text-sm ${
												disabled
													? "cursor-not-allowed text-[var(--muted-foreground)]"
													: "cursor-pointer text-[var(--foreground)]"
											}`}
											title={
												disabled
													? "This payment wasn't made via Stripe — pick another method"
													: undefined
											}
										>
											<input
												type="radio"
												name="refund-method"
												value={opt.value}
												checked={method === opt.value}
												disabled={saving || disabled}
												onChange={() => setMethod(opt.value)}
											/>
											{opt.label}
											{disabled && (
												<span className="text-[var(--muted-foreground)] text-xs italic">
													(payment not made via Stripe)
												</span>
											)}
										</label>
									);
								})}
							</div>
						</fieldset>

						{/* Amount */}
						<div className="space-y-1">
							<label
								htmlFor="refund-amount"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Amount <span className="text-red-500">*</span>
							</label>
							<div className="relative">
								<span className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-[var(--muted-foreground)] text-sm">
									$
								</span>
								<input
									id="refund-amount"
									type="number"
									step="0.01"
									min="0"
									value={amountDollars}
									onChange={(e) => setAmountDollars(e.target.value)}
									disabled={saving}
									className="flex h-9 w-full rounded-md border border-input bg-transparent py-2 pr-3 pl-7 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
								/>
							</div>
							<p className="text-[var(--muted-foreground)] text-xs">
								{method === "stripe_card"
									? "Sends the money back to the original card via Stripe."
									: "Records the refund (cash handed back, check written, or applied as account credit). Does not call any processor."}
							</p>
						</div>

						{/* Reason — required, stored on the refund row */}
						<div className="space-y-1">
							<label
								htmlFor="refund-reason"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Reason <span className="text-red-500">*</span>
							</label>
							<textarea
								id="refund-reason"
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								rows={3}
								maxLength={500}
								placeholder="e.g. Withdrew from tournament — partial refund"
								disabled={saving}
								className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
							/>
						</div>
					</div>

					<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t px-6 py-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={close}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={saving}>
							{saving ? "Refunding…" : "Issue refund"}
						</Button>
					</div>
				</form>
			</div>

			<AlertDialog
				open={confirmStripeOpen}
				title="Refund to card via Stripe?"
				description="This will send the money back to the buyer's card via Stripe. This cannot be undone."
				confirmLabel={
					stripeRefundMutation.isPending ? "Refunding…" : "Refund to card"
				}
				cancelLabel="Cancel"
				destructive
				confirmDisabled={stripeRefundMutation.isPending}
				onConfirm={submitStripeRefund}
				onCancel={() => {
					if (!stripeRefundMutation.isPending) setConfirmStripeOpen(false);
				}}
			/>
		</>
	);
}
