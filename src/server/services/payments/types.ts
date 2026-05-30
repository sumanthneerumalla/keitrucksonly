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
 *   - §23 #5 — `ClerkPersistentError` is re-exported from `createUserAccount.ts`
 *     so callers can `import { ClerkPersistentError } from
 *     '~/server/services/payments/types'` without reaching into auth utilities.
 *   - §23 #9 — `createRefund` does NOT carry a `reverseTransfer` flag.
 *     `reverse_transfer` is invalid for direct charges and the Stripe API
 *     rejects it; only `refundApplicationFee` survives.
 *   - §23 #10 — Clerk `signInTokens.createSignInToken({ userId, expiresInSeconds })`
 *     uses required `expiresInSeconds` (handled inside `createUserAccount.ts`).
 */

import { ClerkPersistentError } from "~/server/utils/createUserAccount";

export { ClerkPersistentError };

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
 * Thrown by the webhook handler when an event's `livemode` flag disagrees
 * with `process.env.STRIPE_LIVEMODE`. Suggests a misregistered endpoint.
 */
export class LivemodeMismatchError extends Error {
	readonly event: ProviderEvent;
	constructor(event: ProviderEvent) {
		super(
			`livemode mismatch: event=${event.livemode} env=${process.env.STRIPE_LIVEMODE}`,
		);
		this.name = "LivemodeMismatchError";
		this.event = event;
	}
}

/**
 * Thrown by `dispatchParsedEvent` when a checkout completes for a row we
 * cannot reconcile (unknown metadata.checkoutSessionId, missing held rental,
 * unknown club, …). The webhook failure module catches this and writes an
 * `OrphanedPurchase` row with the carried `reason`.
 */
export class OrphanError extends Error {
	readonly reason: string;
	constructor(args: { reason: string; message?: string }) {
		super(args.message ?? `orphan: ${args.reason}`);
		this.name = "OrphanError";
		this.reason = args.reason;
	}
}

/**
 * Thrown when a paid event-registration webhook arrives but the event is
 * already fully booked (capacity race per §11). The failure module catches,
 * auto-refunds via `provider.createRefund` with idempotency key
 * `auto-refund-<sessionId>`, then writes an `OrphanedPurchase` row.
 */
export class CapacityRaceError extends Error {
	readonly sessionId: string;
	readonly paymentIntentId: string | null;
	constructor(args: { sessionId: string; paymentIntentId: string | null }) {
		super("capacity race — seat filled pre-webhook");
		this.name = "CapacityRaceError";
		this.sessionId = args.sessionId;
		this.paymentIntentId = args.paymentIntentId;
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
 * What a checkout is "about". Mirrors the JSON written to
 * `CheckoutSession.intent` (read-only audit/debug) and the metadata.* fields
 * stamped on the Stripe session (§7.6 contract).
 *
 * `metadata.consumerUserId` is `''` (empty string) on guest checkouts —
 * Stripe's metadata column is string-typed and doesn't accept null.
 */
export interface CheckoutIntent {
	itemKind: CheckoutItemKind;
	/** packagePlanId, eventId, rentalBookingId, invoiceId, or membershipPlanId. */
	itemId: string;
	/** Logged-in self / parent-buying-for-kid. Absent for guest shop. */
	consumerUserId?: string;
	amountInCents: number;
	description: string;
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
	createOnboardingLink(args: {
		clubShortName: string;
		returnUrl: string;
		refreshUrl: string;
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
	}): ProviderEvent;

	parseEvent(event: ProviderEvent): Promise<ParsedProviderEvent>;
}
