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
import {
	type ParsedProviderEvent,
	type PaymentProvider,
	type ProviderEvent,
	SignatureError,
} from "~/server/services/payments/types";
import { getPlatformConfig } from "~/server/utils/platformConfig";

// ============================================================
// Lazy Stripe client
// ============================================================
//
// Phase 12a no-SSH workaround: secrets resolve through `getPlatformConfig`
// (env-first, DB fallback). `getStripe()` is async because the DB fallback
// is async; if the secret changes (e.g., Prisma Studio edit), the cached
// client is rebuilt on the next call after the platform-config cache
// expires (≤60s).

let _stripe: Stripe | null = null;
let _stripeKey: string | null = null;

async function getStripe(): Promise<Stripe> {
	const secret = await getPlatformConfig(
		"STRIPE_SECRET_KEY",
		"stripe_secret_key",
	);
	if (!secret) {
		throw new Error(
			'STRIPE_SECRET_KEY is not configured — set the env var or add a row to the PlatformConfig table with key="stripe_secret_key".',
		);
	}
	if (_stripe !== null && _stripeKey === secret) return _stripe;
	_stripe = new Stripe(secret, {
		// Pin to the SDK's bundled API version (omitted = SDK default, which
		// matches the installed SDK's TypeScript types).
		typescript: true,
	});
	_stripeKey = secret;
	return _stripe;
}

async function getWebhookSecret(
	endpointKind: "platform" | "connect",
): Promise<string> {
	const envVarName =
		endpointKind === "platform"
			? "STRIPE_WEBHOOK_SECRET_PLATFORM"
			: "STRIPE_WEBHOOK_SECRET_CONNECT";
	const dbKey =
		endpointKind === "platform"
			? "stripe_webhook_secret_platform"
			: "stripe_webhook_secret_connect";
	const secret = await getPlatformConfig(envVarName, dbKey);
	if (!secret) {
		throw new Error(
			`${envVarName} is not configured — set the env var or add a row to the PlatformConfig table with key="${dbKey}".`,
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

	/**
	 * Accounts v2 migration (2026-06-01) — `stripe.v2.core.accounts.create`.
	 *
	 * v1 Standard (`stripe.accounts.create({ type: 'standard', ... })`) is
	 * deprecated for new integrations. v2 unifies Standard/Express/Custom
	 * behind one Account resource configured via:
	 *   - `dashboard: 'full'`            — clubs get the same full Stripe
	 *                                       dashboard as v1 Standard (owner
	 *                                       lock; designFiles/roadmap/
	 *                                       phase12-stripe-connect.md §23).
	 *   - `responsibilities.fees_collector: 'stripe'` +
	 *     `responsibilities.losses_collector: 'stripe'`
	 *                                    — clubs own disputes/fees, mirroring
	 *                                       v1 Standard's liability model.
	 *   - `configuration.merchant.capabilities.card_payments.requested: true`
	 *                                    — enable card acceptance; equivalent
	 *                                       of v1's implicit Standard card cap.
	 *
	 * Identity fields (registered_name / country / entity_type) come from the
	 * pre-Connect form (§6.1) — 5 universal fields (HANDOFF + §23 row 12).
	 * Stripe's hosted onboarding then collects the rest (NTEE for non-profits,
	 * bank account, tax ID, …) via the AccountLink hosted flow.
	 *
	 * v2 AccountLink shape changed: instead of a flat `type: 'account_onboarding'`
	 * it uses `use_case: { type: 'account_onboarding', account_onboarding: {
	 * configurations: ['merchant'], refresh_url, return_url } }`. The returned
	 * `account.id` format (`acct_xxx`) is unchanged — `ClubStripeAccount.
	 * stripeAccountId` stores either v1 or v2 ids without schema work.
	 */
	async createOnboardingLink(args: {
		clubShortName: string;
		returnUrl: string;
		refreshUrl: string;
		businessName: string;
		country: string;
		entityType: "company" | "individual" | "non_profit" | "government_entity";
		contactEmail: string;
		displayName?: string;
	}): Promise<{ url: string; providerAccountId: string }> {
		const stripe = await getStripe();
		const account = await stripe.v2.core.accounts.create({
			contact_email: args.contactEmail,
			display_name: args.displayName ?? args.businessName,
			dashboard: "full",
			identity: {
				country: args.country,
				entity_type: args.entityType,
				business_details: {
					registered_name: args.businessName,
				},
			},
			configuration: {
				merchant: {
					capabilities: {
						card_payments: { requested: true },
					},
				},
			},
			defaults: {
				currency: "usd",
				responsibilities: {
					fees_collector: "stripe",
					losses_collector: "stripe",
				},
			},
			include: ["configuration.merchant", "identity", "requirements"],
			metadata: { clubShortName: args.clubShortName },
		});
		const link = await stripe.v2.core.accountLinks.create({
			account: account.id,
			use_case: {
				type: "account_onboarding",
				account_onboarding: {
					configurations: ["merchant"],
					refresh_url: args.refreshUrl,
					return_url: args.returnUrl,
				},
			},
		});
		return { url: link.url, providerAccountId: account.id };
	}

	/**
	 * v2 field mapping (Accounts v2 migration, 2026-06-01):
	 *
	 *   v1 Account flag                  v2 Account derivation
	 *   ───────────────────────────────  ────────────────────────────────────
	 *   charges_enabled                  configuration.merchant.applied
	 *                                    && configuration.merchant.capabilities
	 *                                       .card_payments.status === 'active'
	 *   payouts_enabled                  configuration.merchant.applied
	 *                                    (v2 Accounts with merchant active in
	 *                                    full-dashboard mode receive payouts
	 *                                    via Stripe's standard schedule once
	 *                                    requirements are clear; we proxy off
	 *                                    `applied` since v2 has no direct
	 *                                    "payouts_enabled" flag on the response)
	 *   details_submitted                requirements.entries is empty OR
	 *                                    undefined (no outstanding requirements
	 *                                    = onboarding complete)
	 *   email                            contact_email
	 *   livemode                         livemode (unchanged)
	 *
	 * `chargesEnabled` is the only flag that meaningfully gates checkout
	 * (see `assertClubReadyForCharges` in payments.ts). The `payoutsEnabled`
	 * proxy via `merchant.applied` is conservative but accurate for the
	 * full-dashboard model — we never let a non-active merchant accept
	 * charges, so the user-visible UI pill remains correct.
	 */
	async refreshAccountStatus(providerAccountId: string): Promise<{
		chargesEnabled: boolean;
		payoutsEnabled: boolean;
		detailsSubmitted: boolean;
		accountEmail: string | null;
		livemode: boolean;
	}> {
		const stripe = await getStripe();
		const account = await stripe.v2.core.accounts.retrieve(providerAccountId, {
			include: ["configuration.merchant", "requirements"],
		});
		const merchant = account.configuration?.merchant;
		const cardPaymentsStatus =
			merchant?.capabilities?.card_payments?.status ?? "unsupported";
		const chargesEnabled =
			merchant?.applied === true && cardPaymentsStatus === "active";
		const payoutsEnabled = merchant?.applied === true;
		const detailsSubmitted = (account.requirements?.entries?.length ?? 0) === 0;
		return {
			chargesEnabled,
			payoutsEnabled,
			detailsSubmitted,
			accountEmail: account.contact_email ?? null,
			livemode: account.livemode,
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
		const stripe = await getStripe();
		const params: Stripe.Checkout.SessionCreateParams = {
			// Stripe SDK 22 renamed the enum value 'embedded' → 'embedded_page'.
			// Same behavior — Embedded Checkout iframe lives on our /checkout/[id] page.
			ui_mode: "embedded_page",
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
		const stripe = await getStripe();
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

	async verifyWebhookSignature(args: {
		rawBody: string;
		signatureHeader: string | null;
		endpointKind: "platform" | "connect";
	}): Promise<ProviderEvent> {
		const stripe = await getStripe();
		if (!args.signatureHeader) {
			throw new SignatureError("Missing Stripe-Signature header");
		}
		const secret = await getWebhookSecret(args.endpointKind);

		// Accounts v2 migration (2026-06-01) — v2 event destinations deliver a
		// "thin-event" notification with `object === 'v2.core.event'`. The
		// legacy `stripe.webhooks.constructEvent` explicitly REJECTS this
		// payload shape with a hard throw (see
		// `node_modules/stripe/cjs/Webhooks.js` lines 28-30 / 42-44) — it tells
		// the caller to use `stripe.parseEventNotification` instead. Without
		// this peek, our catch-all below would wrap that throw as a
		// `SignatureError`, the route handler would return 400, and Stripe
		// would stop retrying — silently dropping every v2 webhook delivery.
		//
		// Peek the payload (signature-verification still happens inside
		// parseEventNotification, so cheating the JSON parse here doesn't
		// weaken security — a malformed/unauthenticated payload still fails
		// inside that call).
		let parsed: { object?: string } | null = null;
		try {
			parsed = JSON.parse(args.rawBody) as { object?: string };
		} catch {
			// not JSON — fall through to constructEvent, which throws a
			// SignatureError below for free.
		}
		if (parsed?.object === "v2.core.event") {
			let v2Event: Awaited<ReturnType<typeof stripe.parseEventNotification>>;
			try {
				// parseEventNotification is sync in the SDK (see
				// `node_modules/stripe/cjs/stripe.core.js` lines 514-541) but
				// typed as a method on the Stripe instance; await is safe and
				// future-proof if Stripe makes it async later.
				v2Event = await stripe.parseEventNotification(
					args.rawBody,
					args.signatureHeader,
					secret,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : "signature failed";
				throw new SignatureError(message);
			}
			// V2.Core.EventNotification extends EventBase → id / type / livemode
			// are all present (see Events.d.ts EventBase definition).
			return {
				id: v2Event.id,
				type: v2Event.type,
				livemode: v2Event.livemode,
				raw: v2Event,
			};
		}

		// v1 path — unchanged from pre-v2 code.
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
		// Accounts v2 migration (2026-06-01): v2 events (`v2.core.account.*`)
		// are NOT in the SDK's `Stripe.Event['type']` union (that union is
		// v1-only). When Stripe delivers a v2 event through our shared webhook
		// endpoint we still get a parsable JSON object with a `type` field;
		// match it via `event.type` (the ProviderEvent string copy) before
		// the v1-typed switch below.
		//
		// Stripe fires SEVEN distinct v2 account event variants when a
		// connected account's state changes (see
		// `node_modules/stripe/cjs/resources/V2/Core/Events.d.ts` ~line 121):
		//   - v2.core.account.created
		//   - v2.core.account.updated
		//   - v2.core.account.closed
		//   - v2.core.account[configuration.merchant].updated
		//   - v2.core.account[configuration.merchant].capability_status_updated
		//   - v2.core.account[requirements].updated
		//   - v2.core.account[identity].updated
		// Any of these can flip `chargesEnabled` / `payoutsEnabled` / details —
		// we re-fetch state regardless of which sub-resource changed, so a
		// prefix match captures them all. Returns the same parsed kind
		// (`v2.account.updated`) so the dispatcher's existing branch handles
		// every variant.
		//
		// EXCLUDED: `v2.core.account_link.returned` — fires when the user
		// completes/leaves the AccountLink, which is a UX signal not an
		// account-state change (we already refresh on the return URL via the
		// settings page). The startsWith below catches `v2.core.account_link.*`
		// too, so we filter that explicitly.
		if (
			event.type.startsWith("v2.core.account") &&
			!event.type.startsWith("v2.core.account_link")
		) {
			const rawV2 = event.raw as {
				related_object?: { id?: string };
				data?: { object?: { id?: string } };
			};
			const accountId =
				rawV2.related_object?.id ?? rawV2.data?.object?.id ?? null;
			if (!accountId) {
				return { kind: "unhandled" };
			}
			// v2 events don't carry the full Account object inline (the
			// payload is a "thin" event). Round-trip to derive the same
			// flags `refreshAccountStatus` returns. This matches all
			// v2.core.account.{merchant,requirements,identity,*}.updated
			// events — we re-fetch state regardless of which sub-resource
			// changed.
			const status = await this.refreshAccountStatus(accountId);
			return {
				kind: "v2.account.updated",
				providerAccountId: accountId,
				chargesEnabled: status.chargesEnabled,
				payoutsEnabled: status.payoutsEnabled,
				detailsSubmitted: status.detailsSubmitted,
			};
		}
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
						const stripe = await getStripe();
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
							const stripe = await getStripe();
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
