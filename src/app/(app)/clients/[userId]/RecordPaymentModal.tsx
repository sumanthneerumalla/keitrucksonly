"use client";

import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { Select } from "~/app/_components/shared/ui/select";
import { api } from "~/trpc/react";

/**
 * Phase 9a — Record Payment modal (backlog item C11).
 *
 * Mirrors the slide-out modal pattern from SellPackageModal: plain useState
 * form, `useToast` for success/error, `useUtils()` to invalidate the billing
 * query after a successful payment. See designFiles/roadmap/phase9-invoicing.md
 * — "Phase 9a — Remaining Work Backlog" + "Partial Payment & Overpayment Policy".
 *
 * Overpayment is allowed (Version A — signed running-tab balance). When the
 * invoice is already paid or overpaid, the amount defaults to $0 so staff can
 * type the credit amount they want to add.
 */

type PaymentMethod =
	| "cash"
	| "check"
	| "credit_card"
	| "pos_transaction"
	| "stripe"
	| "paysafe"
	| "other"
	| "account_credit";

type Processor = "stripe" | "paysafe" | "square" | "valor";

const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{
	value: PaymentMethod;
	label: string;
}> = [
	{ value: "cash", label: "Cash" },
	{ value: "check", label: "Check" },
	{ value: "credit_card", label: "Credit card" },
	{ value: "pos_transaction", label: "POS transaction" },
	{ value: "stripe", label: "Stripe" },
	{ value: "paysafe", label: "Paysafe" },
	{ value: "other", label: "Other" },
	{ value: "account_credit", label: "Account credit" },
];

const PROCESSOR_OPTIONS: ReadonlyArray<{
	value: "none" | Processor;
	label: string;
}> = [
	{ value: "none", label: "None (manual / cash / check)" },
	{ value: "stripe", label: "Stripe" },
	{ value: "paysafe", label: "Paysafe" },
	{ value: "square", label: "Square" },
	{ value: "valor", label: "Valor" },
];

// TEMP (2026-05-22): the advanced/processor disclosure in the Record Payment
// modal is hidden for now — cash/check only, and the dropdown confused users.
// Flip this to true to bring it back (the toggle, processor inputs, and the
// submit plumbing are all left intact below).
const SHOW_ADVANCED_PAYMENT_FIELDS: boolean = false;

function formatCents(cents: number): string {
	return (cents / 100).toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
	});
}

/**
 * Parse a dollar-string like "12.34" into integer cents without going through
 * float math. Avoids IEEE 754 surprises — `Math.round(1.005 * 100)` yields 100
 * instead of 101 because `1.005 * 100` is actually `100.49999…` in binary.
 * Returns null for empty/invalid input. Accepts 0–2 digits of fractional part.
 */
function dollarStringToCents(input: string): number | null {
	const trimmed = input.trim();
	if (trimmed === "") return null;
	const match = trimmed.match(/^(\d+)(?:\.(\d{1,2}))?$/);
	if (!match) return null;
	const [, dollarsStr = "0", fractionalStr = ""] = match;
	const dollars = Number.parseInt(dollarsStr, 10);
	const cents = fractionalStr.padEnd(2, "0");
	return dollars * 100 + Number.parseInt(cents, 10);
}

interface InvoiceContext {
	invoiceId: string;
	invoiceNumber: string;
	totalInCents: number;
	amountPaidInCents: number;
	balanceInCents: number;
}

interface RecordPaymentModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	userId: string;
	invoice: InvoiceContext | null;
}

export default function RecordPaymentModal({
	open,
	onOpenChange,
	userId,
	invoice,
}: RecordPaymentModalProps) {
	const { toast } = useToast();
	const utils = api.useUtils();

	// Form state
	const [amountDollars, setAmountDollars] = useState<string>("");
	const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
	const [reference, setReference] = useState<string>("");
	const [notes, setNotes] = useState<string>("");
	const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
	const [processor, setProcessor] = useState<"none" | Processor>("none");
	const [processorTransactionId, setProcessorTransactionId] =
		useState<string>("");
	const [processorChargeId, setProcessorChargeId] = useState<string>("");
	const [processorFeeCents, setProcessorFeeCents] = useState<string>("");

	// Reset form whenever the modal opens for a new invoice. The id-only dep
	// is intentional — including the whole `invoice` object or
	// `invoice.balanceInCents` would re-fire the effect on every parent
	// re-render that produces a fresh object literal with the same id,
	// clobbering whatever the user has typed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: id-only dep is the intentional contract — see comment above
	useEffect(() => {
		if (open && invoice) {
			// Default to remaining balance; clamp negative (credit) balances to 0
			// so the user can type the desired credit amount.
			const defaultDollars = Math.max(0, invoice.balanceInCents) / 100;
			setAmountDollars(defaultDollars > 0 ? defaultDollars.toFixed(2) : "0.00");
			setPaymentMethod("cash");
			setReference("");
			setNotes("");
			setShowAdvanced(false);
			setProcessor("none");
			setProcessorTransactionId("");
			setProcessorChargeId("");
			setProcessorFeeCents("");
		}
	}, [open, invoice?.invoiceId]);

	const recordPaymentMutation = api.billing.recordPayment.useMutation({
		onSuccess: async (data) => {
			if (!invoice) {
				onOpenChange(false);
				return;
			}
			const remaining =
				data.invoice.totalInCents - data.invoice.amountPaidInCents;
			let message: string;
			if (remaining > 0) {
				message = `Payment recorded — Invoice ${invoice.invoiceNumber}: ${formatCents(remaining)} remaining`;
			} else if (data.invoice.amountPaidInCents > data.invoice.totalInCents) {
				const credit =
					data.invoice.amountPaidInCents - data.invoice.totalInCents;
				message = `Payment recorded — Invoice ${invoice.invoiceNumber} paid (${formatCents(credit)} credit)`;
			} else {
				message = `Payment recorded — Invoice ${invoice.invoiceNumber} paid`;
			}
			toast(message, "success");
			// Refresh the member's BillingPanel rollups AND any open invoice
			// detail page for this invoice (the detail view reads `getInvoice`).
			await Promise.all([
				utils.billing.getMemberBilling.invalidate({ userId }),
				utils.billing.getInvoice.invalidate({ invoiceId: invoice.invoiceId }),
			]);
			onOpenChange(false);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	// `saving` aliases the mutation's own pending flag. tRPC's `isPending` is
	// the single source of truth — no separate `useState` to keep in sync, no
	// `onSettled` plumbing, no double-submit race window between `setSaving`
	// and the network call.
	// Phase 9a — "Account credit" path: fetch the payer's available credit for
	// this invoice (only while that method is selected) and apply it via a
	// dedicated mutation. This is NOT recordPayment — applying credit moves an
	// existing liability, it is not money received.
	const isAccountCredit = paymentMethod === "account_credit";
	const creditCtx = api.billing.getAccountCreditContext.useQuery(
		{ invoiceId: invoice?.invoiceId ?? "" },
		{ enabled: open && !!invoice && isAccountCredit },
	);

	const applyCreditMutation = api.billing.applyAccountCredit.useMutation({
		onSuccess: async (data) => {
			if (!invoice) {
				onOpenChange(false);
				return;
			}
			toast(
				`Applied ${formatCents(data.appliedInCents)} account credit to Invoice ${invoice.invoiceNumber}`,
				"success",
			);
			await Promise.all([
				utils.billing.getMemberBilling.invalidate({ userId }),
				utils.billing.getInvoice.invalidate({ invoiceId: invoice.invoiceId }),
				utils.billing.getAccountCreditContext.invalidate({
					invoiceId: invoice.invoiceId,
				}),
			]);
			onOpenChange(false);
		},
		onError: async (err) => {
			// The credit may have been (partly) spent since the modal opened
			// (a concurrent apply on the same payer); the mutation re-checks under
			// its advisory lock and rejects. Refetch the live context so the
			// "Available credit" line + amount pre-fill self-correct, then point the
			// user at the fix instead of showing a bare server error.
			if (invoice) {
				await utils.billing.getAccountCreditContext.invalidate({
					invoiceId: invoice.invoiceId,
				});
			}
			const staleCredit = /exceeds available account credit/i.test(err.message);
			toast(
				staleCredit
					? "Account credit changed since you opened this — the amount has been refreshed. Review and try again."
					: err.message,
				"error",
			);
		},
	});

	// When Account Credit is selected, pre-fill the amount with the max
	// applicable (min of available credit and what's owed).
	useEffect(() => {
		if (isAccountCredit && creditCtx.data) {
			setAmountDollars((creditCtx.data.applicableInCents / 100).toFixed(2));
		}
	}, [isAccountCredit, creditCtx.data]);

	const saving =
		recordPaymentMutation.isPending || applyCreditMutation.isPending;

	const parsedAmountCents = useMemo(
		() => dollarStringToCents(amountDollars),
		[amountDollars],
	);

	const parsedFeeCents = useMemo(() => {
		const trimmed = processorFeeCents.trim();
		if (trimmed === "") return undefined;
		const n = Number.parseInt(trimmed, 10);
		if (!Number.isFinite(n)) return Number.NaN;
		return n;
	}, [processorFeeCents]);

	const processorRequired = processor !== "none";

	const handleSubmit = (e?: React.FormEvent) => {
		e?.preventDefault();
		if (!invoice) return;

		if (parsedAmountCents === null || parsedAmountCents <= 0) {
			toast("Amount must be a valid amount greater than zero", "error");
			return;
		}

		// Sanity ceiling: $1,000,000 = 100,000,000 cents. Far above any plausible
		// single payment; protects against `1e308`-style gibberish input that
		// would otherwise produce an opaque Zod error on the server.
		if (parsedAmountCents > 100_000_000) {
			toast("Amount cannot exceed $1,000,000", "error");
			return;
		}

		// Account credit applies existing overpayment to this invoice via a
		// dedicated mutation, capped at what's actually applicable.
		if (isAccountCredit) {
			const maxApplicable = creditCtx.data?.applicableInCents ?? 0;
			if (parsedAmountCents > maxApplicable) {
				toast(
					`Amount exceeds the applicable account credit (${formatCents(maxApplicable)})`,
					"error",
				);
				return;
			}
			applyCreditMutation.mutate({
				invoiceId: invoice.invoiceId,
				amountInCents: parsedAmountCents,
			});
			return;
		}

		if (processorRequired && processorTransactionId.trim() === "") {
			toast(
				"Processor transaction ID is required when a processor is selected",
				"error",
			);
			return;
		}

		if (
			parsedFeeCents !== undefined &&
			(!Number.isFinite(parsedFeeCents) || (parsedFeeCents as number) < 0)
		) {
			toast("Processor fee must be a non-negative integer (cents)", "error");
			return;
		}

		const trimmedReference = reference.trim();
		const trimmedNotes = notes.trim();
		const trimmedTxId = processorTransactionId.trim();
		const trimmedChargeId = processorChargeId.trim();

		recordPaymentMutation.mutate({
			invoiceId: invoice.invoiceId,
			amountInCents: parsedAmountCents,
			paymentMethod,
			...(processorRequired ? { processor: processor as Processor } : {}),
			...(processorRequired && trimmedTxId !== ""
				? { processorTransactionId: trimmedTxId }
				: {}),
			...(processorRequired && trimmedChargeId !== ""
				? { processorChargeId: trimmedChargeId }
				: {}),
			...(processorRequired &&
			parsedFeeCents !== undefined &&
			Number.isFinite(parsedFeeCents)
				? { processorFeeInCents: parsedFeeCents as number }
				: {}),
			...(trimmedReference !== "" ? { reference: trimmedReference } : {}),
			...(trimmedNotes !== "" ? { notes: trimmedNotes } : {}),
		});
	};

	if (!open || !invoice) return null;

	const close = () => {
		if (saving) return;
		onOpenChange(false);
	};

	return (
		<>
			{/* Backdrop — visual scrim; keyboard users close via the X button */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a visual scrim, focus stays in the modal — matches SellPackageModal pattern */}
			<div
				className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
				onClick={saving ? undefined : () => onOpenChange(false)}
			/>

			{/* Modal */}
			<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
				{/* Header */}
				<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
					<h2 className="font-semibold text-[var(--foreground)] text-base">
						Record Payment — Invoice {invoice.invoiceNumber}
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

				{/* Body */}
				<form
					onSubmit={handleSubmit}
					className="flex flex-1 flex-col overflow-hidden"
				>
					<div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
						{/* Invoice meta */}
						<div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-sm">
							<div className="grid grid-cols-2 gap-2">
								<div className="text-[var(--muted-foreground)]">Total</div>
								<div className="text-right font-mono text-[var(--foreground)]">
									{formatCents(invoice.totalInCents)}
								</div>
								<div className="text-[var(--muted-foreground)]">
									Already paid
								</div>
								<div className="text-right font-mono text-[var(--foreground)]">
									{formatCents(invoice.amountPaidInCents)}
								</div>
								<div className="text-[var(--muted-foreground)]">Balance</div>
								<div
									className={`text-right font-mono ${
										invoice.balanceInCents > 0
											? "font-semibold text-[var(--foreground)]"
											: "text-[var(--muted-foreground)]"
									}`}
								>
									{invoice.balanceInCents < 0
										? `${formatCents(Math.abs(invoice.balanceInCents))} (credit)`
										: formatCents(invoice.balanceInCents)}
								</div>
							</div>
						</div>

						{/* Amount */}
						<div className="space-y-1">
							<label
								htmlFor="record-payment-amount"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Amount <span className="text-red-500">*</span>
							</label>
							<div className="relative">
								<span className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-[var(--muted-foreground)] text-sm">
									$
								</span>
								<input
									id="record-payment-amount"
									type="number"
									step="0.01"
									min="0"
									value={amountDollars}
									onChange={(e) => setAmountDollars(e.target.value)}
									disabled={saving}
									className="flex h-9 w-full rounded-md border border-input bg-transparent py-2 pr-3 pl-7 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
								/>
							</div>
							{isAccountCredit ? (
								<p className="text-[var(--muted-foreground)] text-xs">
									{creditCtx.isLoading
										? "Checking available credit…"
										: `Available credit ${formatCents(creditCtx.data?.availableCreditInCents ?? 0)} · applying up to ${formatCents(creditCtx.data?.applicableInCents ?? 0)} (the balance owed).`}
								</p>
							) : (
								<p className="text-[var(--muted-foreground)] text-xs">
									Overpayment is allowed — it appears as account credit on the
									running tab.
								</p>
							)}
						</div>

						{/* Payment method */}
						<div className="space-y-1">
							<label
								htmlFor="record-payment-method"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Payment method <span className="text-red-500">*</span>
							</label>
							<Select
								id="record-payment-method"
								value={paymentMethod}
								onChange={(e) =>
									setPaymentMethod(e.target.value as PaymentMethod)
								}
								disabled={saving}
								className="h-9"
							>
								{PAYMENT_METHOD_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</Select>
						</div>

						{/* Reference — hidden for account credit (nothing to reference) */}
						<div className={isAccountCredit ? "hidden" : "space-y-1"}>
							<label
								htmlFor="record-payment-reference"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Reference
							</label>
							<input
								id="record-payment-reference"
								type="text"
								value={reference}
								onChange={(e) => setReference(e.target.value)}
								placeholder="Check #, POS tx id, etc."
								disabled={saving}
								className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
							/>
						</div>

						{/* Notes — hidden for account credit */}
						<div className={isAccountCredit ? "hidden" : "space-y-1"}>
							<label
								htmlFor="record-payment-notes"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Notes
							</label>
							<textarea
								id="record-payment-notes"
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								rows={3}
								placeholder="Optional notes"
								maxLength={2000}
								disabled={saving}
								className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
							/>
						</div>

						{/* Advanced / processor fields hidden for now — flip
						    SHOW_ADVANCED_PAYMENT_FIELDS (above) to restore. */}
						{SHOW_ADVANCED_PAYMENT_FIELDS && (
							<div className="space-y-2">
								<button
									type="button"
									onClick={() => setShowAdvanced((v) => !v)}
									disabled={saving}
									className="inline-flex items-center gap-1 text-[var(--muted-foreground)] text-xs transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
									aria-expanded={showAdvanced}
								>
									{showAdvanced ? (
										<ChevronDown size={14} />
									) : (
										<ChevronRight size={14} />
									)}
									{showAdvanced ? "Hide advanced" : "Show advanced"}
								</button>

								{showAdvanced && (
									<div className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
										{/* Processor */}
										<div className="space-y-1">
											<label
												htmlFor="record-payment-processor"
												className="font-medium text-[var(--foreground)] text-sm"
											>
												Processor
											</label>
											<Select
												id="record-payment-processor"
												value={processor}
												onChange={(e) =>
													setProcessor(e.target.value as "none" | Processor)
												}
												disabled={saving}
												className="h-9"
											>
												{PROCESSOR_OPTIONS.map((opt) => (
													<option key={opt.value} value={opt.value}>
														{opt.label}
													</option>
												))}
											</Select>
										</div>

										{/* Processor transaction ID */}
										<div className="space-y-1">
											<label
												htmlFor="record-payment-tx-id"
												className={`font-medium text-sm ${
													processorRequired
														? "text-[var(--foreground)]"
														: "text-[var(--muted-foreground)]"
												}`}
											>
												Processor transaction ID
												{processorRequired && (
													<span className="text-red-500"> *</span>
												)}
											</label>
											<input
												id="record-payment-tx-id"
												type="text"
												value={processorTransactionId}
												onChange={(e) =>
													setProcessorTransactionId(e.target.value)
												}
												disabled={saving || !processorRequired}
												placeholder={
													processorRequired
														? "e.g., pi_3Abc... or Paysafe tx id"
														: "Select a processor first"
												}
												className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
											/>
											<p className="text-[var(--muted-foreground)] text-xs">
												Required when a processor is selected.
											</p>
										</div>

										{/* Processor charge ID */}
										<div className="space-y-1">
											<label
												htmlFor="record-payment-charge-id"
												className={`font-medium text-sm ${
													processorRequired
														? "text-[var(--foreground)]"
														: "text-[var(--muted-foreground)]"
												}`}
											>
												Processor charge ID
											</label>
											<input
												id="record-payment-charge-id"
												type="text"
												value={processorChargeId}
												onChange={(e) => setProcessorChargeId(e.target.value)}
												disabled={saving || !processorRequired}
												placeholder={
													processorRequired
														? "Optional secondary id"
														: "Select a processor first"
												}
												className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
											/>
										</div>

										{/* Processor fee */}
										<div className="space-y-1">
											<label
												htmlFor="record-payment-fee"
												className={`font-medium text-sm ${
													processorRequired
														? "text-[var(--foreground)]"
														: "text-[var(--muted-foreground)]"
												}`}
											>
												Processor fee (cents)
											</label>
											<input
												id="record-payment-fee"
												type="number"
												min="0"
												step="1"
												value={processorFeeCents}
												onChange={(e) => setProcessorFeeCents(e.target.value)}
												disabled={saving || !processorRequired}
												placeholder={
													processorRequired ? "e.g., 320 (= $3.20)" : "—"
												}
												className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
											/>
											<p className="text-[var(--muted-foreground)] text-xs">
												Fee charged by the processor, if known.
											</p>
										</div>
									</div>
								)}
							</div>
						)}
					</div>

					{/* Footer */}
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
							{saving
								? isAccountCredit
									? "Applying..."
									: "Recording..."
								: isAccountCredit
									? "Apply credit"
									: "Record Payment"}
						</Button>
					</div>
				</form>
			</div>
		</>
	);
}
