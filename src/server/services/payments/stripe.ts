/**
 * Phase 12a — Stripe implementation of `PaymentProvider`.
 *
 * **This is the ONLY file in `src/` allowed to `import 'stripe'`.** The fence
 * is verified by a CI grep (see phase12-stripe-connect.md §17 / phase12a
 * build-plan §2 Stream 2). Webhook handler, dispatch, failure module, tRPC
 * router all go through `PaymentProvider` instead.
 *
 * Lazy SDK initialization: `new Stripe(...)` is constructed on first method
 * call so the Next.js app boots fine without Stripe env vars set. Only the
 * surfaces that actually need Stripe (onboarding, checkout, webhook) hit a
 * misconfiguration error.
 *
 * Charge model: DIRECT charges (§3). Every `checkout.sessions.create` and
 * `refunds.create` is called with `{ stripeAccount: providerAccountId }` as
 * the SDK request option so the charge lives on the connected account.
 */

import Stripe from "stripe";
import { env } from "~/env";
import {
	type ParsedProviderEvent,
	type PaymentProvider,
	type ProviderEvent,
	SignatureError,
} from "~/server/services/payments/types";

// ============================================================
// Lazy Stripe client
// ============================================================

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
	if (_stripe !== null) return _stripe;
	const secret = env.STRIPE_SECRET_KEY;
	if (!secret) {
		throw new Error(
			"STRIPE_SECRET_KEY is not configured — Stripe operations are unavailable.",
		);
	}
	_stripe = new Stripe(secret, {
		// Pin to the SDK's bundled API version (omitted = SDK default, which
		// matches the installed SDK's TypeScript types).
		typescript: true,
	});
	return _stripe;
}

function getWebhookSecret(endpointKind: "platform" | "connect"): string {
	const secret =
		endpointKind === "platform"
			? env.STRIPE_WEBHOOK_SECRET_PLATFORM
			: env.STRIPE_WEBHOOK_SECRET_CONNECT;
	if (!secret) {
		throw new Error(
			`STRIPE_WEBHOOK_SECRET_${endpointKind.toUpperCase()} is not configured.`,
		);
	}
	return secret;
}

// ============================================================
// StripeProvider — every PaymentProvider method
// ============================================================

export class StripeProvider implements PaymentProvider {
	readonly processor = "stripe" as const;

	// -------- Onboarding --------

	async createOnboardingLink(args: {
		clubShortName: string;
		returnUrl: string;
		refreshUrl: string;
	}): Promise<{ url: string; providerAccountId: string }> {
		const stripe = getStripe();
		const account = await stripe.accounts.create({
			type: "standard",
			metadata: { clubShortName: args.clubShortName },
		});
		const link = await stripe.accountLinks.create({
			account: account.id,
			return_url: args.returnUrl,
			refresh_url: args.refreshUrl,
			type: "account_onboarding",
		});
		return { url: link.url, providerAccountId: account.id };
	}

	async refreshAccountStatus(providerAccountId: string): Promise<{
		chargesEnabled: boolean;
		payoutsEnabled: boolean;
		detailsSubmitted: boolean;
		accountEmail: string | null;
		livemode: boolean;
	}> {
		const stripe = getStripe();
		const account: Stripe.Account =
			await stripe.accounts.retrieve(providerAccountId);
		return {
			chargesEnabled: account.charges_enabled,
			payoutsEnabled: account.payouts_enabled,
			detailsSubmitted: account.details_submitted,
			accountEmail: account.email ?? null,
			// Stripe's TS type marks `livemode` as optional on Account but it's
			// always present in practice on real Connect responses.
			livemode:
				(account as unknown as { livemode?: boolean }).livemode ?? false,
		};
	}

	// -------- Checkout --------

	async createCheckoutSession(args: {
		providerAccountId: string;
		amountInCents: number;
		currency: "usd";
		description: string;
		customerEmail?: string;
		providerCustomerId?: string;
		applicationFeeInCents?: number;
		metadata: Record<string, string>;
		returnUrl: string;
		expiresAt?: Date;
	}): Promise<{ sessionId: string; clientSecret: string }> {
		const stripe = getStripe();
		const params: Stripe.Checkout.SessionCreateParams = {
			ui_mode: "embedded",
			mode: "payment",
			billing_address_collection: "required",
			customer_creation: "always",
			return_url: args.returnUrl,
			line_items: [
				{
					quantity: 1,
					price_data: {
						currency: args.currency,
						unit_amount: args.amountInCents,
						product_data: { name: args.description },
					},
				},
			],
			metadata: args.metadata,
			payment_intent_data: {
				// §3 — scaffolded for later. 0 today (no platform fee in 12a).
				application_fee_amount: args.applicationFeeInCents ?? 0,
				metadata: args.metadata,
			},
		};

		if (args.customerEmail) {
			params.customer_email = args.customerEmail;
		}

		// Round 2.7.1 — pass our explicit expiry (default Stripe is 24h;
		// we want 30 min to match `CheckoutSession.expiresAt` + the
		// §7.8.13 banner cutoff). Stripe accepts Unix seconds.
		if (args.expiresAt) {
			params.expires_at = Math.floor(args.expiresAt.getTime() / 1000);
		}

		const session = await stripe.checkout.sessions.create(
			params,
			// Direct charge: act on the connected account.
			{ stripeAccount: args.providerAccountId },
		);

		if (!session.client_secret) {
			throw new Error("Stripe did not return a client_secret for the session.");
		}
		return { sessionId: session.id, clientSecret: session.client_secret };
	}

	// -------- Refund --------

	async createRefund(args: {
		providerAccountId: string;
		providerChargeId: string;
		providerPaymentIntentId: string;
		amountInCents: number;
		refundApplicationFee: boolean;
		idempotencyKey: string;
	}): Promise<{ providerRefundId: string; feeInCents: number | null }> {
		// Stripe interprets a missing `amount` as full refund and rejects
		// `amount: 0`. We require callers to pass an explicit positive amount;
		// "full refund" callers must resolve the PaymentIntent amount up-front
		// and pass it. Guards against the prior `amount: 0` → "full" misread.
		if (args.amountInCents <= 0) {
			throw new Error(
				"createRefund requires a positive amountInCents (Stripe rejects amount=0).",
			);
		}
		const stripe = getStripe();
		const refund = await stripe.refunds.create(
			{
				payment_intent: args.providerPaymentIntentId,
				amount: args.amountInCents,
				refund_application_fee: args.refundApplicationFee,
				// NOTE: No `reverse_transfer` — invalid for direct charges (§23 #9).
			},
			{
				stripeAccount: args.providerAccountId,
				idempotencyKey: args.idempotencyKey,
			},
		);

		// Fee is on the balance_transaction; only retrieve if expand wasn't set.
		let feeInCents: number | null = null;
		if (refund.balance_transaction) {
			if (typeof refund.balance_transaction === "string") {
				try {
					const bt = await stripe.balanceTransactions.retrieve(
						refund.balance_transaction,
						undefined,
						{ stripeAccount: args.providerAccountId },
					);
					feeInCents = bt.fee ?? null;
				} catch {
					// Fee retrieval is best-effort; the refund itself succeeded.
					feeInCents = null;
				}
			} else {
				feeInCents = refund.balance_transaction.fee ?? null;
			}
		}

		return { providerRefundId: refund.id, feeInCents };
	}

	// -------- Webhook --------

	verifyWebhookSignature(args: {
		rawBody: string;
		signatureHeader: string | null;
		endpointKind: "platform" | "connect";
	}): ProviderEvent {
		const stripe = getStripe();
		if (!args.signatureHeader) {
			throw new SignatureError("Missing Stripe-Signature header");
		}
		const secret = getWebhookSecret(args.endpointKind);
		let event: Stripe.Event;
		try {
			event = stripe.webhooks.constructEvent(
				args.rawBody,
				args.signatureHeader,
				secret,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : "signature failed";
			throw new SignatureError(message);
		}
		return {
			id: event.id,
			type: event.type,
			livemode: event.livemode,
			raw: event,
		};
	}

	async parseEvent(event: ProviderEvent): Promise<ParsedProviderEvent> {
		const raw = event.raw as Stripe.Event;
		switch (raw.type) {
			case "checkout.session.completed": {
				const session = raw.data.object as Stripe.Checkout.Session;
				const paymentIntentId =
					typeof session.payment_intent === "string"
						? session.payment_intent
						: (session.payment_intent?.id ?? null);
				const providerCustomerId =
					typeof session.customer === "string"
						? session.customer
						: (session.customer?.id ?? null);

				// Charge + fee require a PaymentIntent expansion. Retrieve on the
				// connected account so direct-charge balance transactions resolve.
				let chargeId: string | null = null;
				let feeInCents: number | null = null;
				if (paymentIntentId) {
					try {
						const stripe = getStripe();
						const connectedAccount =
							typeof raw.account === "string" ? raw.account : undefined;
						const pi = await stripe.paymentIntents.retrieve(
							paymentIntentId,
							{ expand: ["latest_charge.balance_transaction"] },
							connectedAccount
								? { stripeAccount: connectedAccount }
								: undefined,
						);
						const latestCharge = pi.latest_charge;
						if (typeof latestCharge === "string") {
							chargeId = latestCharge;
						} else if (latestCharge) {
							chargeId = latestCharge.id;
							const bt = latestCharge.balance_transaction;
							if (typeof bt === "object" && bt !== null) {
								feeInCents = bt.fee ?? null;
							}
						}
					} catch {
						// Best-effort — webhook still records the payment even if the
						// fee lookup fails. fee can be backfilled later.
					}
				}

				const metadata: Record<string, string> = {};
				if (session.metadata) {
					for (const [k, v] of Object.entries(session.metadata)) {
						// Stripe metadata is typed `Record<string, string | null>`
						// but at runtime values can be undefined too. Coerce to
						// string and skip null/undefined so the resulting object
						// satisfies our `Record<string, string>` contract.
						if (v != null) metadata[k] = String(v);
					}
				}

				return {
					kind: "checkout.completed",
					sessionId: session.id,
					paymentIntentId,
					chargeId,
					amountInCents: session.amount_total ?? 0,
					feeInCents,
					email: session.customer_details?.email ?? null,
					customerName: session.customer_details?.name ?? null,
					providerCustomerId,
					metadata,
					livemode: raw.livemode,
				};
			}

			case "charge.refunded": {
				const charge = raw.data.object as Stripe.Charge;
				// `charge.refunded` carries the cumulative refunded amount + the
				// refunds list. The "delta" for this event is the last refund.
				const refunds = charge.refunds?.data ?? [];
				const latest = refunds[refunds.length - 1];
				const refundId = latest?.id ?? "";
				const amountInCents = latest?.amount ?? charge.amount_refunded;
				const paymentIntentId =
					typeof charge.payment_intent === "string"
						? charge.payment_intent
						: (charge.payment_intent?.id ?? null);

				// Refund-side fee: balance_transaction on the refund row.
				let feeInCents: number | null = null;
				if (latest?.balance_transaction) {
					if (typeof latest.balance_transaction === "string") {
						try {
							const stripe = getStripe();
							const connectedAccount =
								typeof raw.account === "string" ? raw.account : undefined;
							const bt = await stripe.balanceTransactions.retrieve(
								latest.balance_transaction,
								undefined,
								connectedAccount
									? { stripeAccount: connectedAccount }
									: undefined,
							);
							feeInCents = bt.fee ?? null;
						} catch {
							feeInCents = null;
						}
					} else {
						feeInCents = latest.balance_transaction.fee ?? null;
					}
				}

				return {
					kind: "refund.created",
					refundId,
					paymentIntentId,
					chargeId: charge.id,
					amountInCents,
					feeInCents,
					livemode: raw.livemode,
				};
			}

			case "account.updated": {
				const account = raw.data.object as Stripe.Account;
				return {
					kind: "account.updated",
					providerAccountId: account.id,
					chargesEnabled: account.charges_enabled,
					payoutsEnabled: account.payouts_enabled,
					detailsSubmitted: account.details_submitted,
				};
			}

			case "payment_intent.payment_failed": {
				const pi = raw.data.object as Stripe.PaymentIntent;
				return {
					kind: "payment_intent.failed",
					paymentIntentId: pi.id,
					reason: pi.last_payment_error?.message ?? null,
				};
			}

			default:
				return { kind: "unhandled" };
		}
	}
}
