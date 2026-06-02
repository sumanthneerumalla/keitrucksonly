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
 * If the publishable key changes between calls (no-SSH workaround: key may be
 * rotated via the `PlatformConfig` table without a rebuild), the cached
 * promise is invalidated and Stripe.js is reloaded.
 *
 * Publishable key sourcing: callers must pass the key in. The CheckoutPage
 * server component resolves it via `getPlatformConfig` (env-first, DB-fallback
 * — see designFiles/roadmap/phase12-stripe-connect.md §24) and threads it
 * through to CheckoutClient as a prop. The server secret key
 * (`STRIPE_SECRET_KEY`) is server-only and MUST NOT be imported here.
 */

import { type Stripe, loadStripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;
let cachedKey: string | null = null;

export function getStripePromise(
	publishableKey: string,
): Promise<Stripe | null> {
	if (stripePromise !== null && cachedKey === publishableKey) {
		return stripePromise;
	}
	stripePromise = loadStripe(publishableKey);
	cachedKey = publishableKey;
	return stripePromise;
}
