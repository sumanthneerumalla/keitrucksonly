/**
 * Phase 9b — Invoice rendering DTO + shared label maps.
 *
 * This file is the CONTRACT between data and presentation. Two renderers
 * consume `RenderableInvoice`:
 *
 *   1. The on-screen invoice view
 *      (src/app/_components/billing/InvoiceDetail.tsx).
 *      In v1 the web view still binds to billing.getInvoice's existing shape
 *      directly; the incremental migration to the DTO is tracked as TD-9b-1
 *      in designFiles/roadmap/phase9b-invoice-pdf.md. New invoice display
 *      data MUST be added to this DTO and to the assembler, NOT computed
 *      ad-hoc inside InvoiceDetail.tsx.
 *
 *   2. The PDF renderer (src/server/services/invoiceRenderer/pdf/...).
 *      Pure consumer of this DTO — no Prisma, no auth, no DB access.
 *
 * Drift prevention:
 *   - TypeScript catches field renames/removals at compile time.
 *   - Labels (kind, payment method) live HERE, not in the renderers; both
 *     surfaces import from this module.
 *   - The status pill copy continues to flow through src/lib/invoiceStatus.ts
 *     so the staff/member wording stays consistent across both surfaces.
 *
 * Money is always integer cents. Negative values are credits (per the
 * Version-A overpayment policy, HANDOFF #104).
 */

import type { InvoiceLineItemKind } from "@prisma/client";

// ---------------------------------------------------------------------------
// Shared label maps — now defined in ~/lib/invoice/labels.ts (client-safe so
// InvoiceDetail.tsx can import them too) and re-exported here for back-compat
// with existing importers (assemble.ts, etc.).
// ---------------------------------------------------------------------------

export { KIND_LABELS, PAYMENT_METHOD_LABELS } from "~/lib/invoice/labels";

// ---------------------------------------------------------------------------
// RenderableInvoice — the DTO.
// ---------------------------------------------------------------------------

export type RenderableInvoiceMeta = {
	invoiceId: string;
	invoiceNumber: string; // "INV-000003"
	/** Stored status from the DB: draft | open | partially_paid | paid | void. */
	rawStatus: string;
	/** Pre-formatted human label, e.g. "Open tab · $1,000.00" / "Paid". */
	statusLabel: string;
	statusTone: "success" | "warn" | "neutral" | "muted";
	issueDate: Date;
	dueDate: Date | null;
	closedAt: Date | null;
	notes: string | null;
};

export type RenderableInvoiceFrom = {
	clubName: string;
	facilityName: string | null;
	streetAddress: string | null;
	city: string | null;
	state: string | null;
	zipCode: string | null;
	phone: string | null;
	email: string | null;
};

export type RenderableInvoiceParty = {
	userId: string;
	fullName: string;
	email: string | null;
	/** From MemberClubProfile.phone for the invoice's club (per-club-profiles.md). */
	phone: string | null;
	/** Reserved — address rendering not wired yet; always null in v1. */
	address: string | null;
};

export type RenderableInvoiceLine = {
	lineItemId: string;
	kind: InvoiceLineItemKind;
	kindLabel: string;
	description: string;
	quantity: number;
	unitPriceInCents: number; // signed
	discountInCents: number;
	taxRateBps: number;
	taxAmountInCents: number;
	totalInCents: number; // signed
	revenueCategoryLabel: string | null;
	/** CREDIT lines name their source payer + invoice for the audit trail. */
	creditSource: {
		invoiceNumber: string | null;
		payerName: string;
	} | null;
};

export type RenderableInvoiceTotals = {
	subtotalInCents: number;
	taxTotalInCents: number;
	totalInCents: number;
	amountPaidInCents: number;
	/** Signed; negative = account credit. */
	balanceInCents: number;
	/** Controls whether the line-items table renders a Tax column. */
	hasAnyTax: boolean;
};

export type RenderableInvoicePaymentRefund = {
	refundId: string;
	refundedAt: Date;
	/** Positive number; renderers should display it as negative. */
	amountInCents: number;
	reason: string | null;
};

export type RenderableInvoicePayment = {
	paymentId: string;
	receivedAt: Date;
	methodLabel: string;
	processor: string | null;
	reference: string | null;
	amountInCents: number;
	refundedTotalInCents: number;
	netInCents: number;
	refunds: RenderableInvoicePaymentRefund[];
};

export type RenderableInvoiceFooter = {
	/** Future: Club.invoiceFooterText. Always null in v1 (branding deferred). */
	text: string | null;
};

/**
 * Fully resolved view of one invoice, ready to be drawn to any surface.
 *
 * Returned from `assembleRenderableInvoice` with a TOP-LEVEL shallow
 * Object.freeze: reassigning top-level keys (`dto.lines = ...`) throws in
 * strict mode, but nested mutations (`dto.lines.push(...)`,
 * `dto.totals.balanceInCents = 0`) succeed silently. Renderers must treat
 * the DTO as read-only by convention.
 */
export type RenderableInvoice = {
	meta: RenderableInvoiceMeta;
	from: RenderableInvoiceFrom;
	consumer: RenderableInvoiceParty;
	/** Null when the consumer is also the payer (i.e. self-pay invoice). */
	billedTo: RenderableInvoiceParty | null;
	lines: RenderableInvoiceLine[];
	totals: RenderableInvoiceTotals;
	payments: RenderableInvoicePayment[];
	footer: RenderableInvoiceFooter;
};
