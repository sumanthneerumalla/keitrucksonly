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

/**
 * A reference to a person, reusable across invoice surfaces + future reports.
 * `userId` null = display-only (no link); set = a renderer MAY deep-link to
 * /clients/{userId}. Staff-attribution refs (closedBy/receivedBy/refundedBy)
 * are OMITTED (null) by the assembler for `audience: "customer"` (phase9c §4.3).
 */
export type RenderablePersonRef = { userId: string | null; fullName: string };

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
	/** Staff who marked the invoice due ("closed"). Staff-only → null for customer audience. */
	closedBy: RenderablePersonRef | null;
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
	/** Staff who issued the refund. Staff-only → null for customer audience. */
	refundedBy: RenderablePersonRef | null;
};

/**
 * A refund flattened to the invoice level for a dedicated Refunds section.
 * Built FROM the nested payment refunds in one assembler pass (phase9c §4.3) —
 * amounts are never omitted; only `refundedBy` attribution is omitted for
 * customers.
 */
export type RenderableInvoiceRefund = {
	refundId: string;
	paymentId: string;
	refundedAt: Date;
	amountInCents: number;
	reason: string | null;
	refundedBy: RenderablePersonRef | null;
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
	/** Staff who recorded the payment. Staff-only → null for customer audience. */
	receivedBy: RenderablePersonRef | null;
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
	/** Flattened refunds for a dedicated Refunds section (mirror of payments[].refunds). */
	refunds: RenderableInvoiceRefund[];
	footer: RenderableInvoiceFooter;
};

// ---------------------------------------------------------------------------
// ViewerCapabilities + InvoiceView — the WEB-only wrapper (phase9c §4.2).
//
// The PDF consumes only `RenderableInvoice`. The web tRPC `getInvoice` returns
// `InvoiceView`. Capabilities carry ONLY what's cheaply derivable from the
// already-loaded invoice + viewer (no new queries). `canPayNow` is NOT here —
// it needs the club's Stripe-Connect health, resolved as a page prop.
// ---------------------------------------------------------------------------

export type ViewerCapabilities = {
	/** consumer/payer = false; facility-and-above / platform admin = true. */
	isStaff: boolean;
	/** Gates Void; club admin or platform admin in the invoice's club. */
	isClubAdmin: boolean;
	/** This invoice's overpayment credit was consumed elsewhere → refund blocked. */
	hasConsumedCredit: boolean;
};

export type InvoiceView = {
	invoice: RenderableInvoice;
	viewer: ViewerCapabilities;
};
