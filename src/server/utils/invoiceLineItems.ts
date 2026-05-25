/**
 * Phase 9a line-item hardening — the DB can't enforce that an
 * `InvoiceLineItem`'s `kind` discriminator matches the provenance FKs that are
 * set (a cross-column rule a Postgres enum can't express), so every producer of
 * a line item asserts it here. Keeps the discriminator honest as more charge
 * sources are added (package sale, credit carry-forward, account-credit
 * application, refunds, …). Throws on mismatch — a programmer error, since the
 * values are constants in each producer, so it should never fire in practice;
 * it guards future edits.
 *
 * Extracted from `packages.ts` (where `sellPackage` produces package + credit
 * lines) into a neutral util so the billing router's account-credit path can
 * share the same guard without a router-to-router import.
 */
export function assertLineItemKindConsistency(d: {
	kind: string;
	packagePlanId?: string | null;
	creditFromInvoiceId?: string | null;
}): void {
	if (d.kind === "PACKAGE_SALE" && !d.packagePlanId) {
		throw new Error("InvoiceLineItem kind=PACKAGE_SALE requires packagePlanId");
	}
	if (d.kind === "CREDIT" && !d.creditFromInvoiceId) {
		throw new Error("InvoiceLineItem kind=CREDIT requires creditFromInvoiceId");
	}
}
