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
	memberMembershipId?: string | null;
	memberPackageId?: string | null;
	productId?: string | null;
	eventRegistrationId?: string | null;
}): void {
	if (d.kind === "PACKAGE_SALE" && !d.packagePlanId) {
		throw new Error("InvoiceLineItem kind=PACKAGE_SALE requires packagePlanId");
	}
	// CREDIT lines: negative-amount overpayment-credit adjustments.
	// THREE possible provenance shapes (post Round 3.6):
	//   1. Auto-carry-forward: creditFromInvoiceId SET, creditFromPaymentId NULL
	//      (carry-forward from a prior auto-closed overpaid invoice)
	//   2. Admin refund-as-credit: creditFromInvoiceId NULL, creditFromPaymentId SET
	//      (adjustment issued by `issueAccountCreditFromPayment` instead of
	//      a money-back refund; the FK back to the funding payment lets
	//      the refundable-cap math subtract credit-issued from the
	//      payment's remaining balance)
	//   3. (Hypothetical) creditFromInvoiceId SET + creditFromPaymentId SET —
	//      not used today
	// All: unitPriceInCents + totalInCents are negative; productId/packagePlanId/
	// memberPackageId/memberMembershipId/eventRegistrationId MUST be null.
	// No assertion changes — both creditFromInvoiceId and creditFromPaymentId
	// are nullable; producers set whichever applies.
	if (d.kind === "CREDIT") {
		if (d.packagePlanId) {
			throw new Error("InvoiceLineItem kind=CREDIT must not set packagePlanId");
		}
		if (d.memberPackageId) {
			throw new Error(
				"InvoiceLineItem kind=CREDIT must not set memberPackageId",
			);
		}
		if (d.memberMembershipId) {
			throw new Error(
				"InvoiceLineItem kind=CREDIT must not set memberMembershipId",
			);
		}
		if (d.productId) {
			throw new Error("InvoiceLineItem kind=CREDIT must not set productId");
		}
		if (d.eventRegistrationId) {
			throw new Error(
				"InvoiceLineItem kind=CREDIT must not set eventRegistrationId",
			);
		}
	}
	if (d.kind === "MEMBERSHIP_FEE" && !d.memberMembershipId) {
		throw new Error(
			"InvoiceLineItem kind=MEMBERSHIP_FEE requires memberMembershipId",
		);
	}
	if (d.kind === "PRODUCT_SALE" && !d.productId) {
		throw new Error("InvoiceLineItem kind=PRODUCT_SALE requires productId");
	}
	if (d.kind === "EVENT_REGISTRATION" && !d.eventRegistrationId) {
		throw new Error(
			"InvoiceLineItem kind=EVENT_REGISTRATION requires eventRegistrationId",
		);
	}
	if (d.kind === "RENTAL") {
		// Rentals MAY have a productId (the schema's `RentalBooking.productId`
		// is nullable — a court rental that hasn't been associated with a
		// priced product still produces a line item). What we assert is what
		// we don't permit: rental lines must NOT carry package/membership/
		// credit/event provenance FKs.
		if (d.packagePlanId) {
			throw new Error("InvoiceLineItem kind=RENTAL must not set packagePlanId");
		}
		if (d.memberPackageId) {
			throw new Error(
				"InvoiceLineItem kind=RENTAL must not set memberPackageId",
			);
		}
		if (d.memberMembershipId) {
			throw new Error(
				"InvoiceLineItem kind=RENTAL must not set memberMembershipId",
			);
		}
		if (d.creditFromInvoiceId) {
			throw new Error(
				"InvoiceLineItem kind=RENTAL must not set creditFromInvoiceId",
			);
		}
		if (d.eventRegistrationId) {
			throw new Error(
				"InvoiceLineItem kind=RENTAL must not set eventRegistrationId",
			);
		}
	}
}
