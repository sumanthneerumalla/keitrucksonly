/**
 * Shared invoice label maps — the SINGLE source of truth for both the on-screen
 * invoice view (src/app/_components/billing/InvoiceDetail.tsx, a client
 * component) and the PDF renderer (src/server/services/invoiceRenderer/*).
 *
 * These live in ~/lib (not inside the server-only invoiceRenderer module) so
 * the "use client" InvoiceDetail can import them WITHOUT pulling in
 * @react-pdf/renderer's Node-only deps (fontkit/zlib). The renderer's
 * `types.ts` re-exports from here for back-compat with existing importers.
 *
 * Record<string, string> (not the enum type) so an unmapped future enum value
 * still renders via each caller's `?? kind` fallback rather than throwing.
 */

/** InvoiceLineItem.kind → short badge/label in the line-items table. */
export const KIND_LABELS: Record<string, string> = {
	PACKAGE_SALE: "Package",
	CREDIT: "Credit",
	PRODUCT_SALE: "Product",
	FEE: "Fee",
	EVENT_REGISTRATION: "Event",
	RENTAL: "Rental",
	MEMBERSHIP_FEE: "Membership",
};

/** InvoicePayment.paymentMethod → display label. */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
	cash: "Cash",
	check: "Check",
	credit_card: "Credit card",
	pos_transaction: "POS transaction",
	stripe: "Stripe",
	paysafe: "Paysafe",
	other: "Other",
};
