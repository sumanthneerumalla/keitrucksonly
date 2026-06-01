/**
 * Phase 12a Round 3 Stream 7 — client-side Stripe.js singleton.
 *
 * `loadStripe()` may only run client-side; calling it during SSR throws.
 * We lazy-init on first use so this module can be imported by a "use client"
 * component without breaking server bundling (the module file itself contains
 * no top-level side effects — the `loadStripe` call is deferred into
 * `getStripePromise()`, which client components call inside render).
 *
 * The promise is memoized at module scope so every `<EmbeddedCheckoutProvider>`
 * mount across the app session shares one Stripe.js instance — re-loading the
 * script per page is wasteful and Stripe explicitly recommends a singleton.
 *
 * Publishable key sourcing: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the only
 * Stripe credential that may appear on the client. The server secret key
 * (`STRIPE_SECRET_KEY`) is server-only and MUST NOT be imported here. If the
 * publishable key is missing at runtime, `getStripePromise()` resolves to
 * `null` and CheckoutClient surfaces a clean "Stripe not configured" message
 * rather than crashing the iframe mount.
 */

import { type Stripe, loadStripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
	if (stripePromise === null) {
		const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
		if (!publishableKey) {
			// Resolve to null so callers can render a degraded UI rather than
			// throwing inside React render. Memoize the rejection-equivalent
			// so we don't try again on every re-render.
			stripePromise = Promise.resolve(null);
		} else {
			stripePromise = loadStripe(publishableKey);
		}
	}
	return stripePromise;
}
