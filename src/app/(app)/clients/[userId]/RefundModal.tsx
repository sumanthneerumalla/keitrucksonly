"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
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
 * staff hand back cash / refund in the processor dashboard separately; no
 * processor API call until Phase 12. The mutation blocks refunds on invoices
 * whose overpayment credit was consumed elsewhere (D1) and leaves an
 * auto-closed invoice closed (D2). The button that opens this is already gated
 * on `viewerIsClubAdmin`, `!hasConsumedCredit`, and a positive refundable
 * balance — but the mutation re-checks everything authoritatively.
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

export interface RefundContext {
	paymentId: string;
	invoiceId: string;
	invoiceNumber: string;
	/** Not-yet-refunded balance on this payment (= net), the refund cap. */
	refundableInCents: number;
	/** e.g. "Cash · $50.00" — display only. */
	paymentLabel: string;
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

	// Reset on open for a new payment. id-only dep (matches RecordPaymentModal):
	// the whole `refund` object is a fresh literal each render.
	// biome-ignore lint/correctness/useExhaustiveDependencies: id-only reset dep is the intentional contract
	useEffect(() => {
		if (open && refund) {
			setAmountDollars((refund.refundableInCents / 100).toFixed(2));
			setReason("");
		}
	}, [open, refund?.paymentId]);

	const refundMutation = api.billing.recordRefund.useMutation({
		onSuccess: async (data) => {
			toast(
				`Refunded ${formatCents(data.refund.amountInCents)} — Invoice ${refund?.invoiceNumber ?? ""}`,
				"success",
			);
			await Promise.all([
				refund
					? utils.billing.getInvoice.invalidate({ invoiceId: refund.invoiceId })
					: Promise.resolve(),
				utils.billing.getMemberBilling.invalidate({ userId: consumerUserId }),
				payerUserId
					? utils.billing.getMemberBilling.invalidate({ userId: payerUserId })
					: Promise.resolve(),
				utils.billing.listInvoices.invalidate(),
			]);
			onOpenChange(false);
		},
		onError: (err) => toast(err.message, "error"),
	});
	const saving = refundMutation.isPending;

	if (!open || !refund) return null;

	const close = () => {
		if (!saving) onOpenChange(false);
	};

	const handleSubmit = (e?: React.FormEvent) => {
		e?.preventDefault();
		if (!refund) return;
		const cents = dollarStringToCents(amountDollars);
		if (cents === null || cents <= 0) {
			toast("Enter a valid refund amount greater than zero", "error");
			return;
		}
		if (cents > refund.refundableInCents) {
			toast(
				`Refund cannot exceed ${formatCents(refund.refundableInCents)}`,
				"error",
			);
			return;
		}
		const trimmedReason = reason.trim();
		if (trimmedReason === "") {
			toast("A reason is required", "error");
			return;
		}
		refundMutation.mutate({
			paymentId: refund.paymentId,
			amountInCents: cents,
			reason: trimmedReason,
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
								Records the refund (cash handed back, or refunded in your
								processor's dashboard). It does not call any processor.
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
		</>
	);
}
