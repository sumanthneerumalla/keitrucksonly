"use client";

/**
 * Phase 12a Round 3 Stream 7 — client wrapper around Stripe's Embedded Checkout.
 *
 * Mounts `<EmbeddedCheckoutProvider>` with the per-session `clientSecret`
 * issued by `payments.startCheckout.*` (the value lives on the local
 * `CheckoutSession.clientSecret` column — phase12 §7.3). Stripe's component
 * then renders the iframe form inline on our page.
 *
 * Operational note (phase12 §24, "Multi-tab Embedded Checkout submit"):
 *   Stripe's `clientSecret` is single-use. If a buyer opens this page in two
 *   tabs and tab 1 pays first, tab 2's submit returns Stripe's internal
 *   `payment_intent_unexpected_state`. The Embedded Checkout component
 *   surfaces this to the iframe (not to our React tree); the recovery hook
 *   we have is `onComplete`, which Stripe fires when the session reaches a
 *   terminal state from either side. Routing through the confirmation page
 *   on completion lets the second tab land on the same destination the first
 *   tab already reached — the polling logic there (§7.8.7) handles the rest.
 */

import {
	EmbeddedCheckout,
	EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getStripePromise } from "~/lib/stripe-client";

interface CheckoutClientProps {
	/** Stripe's single-use Embedded Checkout client_secret. */
	clientSecret: string;
	/**
	 * Stripe publishable key, resolved server-side by the CheckoutPage server
	 * component via `getConfig('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')` —
	 * env-first, DB-fallback. Passed as a prop
	 * (rather than read from `process.env.NEXT_PUBLIC_*` in this client
	 * module) so the Phase 12a no-SSH workaround can supply the key via the
	 * `PlatformConfig` table without a rebuild.
	 */
	publishableKey: string;
	/**
	 * Where the buyer lands after Stripe's iframe completes — our local
	 * confirmation page. Stripe substitutes its own `cs_xxx` into the
	 * `{CHECKOUT_SESSION_ID}` token when configured via the session-create
	 * call, so for the multi-tab `onComplete` fallback we pass the URL
	 * pre-resolved (with `providerSessionId` already substituted).
	 */
	returnUrl: string;
}

export function CheckoutClient({
	clientSecret,
	publishableKey,
	returnUrl,
}: CheckoutClientProps) {
	const router = useRouter();
	const [stripeUnavailable, setStripeUnavailable] = useState(false);

	const stripePromise = useMemo(
		() => getStripePromise(publishableKey),
		[publishableKey],
	);

	// Surface a clean error if Stripe.js fails to load (e.g., network block).
	// The CheckoutPage server component already guards against a missing
	// publishable key, so getStripePromise() here will normally resolve to a
	// real Stripe instance — `null` indicates load failure, not unconfigured.
	useEffect(() => {
		let cancelled = false;
		stripePromise.then((stripe) => {
			if (!cancelled && stripe === null) setStripeUnavailable(true);
		});
		return () => {
			cancelled = true;
		};
	}, [stripePromise]);

	// §24 multi-tab race recovery: when Stripe fires `onComplete` (success OR
	// the iframe surfacing `payment_intent_unexpected_state` and giving up),
	// route to confirmation rather than leaving the buyer staring at an
	// errored iframe. The confirmation page polls
	// `payments.getCheckoutSessionStatus` and renders the right §7.8.7 branch.
	const handleComplete = useCallback(() => {
		router.push(returnUrl);
	}, [router, returnUrl]);

	const options = useMemo(
		() => ({ clientSecret, onComplete: handleComplete }),
		[clientSecret, handleComplete],
	);

	if (stripeUnavailable) {
		return (
			<div className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-red-900 text-sm">
				<p className="font-medium">Online checkout is not configured.</p>
				<p className="mt-2">
					Please contact the club directly to complete this purchase.
				</p>
			</div>
		);
	}

	return (
		<div id="checkout" className="mx-auto w-full max-w-3xl">
			<EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
				<EmbeddedCheckout />
			</EmbeddedCheckoutProvider>
		</div>
	);
}
