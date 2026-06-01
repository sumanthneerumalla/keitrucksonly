/**
 * Phase 12a — shared internal payment + refund helpers.
 *
 * Extracted from billing.ts (`recordPayment` lines 804–971 and `recordRefund`
 * lines 1675–1827) so the future Stripe webhook (Round 2) can record payments
 * + refunds against existing invoices without duplicating the
 * advisory-lock / FOR-UPDATE / authoritative-recompute / status-mutation /
 * audit-emission body.
 *
 * COMPOSITION (phase12 §23 decision #6 / §9.3.1 Choice B):
 *   - The internal helpers OWN their `writeAuditedMutation` transaction —
 *     callers (the existing tRPC mutations + the future webhook dispatcher)
 *     just call the helper.
 *   - The mutation wrappers retain their pre-lock cross-tenant guards +
 *     status fetches (so a 404/CONFLICT short-circuits without a transaction
 *     roundtrip) and pass the pre-fetched `invoice` / `paymentForRefund`
 *     objects in. The helpers assume those have already been validated
 *     against the caller's club.
 *   - `actorUserId: null` + `source: AUDIT_SOURCES.WEBHOOK` for webhook
 *     calls; `source: AUDIT_SOURCES.ADMIN_DASHBOARD` + `actorUserId =
 *     ctx.user.userId` for the tRPC mutation path. Both are honored by
 *     HANDOFF #122 (AuditLog Option B — non-human actors).
 *
 * INVARIANTS preserved from the original mutation bodies:
 *   - `invoice-payer-${effectivePayer}-${club}` advisory lock acquired
 *     BEFORE any reads/writes (HANDOFF #113 — shared with sellPackage,
 *     closeInvoice, applyAccountCredit, addAdHocCharge).
 *   - Invoice row lock (`FOR UPDATE`) immediately after the advisory lock.
 *   - Re-read `totalInCents` (and credit-consumption markers for refunds)
 *     INSIDE the lock — guards against stale pre-lock reads (HANDOFF #118
 *     for payment; HANDOFF #123 D1 for refund).
 *   - Authoritative recompute formula: `Σ payments − Σ refunds`
 *     (HANDOFF #102) — never a blind `increment`.
 *   - P2002 on `(processor, processorTransactionId)` /
 *     `(processor, processorRefundId)` → CONFLICT (webhook idempotency).
 *   - Status mapping: `<=0 → open`, `<total → partially_paid`,
 *     `>=total → paid` (auto-close on paid in `recordPaymentInternal`).
 *   - Refund leaves `closedAt` UNTOUCHED (HANDOFF #123 D2).
 *   - Audit row via `buildPartyAuditEntries` (consumer + payer when
 *     bill-to, single row when self-pay; HANDOFF #122 multi-party shape).
 *
 * See designFiles/roadmap/phase12-stripe-connect.md §9.3 + §9.3.1 (Choice B).
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
	AUDIT_ACTIONS,
	type AuditSource,
	buildPartyAuditEntries,
	writeAuditedMutation,
} from "~/server/utils/auditedMutation";

// ============================================================
// recordPaymentInternal
// ============================================================

export interface RecordPaymentInternalInput {
	invoiceId: string;
	amountInCents: number;
	paymentMethod: string;
	processor?: string;
	processorTransactionId?: string;
	processorChargeId?: string;
	processorFeeInCents?: number;
	reference?: string;
	notes?: string;
}

export interface RecordPaymentInternalArgs {
	db: PrismaClient;
	clubShortName: string;
	/** null for webhook-initiated payments (set source: 'webhook'). */
	actorUserId: string | null;
	source: AuditSource;
	/**
	 * Pre-fetched invoice with the fields needed for the advisory-lock key +
	 * the audit-party derivation. The caller (mutation wrapper or webhook
	 * dispatcher) MUST have already validated the invoice belongs to
	 * `clubShortName` and that its status is not `void` / `draft`. The helper
	 * re-reads `totalInCents` inside the lock authoritatively.
	 */
	invoice: {
		invoiceId: string;
		userId: string;
		billedToUserId: string | null;
	};
	/**
	 * The userId to charge as `receivedBy` on the InvoicePayment row + as the
	 * `closedBy` on auto-close. For mutation callers this is `ctx.user.userId`;
	 * for the webhook this is a system-staff user resolved by the dispatcher.
	 */
	receivedByUserId: string;
	input: RecordPaymentInternalInput;
}

export async function recordPaymentInternal(args: RecordPaymentInternalArgs) {
	const {
		db,
		clubShortName,
		actorUserId,
		source,
		invoice,
		receivedByUserId,
		input,
	} = args;
	const effectivePayerUserId = invoice.billedToUserId ?? invoice.userId;

	return await writeAuditedMutation(
		{
			db,
			actorUserId,
			clubShortName,
			source,
		},
		async (tx) => {
			// Advisory lock FIRST (HANDOFF #113 — shared `invoice-payer-` key).
			const lockKey = `invoice-payer-${effectivePayerUserId}-${clubShortName}`;
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;
			// Row lock the invoice for the tx duration.
			await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "invoiceId" = ${invoice.invoiceId} FOR UPDATE`;

			// Re-read totalInCents AFTER the lock — pre-lock read can be stale
			// (concurrent sellPackage / addAdHocCharge could have appended a line).
			// HANDOFF #118.
			const locked = await tx.invoice.findUniqueOrThrow({
				where: { invoiceId: invoice.invoiceId },
				select: { totalInCents: true },
			});
			const totalInCents = locked.totalInCents;

			// Insert the payment row. P2002 = webhook idempotency hit.
			let payment: Awaited<ReturnType<typeof tx.invoicePayment.create>>;
			try {
				payment = await tx.invoicePayment.create({
					data: {
						invoiceId: invoice.invoiceId,
						amountInCents: input.amountInCents,
						paymentMethod: input.paymentMethod,
						processor: input.processor,
						processorTransactionId: input.processorTransactionId,
						processorChargeId: input.processorChargeId,
						processorFeeInCents: input.processorFeeInCents,
						reference: input.reference,
						notes: input.notes,
						receivedBy: receivedByUserId,
					},
				});
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2002"
				) {
					throw new TRPCError({
						code: "CONFLICT",
						message:
							"This transaction has already been recorded for this processor",
					});
				}
				throw error;
			}

			// Authoritative recompute (HANDOFF #102).
			const paymentsSum = await tx.invoicePayment.aggregate({
				_sum: { amountInCents: true },
				where: { invoiceId: invoice.invoiceId },
			});
			const refundsSum = await tx.invoiceRefund.aggregate({
				_sum: { amountInCents: true },
				where: { invoiceId: invoice.invoiceId },
			});
			const newAmountPaid =
				(paymentsSum._sum.amountInCents ?? 0) -
				(refundsSum._sum.amountInCents ?? 0);

			let newStatus: string;
			if (newAmountPaid <= 0) {
				newStatus = "open";
			} else if (newAmountPaid < totalInCents) {
				newStatus = "partially_paid";
			} else {
				newStatus = "paid";
			}

			// Auto-close on paid (Round 4 / HANDOFF #103).
			await tx.invoice.update({
				where: { invoiceId: invoice.invoiceId },
				data: {
					amountPaidInCents: newAmountPaid,
					status: newStatus,
					...(newStatus === "paid"
						? { closedAt: new Date(), closedBy: receivedByUserId }
						: {}),
				},
			});

			return {
				result: {
					payment,
					invoice: {
						invoiceId: invoice.invoiceId,
						amountPaidInCents: newAmountPaid,
						totalInCents,
						status: newStatus,
					},
				},
				audit: buildPartyAuditEntries({
					action: AUDIT_ACTIONS.PAYMENT_RECORDED,
					consumerUserId: invoice.userId,
					payerUserId: invoice.billedToUserId,
					entityType: "InvoicePayment",
					entityId: payment.paymentId,
					metadata: {
						amountInCents: input.amountInCents,
						paymentMethod: input.paymentMethod,
						invoiceId: invoice.invoiceId,
					},
				}),
			};
		},
	);
}

// ============================================================
// recordRefundInternal
// ============================================================

export interface RecordRefundInternalInput {
	paymentId: string;
	amountInCents: number;
	reason: string;
	processorRefundId?: string;
	processorFeeInCents?: number;
	notes?: string;
}

export interface RecordRefundInternalArgs {
	db: PrismaClient;
	clubShortName: string;
	actorUserId: string | null;
	source: AuditSource;
	/**
	 * Pre-fetched payment + invoice. The caller MUST have validated:
	 *   (a) payment belongs to `clubShortName`,
	 *   (b) the invoice is not `void`,
	 *   (c) the pre-lock D1 guard passes (consumed credit blocks refund;
	 *       HANDOFF #123). The helper re-checks the D1 guard INSIDE the
	 *       lock (a concurrent applyAccountCredit could have consumed credit
	 *       after the pre-lock read).
	 */
	payment: {
		paymentId: string;
		amountInCents: number;
		processor: string | null;
		invoiceId: string;
		invoice: {
			userId: string;
			billedToUserId: string | null;
		};
	};
	/** Staff user marked as `refundedBy`. For webhook calls, dispatcher resolves a system staff. */
	refundedByUserId: string;
	input: RecordRefundInternalInput;
}

export async function recordRefundInternal(args: RecordRefundInternalArgs) {
	const {
		db,
		clubShortName,
		actorUserId,
		source,
		payment,
		refundedByUserId,
		input,
	} = args;
	const reason = input.reason.trim();
	const effectivePayerUserId =
		payment.invoice.billedToUserId ?? payment.invoice.userId;

	return await writeAuditedMutation(
		{
			db,
			actorUserId,
			clubShortName,
			source,
		},
		async (tx) => {
			// Same per-payer advisory lock + invoice row lock (HANDOFF #113).
			const lockKey = `invoice-payer-${effectivePayerUserId}-${clubShortName}`;
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;
			await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "invoiceId" = ${payment.invoiceId} FOR UPDATE`;

			// Re-read inside the lock: re-check void + D1 (consumed credit blocks
			// refund — HANDOFF #123); fetch totalInCents for recompute.
			const locked = await tx.invoice.findUniqueOrThrow({
				where: { invoiceId: payment.invoiceId },
				select: {
					totalInCents: true,
					status: true,
					creditConsumedInCents: true,
					creditConsumedAt: true,
				},
			});
			if (locked.status === "void") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Cannot refund a payment on a void invoice",
				});
			}
			if (
				locked.creditConsumedInCents > 0 ||
				locked.creditConsumedAt !== null
			) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This invoice's overpayment was applied as account credit to other invoices, so it can't be refunded here.",
				});
			}

			// No over-refund: cap = paid − already-refunded −
			// credit-already-issued-against-this-payment (Round 3.6
			// IMPORTANT #1). The credit term covers refund-as-credit lines
			// posted via `billing.issueAccountCreditFromPayment` — without
			// it, a $50 credit + a full Stripe refund of the same $100
			// payment would return $150 to the buyer against $100 paid.
			// Each pre-lock fast-fail caller re-runs this under the lock.
			const [priorRefunds, priorCreditIssued] = await Promise.all([
				tx.invoiceRefund.aggregate({
					_sum: { amountInCents: true },
					where: { paymentId: input.paymentId },
				}),
				tx.invoiceLineItem.aggregate({
					_sum: { totalInCents: true },
					where: {
						creditFromPaymentId: input.paymentId,
						kind: "CREDIT",
					},
				}),
			]);
			const alreadyRefunded = priorRefunds._sum.amountInCents ?? 0;
			// CREDIT line totals are negative; abs to dollar amount issued.
			const alreadyCredited = Math.abs(
				priorCreditIssued._sum.totalInCents ?? 0,
			);
			const refundableRemaining =
				payment.amountInCents - alreadyRefunded - alreadyCredited;
			if (input.amountInCents > refundableRemaining) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: `Refund would exceed remaining refundable amount. Payment $${(payment.amountInCents / 100).toFixed(2)} paid; $${(alreadyRefunded / 100).toFixed(2)} already refunded; $${(alreadyCredited / 100).toFixed(2)} issued as account credit. Maximum refundable: $${(refundableRemaining / 100).toFixed(2)}.`,
				});
			}

			// Insert the refund row. P2002 = (processor, processorRefundId) idem hit.
			let refund: Awaited<ReturnType<typeof tx.invoiceRefund.create>>;
			try {
				refund = await tx.invoiceRefund.create({
					data: {
						paymentId: input.paymentId,
						invoiceId: payment.invoiceId,
						amountInCents: input.amountInCents,
						reason,
						refundedBy: refundedByUserId,
						processor: payment.processor,
						processorRefundId: input.processorRefundId,
						processorFeeInCents: input.processorFeeInCents,
						notes: input.notes,
					},
				});
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2002"
				) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "This refund has already been recorded for this processor",
					});
				}
				throw error;
			}

			// Payment status from cumulative refunds against it.
			const totalRefundedForPayment = alreadyRefunded + input.amountInCents;
			const newPaymentStatus =
				totalRefundedForPayment >= payment.amountInCents
					? "refunded"
					: "partially_refunded";
			await tx.invoicePayment.update({
				where: { paymentId: input.paymentId },
				data: { status: newPaymentStatus },
			});

			// Authoritative invoice recompute (same as recordPayment).
			// D2: leave `closedAt` UNTOUCHED — a refund that re-opens a balance
			// does NOT resurrect the tab (HANDOFF #123).
			const paymentsSum = await tx.invoicePayment.aggregate({
				_sum: { amountInCents: true },
				where: { invoiceId: payment.invoiceId },
			});
			const refundsSum = await tx.invoiceRefund.aggregate({
				_sum: { amountInCents: true },
				where: { invoiceId: payment.invoiceId },
			});
			const newAmountPaid =
				(paymentsSum._sum.amountInCents ?? 0) -
				(refundsSum._sum.amountInCents ?? 0);
			const total = locked.totalInCents;
			let newStatus: string;
			if (newAmountPaid <= 0) {
				newStatus = "open";
			} else if (newAmountPaid < total) {
				newStatus = "partially_paid";
			} else {
				newStatus = "paid";
			}
			await tx.invoice.update({
				where: { invoiceId: payment.invoiceId },
				data: { amountPaidInCents: newAmountPaid, status: newStatus },
			});

			return {
				result: {
					refund,
					payment: {
						paymentId: input.paymentId,
						status: newPaymentStatus,
						amountInCents: payment.amountInCents,
						refundedTotalInCents: totalRefundedForPayment,
					},
					invoice: {
						invoiceId: payment.invoiceId,
						amountPaidInCents: newAmountPaid,
						totalInCents: total,
						status: newStatus,
					},
				},
				audit: buildPartyAuditEntries({
					action: AUDIT_ACTIONS.REFUND_ISSUED,
					consumerUserId: payment.invoice.userId,
					payerUserId: payment.invoice.billedToUserId,
					entityType: "InvoiceRefund",
					entityId: refund.refundId,
					metadata: {
						amountInCents: input.amountInCents,
						paymentId: input.paymentId,
						invoiceId: payment.invoiceId,
						reason,
					},
				}),
			};
		},
	);
}
