/**
 * Phase 12a — PaymentProvider interface + shared payment-domain types.
 *
 * Source of truth for the multi-processor abstraction described in
 * designFiles/roadmap/phase12-stripe-connect.md §4. Stripe-specific code lives
 * exclusively in `stripe.ts`; every other surface (webhook handler, dispatch,
 * failure module, tRPC payments router) talks to this interface.
 *
 * Locked decisions reflected here:
 *   - §23 #1 — per-processor connection tables; this interface is agnostic.
 *   - §23 #9 — `createRefund` does NOT carry a `reverseTransfer` flag.
 *     `reverse_transfer` is invalid for direct charges and the Stripe API
 *     rejects it; only `refundApplicationFee` survives.
 *   - §23 #10 — Tier 1 email rollout: the public-shop confirmation page links
 *     to `/sign-in?identifier=<email>` and Clerk sends the OTP on the user's
 *     click. No sign-in token is minted in 12a. The Tier 3 mailer with a
 *     one-click magic link (which WOULD mint `signInTokens.createSignInToken`
 *     with the required `expiresInSeconds`) is future polish — not wired today.
 *
 * Errors are now TWO classes (collapsed 2026-05-30 from five):
 *   - `SignatureError` — route handler treats specially (400 response).
 *   - `WebhookFailure` — every other persistent failure; carries a `reason`
 *     string the failure module switches on to pick the orphan-write +
 *     auto-refund behavior. End-to-end behavior (OrphanedPurchase row +
 *     return 200 to Stripe) is unchanged from the old per-class shape.
 */

import type { FamilyGroupLinkOutcome } from "~/server/utils/familyGroups";

export type { FamilyGroupLinkOutcome };

// ============================================================
// Processor identity
// ============================================================

export type ProcessorName = "stripe" | "paysafe" | "valor";

// ============================================================
// Errors (re-thrown across the provider boundary)
// ============================================================

/** Thrown by `verifyWebhookSignature` when Stripe sig verification fails. */
export class SignatureError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SignatureError";
	}
}

/**
 * Single class for every persistent webhook-dispatch failure that should
 * land as an `OrphanedPurchase` row + return 200 to Stripe. The `reason`
 * string discriminates the cases the failure module previously matched on
 * `instanceof <SubclassError>`. Known reasons (extensible — column is
 * String, not enum):
 *
 *   - `'livemode_mismatch'`                      — event livemode flag
 *                                                  disagrees with env
 *   - `'clerk_create_failed'`                    — multi-Clerk-user
 *                                                  collision (single-identity)
 *   - `'clerk_create_failed_buyer'`              — multi-Clerk-user buyer
 *   - `'clerk_create_failed_beneficiary'`        — multi-Clerk-user beneficiary
 *   - `'capacity_race'`                          — event seat filled
 *                                                  pre-webhook (failure
 *                                                  module also issues an
 *                                                  auto-refund)
 *   - `'unknown_metadata'`                       — orphan: cannot reconcile
 *                                                  metadata.checkoutSessionId
 *                                                  / itemId
 *   - `'unknown_club'`                           — no matching club for the
 *                                                  resolved short name
 *   - `'no_email'`                               — guest flow without an
 *                                                  email
 *   - `'rental_userid_mismatch'`                 — held booking userId !=
 *                                                  checkout consumer
 *   - `'stripe_dashboard_refund_with_consumed_credit'` — D1 guard on refund
 *                                                        Path B sync
 *   - `'seat_filled_pre_webhook'`                — orphan-row reason after
 *                                                  capacity_race auto-refund
 *   - `'dispatch_failed'`                        — catch-all in failure.ts
 *
 * The `context` object is best-effort metadata for the orphan row's notes
 * column (e.g. `{ sessionId, paymentIntentId }` for capacity races).
 */
export class WebhookFailure extends Error {
	readonly reason: string;
	readonly context?: Record<string, unknown>;
	constructor(reason: string, context?: Record<string, unknown>) {
		super(`Webhook failure: ${reason}`);
		this.name = "WebhookFailure";
		this.reason = reason;
		this.context = context;
	}
}

// ============================================================
// Events (provider-agnostic shape)
// ============================================================

export interface ProviderEvent {
	id: string;
	type: string;
	livemode: boolean;
	/** Opaque payload — the parser is the only one that should poke at this. */
	raw: unknown;
}

export type ParsedProviderEvent =
	| {
			kind: "checkout.completed";
			sessionId: string;
			paymentIntentId: string | null;
			chargeId: string | null;
			amountInCents: number;
			feeInCents: number | null;
			email: string | null;
			customerName: string | null;
			providerCustomerId: string | null;
			metadata: Record<string, string>;
			livemode: boolean;
	  }
	| {
			kind: "refund.created";
			refundId: string;
			paymentIntentId: string | null;
			chargeId: string | null;
			amountInCents: number;
			feeInCents: number | null;
			livemode: boolean;
	  }
	| {
			kind: "account.updated";
			providerAccountId: string;
			chargesEnabled: boolean;
			payoutsEnabled: boolean;
			detailsSubmitted: boolean;
	  }
	/**
	 * Accounts v2 migration (2026-06-01). v2 connected accounts deliver
	 * `v2.core.account.updated` instead of v1's `account.updated`. The
	 * downstream effect is identical (sync `ClubStripeAccount` flags +
	 * emit `STRIPE_ACCOUNT_UPDATED` audit) — we keep the variant kinds
	 * distinct so the dispatcher's switch is exhaustive and the v1 case
	 * stays available as a safety net for any straggler v1 deliveries.
	 */
	| {
			kind: "v2.account.updated";
			providerAccountId: string;
			chargesEnabled: boolean;
			payoutsEnabled: boolean;
			detailsSubmitted: boolean;
	  }
	| {
			kind: "payment_intent.failed";
			paymentIntentId: string;
			reason: string | null;
	  }
	| { kind: "unhandled" };

// ============================================================
// Checkout intent (the cross-surface payload §7.1)
// ============================================================

export type CheckoutItemKind =
	| "package"
	| "event"
	| "rental"
	| "invoice"
	| "membership";

/**
 * Two-identity capture block (§7.8.1). Both `beneficiary` and `payer` are
 * normalized (lowercase + trim on email) BEFORE being stamped into intent.
 */
export interface CheckoutIdentityBlock {
	firstName: string;
	lastName: string;
	/** Normalized: lowercase + trim. §7.8.3 STRICT match rules. */
	email: string;
}

/**
 * What a checkout is "about". Mirrors the JSON written to
 * `CheckoutSession.intent` (read-only audit/debug) and the metadata.* fields
 * stamped on the Stripe session (§7.6 contract).
 *
 * `metadata.consumerUserId` is `''` (empty string) on guest checkouts —
 * Stripe's metadata column is string-typed and doesn't accept null.
 *
 * §7.8 two-identity extension (Round 2.7): when the pre-Stripe form
 * captures both beneficiary + payer (parent-buying-for-kid case), the
 * webhook reads them from `intent.beneficiary` and `intent.payer` to
 * find-or-create both user rows. Backwards compatible: when either block
 * is absent we fall back to single-identity behavior.
 *
 * The `familyGroupOutcome` slot is stamped by the webhook AFTER linking
 * runs, so the confirmation page (§7.8.7) can render the right branch
 * via `getCheckoutSessionStatus`. We store it inline on `intent` rather
 * than adding a new column on CheckoutSession — Phase 12a Round 2.7 spec
 * explicitly prefers JSON storage to avoid a migration.
 */
export interface CheckoutIntent {
	itemKind: CheckoutItemKind;
	/** packagePlanId, eventId, rentalBookingId, invoiceId, or membershipPlanId. */
	itemId: string;
	/** Logged-in self / parent-buying-for-kid. Absent for guest shop. */
	consumerUserId?: string;
	amountInCents: number;
	description: string;
	/** §7.8 — captured at the pre-Stripe form. Both optional for back-compat. */
	beneficiary?: CheckoutIdentityBlock;
	payer?: CheckoutIdentityBlock;
	/** Stamped by the webhook after `linkFamilyGroup` runs. */
	familyGroupOutcome?: FamilyGroupLinkOutcome;
	metadata: {
		checkoutSessionId: string;
		clubShortName: string;
		itemKind: CheckoutItemKind;
		itemId: string;
		consumerUserId?: string;
		invoiceId?: string;
		billToUserId?: string;
		correlationId: string;
	};
}

// ============================================================
// PaymentProvider — the multi-processor contract
// ============================================================

export interface PaymentProvider {
	readonly processor: ProcessorName;

	// -------- Onboarding --------
	/**
	 * Accounts v2 migration (2026-06-01) — onboarding now requires 5 universal
	 * business identity fields (§6.1, §23 row 12). Stripe's v2 Accounts API
	 * uses them to provision the connected account up-front; the hosted
	 * AccountLink flow then collects everything else (bank account, tax ID,
	 * NTEE for non-profits, …). Future providers (Paysafe/Valor) that don't
	 * need every field should ignore the ones they don't consume.
	 *
	 *   businessName  registered legal name (Stripe `identity.business_details.
	 *                                        registered_name`)
	 *   country       ISO-3166-1 alpha-2, lowercase (Stripe `identity.country`)
	 *   entityType    'company' | 'individual' | 'non_profit' | 'government_entity'
	 *   contactEmail  primary contact (Stripe `contact_email`)
	 *   displayName   public-facing display name (Stripe `display_name`);
	 *                 defaults to `businessName` when omitted.
	 */
	createOnboardingLink(args: {
		clubShortName: string;
		returnUrl: string;
		refreshUrl: string;
		businessName: string;
		country: string;
		entityType: "company" | "individual" | "non_profit" | "government_entity";
		contactEmail: string;
		displayName?: string;
	}): Promise<{ url: string; providerAccountId: string }>;

	refreshAccountStatus(providerAccountId: string): Promise<{
		chargesEnabled: boolean;
		payoutsEnabled: boolean;
		detailsSubmitted: boolean;
		accountEmail: string | null;
		livemode: boolean;
	}>;

	// -------- Checkout --------
	createCheckoutSession(args: {
		providerAccountId: string;
		amountInCents: number;
		currency: "usd";
		description: string;
		customerEmail?: string;
		providerCustomerId?: string;
		applicationFeeInCents?: number;
		/** See §7.6 metadata contract. */
		metadata: Record<string, string>;
		returnUrl: string;
		/**
		 * Round 2.7.1 — when the provider-side session should expire. The
		 * caller mirrors this onto `CheckoutSession.expiresAt` so the local
		 * mirror and the provider stay in sync. StripeProvider passes this
		 * as `expires_at` (Unix seconds). Optional only for provider
		 * implementations that don't support session expiry; Stripe does.
		 */
		expiresAt?: Date;
	}): Promise<{ sessionId: string; clientSecret: string }>;

	// -------- Refund --------
	/**
	 * Direct-charge refund. StripeProvider passes `{ stripeAccount }` as the
	 * request option and (when `refundApplicationFee=true`) sets
	 * `refund_application_fee: true` on the SDK call. `reverse_transfer` is
	 * NEVER passed — invalid for direct charges (§23 #9).
	 */
	createRefund(args: {
		providerAccountId: string;
		providerChargeId: string;
		providerPaymentIntentId: string;
		amountInCents: number;
		refundApplicationFee: boolean;
		idempotencyKey: string;
	}): Promise<{ providerRefundId: string; feeInCents: number | null }>;

	// -------- Webhook --------
	verifyWebhookSignature(args: {
		rawBody: string;
		signatureHeader: string | null;
		endpointKind: "platform" | "connect";
	}): Promise<ProviderEvent>;

	parseEvent(event: ProviderEvent): Promise<ParsedProviderEvent>;
}
