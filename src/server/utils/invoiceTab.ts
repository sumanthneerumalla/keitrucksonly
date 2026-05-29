import type { Invoice, Prisma } from "@prisma/client";
import { assertLineItemKindConsistency } from "~/server/utils/invoiceLineItems";

/**
 * Phase 9a — auto credit carry-forward toggle. OFF: the club owner wants to
 * control WHEN overpayment credit is applied (manually, via Record Payment →
 * "Account credit"), NOT have it silently pulled onto the next new invoice.
 * When false, opening a new running-tab invoice carries NO auto-applied credit
 * lines; the credit stays available for a deliberate Account-Credit application.
 * (Global for now — promote to a per-club Club setting if clubs ever differ.)
 */
export const AUTO_APPLY_CREDIT_ON_NEW_INVOICE = false;

type TxClient = Prisma.TransactionClient;

export interface GetOrCreateOpenInvoiceArgs {
	clubShortName: string;
	/** The consumer — the member whose charges this tab holds (Invoice.userId). */
	consumerUserId: string;
	/**
	 * The effective payer = `billToUserId ?? consumer`. The running-tab find,
	 * credit pull, and the caller-held advisory lock are all keyed off this.
	 * Collapses to the consumer for self-pay.
	 */
	effectivePayerUserId: string;
	/** Facility stamped on a NEW invoice (usually the member's active facility). */
	facilityId: string | null;
	/** Staff/actor who triggered the charge — stamped as `createdBy` on a NEW invoice. */
	createdByUserId: string;
}

export interface GetOrCreateOpenInvoiceResult {
	invoice: Invoice;
	/** Sum of credit pulled forward onto a NEW invoice (0 when appending, or when AUTO off). */
	totalCreditPulledCents: number;
	/**
	 * Number of CREDIT line items added (they occupy sortOrder [0..n); the
	 * caller's own charge line should sort AFTER them, i.e. at `creditLineCount`).
	 */
	creditLineCount: number;
	/** True when a fresh invoice was opened; false when an existing tab was reused. */
	isNew: boolean;
}

/**
 * Find the member's open running-tab invoice for the (consumer, payer) pair, or
 * open a fresh one (carrying overpayment credit forward when
 * `AUTO_APPLY_CREDIT_ON_NEW_INVOICE` is on). Shared by every charge SOURCE that
 * appends to a tab (package sale, ad-hoc charge, event-registration charge) so
 * they all route to the SAME tab with identical numbering, Option-3
 * (consumer,payer) keying, and credit handling.
 *
 * PRECONDITION: the caller MUST already hold the per-payer advisory lock
 * (`invoice-payer-${effectivePayerUserId}-${clubShortName}`) for the lifetime of
 * `tx`, acquired as the FIRST statement of the transaction. That lock serializes
 * concurrent charges on the same payer's tab — otherwise two simultaneous
 * charges each fail to find an open tab and both open duplicate invoices, and
 * both pull the same credit sources twice (a real money bug). Every invoice
 * mutation already takes this lock; keeping it in the caller (not here) matches
 * that pattern and keeps this helper to the single responsibility of
 * find-or-create.
 *
 * Does NOT append the caller's charge line or recompute totals — the caller adds
 * its own line item(s) and recomputes subtotal/total/status (the recompute
 * inputs differ per charge source). On a NEW invoice the returned `invoice` row
 * still has 0/0/0 money columns even though negative credit lines may already be
 * written; the caller folds the credit in via `totalCreditPulledCents`, exactly
 * as `sellPackage` did before this extraction.
 */
export async function getOrCreateOpenInvoice(
	tx: TxClient,
	args: GetOrCreateOpenInvoiceArgs,
): Promise<GetOrCreateOpenInvoiceResult> {
	const {
		clubShortName,
		consumerUserId,
		effectivePayerUserId,
		facilityId,
		createdByUserId,
	} = args;

	// Option 3 (HANDOFF #112 + #116): each (consumer, payer) pair gets its OWN
	// running tab, so ONE invoice = exactly ONE consumer. Match `billedToUserId`
	// PRECISELY:
	//   - self-pay (effective payer === consumer) → billedToUserId: null
	//   - bill-to  (effective payer !== consumer) → billedToUserId: payer
	// So charges for Mary-billed-to-John land on the (Mary, John) tab and never
	// co-mingle with John's own self-pay tab or a (Tim, John) tab. The
	// credit-source query below stays PAYER-scoped (A1, HANDOFF #111) — credit
	// follows the payer across consumers.
	const runningTabBilledToUserId =
		effectivePayerUserId === consumerUserId ? null : effectivePayerUserId;

	// Excludes void/paid — only draft/open/partially_paid absorb new charges.
	// `closedAt: null` excludes closed tabs (manual close, or auto-close on full
	// payment — Round 4 / HANDOFF #103/#108).
	const existing = await tx.invoice.findFirst({
		where: {
			clubShortName,
			userId: consumerUserId,
			billedToUserId: runningTabBilledToUserId,
			status: { in: ["draft", "open", "partially_paid"] },
			closedAt: null,
		},
		orderBy: { issueDate: "asc" }, // oldest first if ever multiple
	});

	if (existing) {
		return {
			invoice: existing,
			totalCreditPulledCents: 0,
			creditLineCount: 0,
			isNew: false,
		};
	}

	// No open tab — open a new invoice with the next sequential number. Atomic
	// increment: post-bump value minus 1 is the number we just consumed. With
	// @default(1), the first invoice is INV-000001.
	const club = await tx.club.update({
		where: { clubShortName },
		data: { nextInvoiceNumber: { increment: 1 } },
		select: { nextInvoiceNumber: true },
	});
	const seq = club.nextInvoiceNumber - 1;
	const invoiceNumber = `INV-${String(seq).padStart(6, "0")}`;

	const invoice = await tx.invoice.create({
		data: {
			clubShortName,
			invoiceNumber,
			userId: consumerUserId,
			// Only set `billedToUserId` when it genuinely differs from the consumer;
			// null = "self-pay" (the pre-Round-5 schema default).
			billedToUserId: runningTabBilledToUserId,
			facilityId,
			status: "open",
			subtotalInCents: 0,
			taxTotalInCents: 0,
			totalInCents: 0,
			amountPaidInCents: 0,
			createdBy: createdByUserId,
		},
	});

	// Phase 9a Round 4 — credit carry-forward (FIFO, payer-scoped). Find
	// auto-closed (paid + closedAt set) invoices for this PAYER with unconsumed
	// overpayment credit. Prisma can't express `amountPaidInCents > totalInCents`
	// directly, so we fetch closed+paid+unconsumed invoices and filter for actual
	// credit (positive net) in JS. `orderBy closedAt asc` = oldest credit first.
	const creditSources = await tx.invoice.findMany({
		where: {
			clubShortName,
			status: "paid",
			closedAt: { not: null },
			creditConsumedAt: null,
			OR: [
				{ userId: effectivePayerUserId, billedToUserId: null },
				{ billedToUserId: effectivePayerUserId },
			],
		},
		orderBy: { closedAt: "asc" },
		select: {
			invoiceId: true,
			invoiceNumber: true,
			totalInCents: true,
			amountPaidInCents: true,
			creditConsumedInCents: true,
			userId: true,
			billedToUserId: true,
		},
	});

	// Auto carry-forward is gated by AUTO_APPLY_CREDIT_ON_NEW_INVOICE (OFF by
	// default — the owner applies credit manually). When off we select NO
	// sources, so the loop below is a no-op and the new invoice carries no
	// auto-applied credit lines (credit stays available).
	const sourcesWithCredit = AUTO_APPLY_CREDIT_ON_NEW_INVOICE
		? creditSources.filter(
				(s) =>
					s.amountPaidInCents - s.totalInCents - s.creditConsumedInCents > 0,
			)
		: [];

	// Add a negative line item per credit source + stamp each source's
	// `creditConsumedAt`. Empty `sourcesWithCredit` → no DB writes, totals stay 0.
	let totalCreditPulledCents = 0;
	let sortIndex = 0;
	for (const s of sourcesWithCredit) {
		// Remaining (not gross) credit — an Account-Credit application may have
		// already spent part of this source.
		const creditCents =
			s.amountPaidInCents - s.totalInCents - s.creditConsumedInCents;

		assertLineItemKindConsistency({
			kind: "CREDIT",
			creditFromInvoiceId: s.invoiceId,
		});
		await tx.invoiceLineItem.create({
			data: {
				invoiceId: invoice.invoiceId,
				kind: "CREDIT",
				description: `Credit from ${s.invoiceNumber}`,
				quantity: 1,
				unitPriceInCents: -creditCents,
				discountInCents: 0,
				taxRateBps: 0,
				taxAmountInCents: 0,
				totalInCents: -creditCents,
				sortOrder: sortIndex, // credits sort before the caller's charge line
				creditFromInvoiceId: s.invoiceId,
				// Snapshot the source's payer (whose credit this is).
				creditFromUserId: s.billedToUserId ?? s.userId,
			},
		});

		await tx.invoice.update({
			where: { invoiceId: s.invoiceId },
			// Carry-forward consumes the source's ENTIRE remaining credit: bump the
			// counter to the full overpayment and stamp `creditConsumedAt`.
			data: {
				creditConsumedInCents: s.amountPaidInCents - s.totalInCents,
				creditConsumedAt: new Date(),
			},
		});

		totalCreditPulledCents += creditCents;
		sortIndex += 1;
	}

	return {
		invoice,
		totalCreditPulledCents,
		creditLineCount: sourcesWithCredit.length,
		isNew: true,
	};
}
