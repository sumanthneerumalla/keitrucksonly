/**
 * Phase 12a — shared Stripe-webhook route adapter.
 *
 * Both `/api/webhooks/stripe/platform` and `/api/webhooks/stripe/connect`
 * are identical except for the `endpointKind` discriminator. Both:
 *
 *   1. Pull the RAW request body via `req.text()` — NEVER `req.json()`,
 *      which would re-serialize and break HMAC signature verification
 *      (designFiles/roadmap/phase12-stripe-connect.md §8.2).
 *   2. Grab the `stripe-signature` header (case-insensitive lookup).
 *   3. Hand both to `handleStripeWebhook`, which performs sig verify FIRST,
 *      then livemode check → dedup → dispatch (§8.3).
 *   4. The handler returns a fully-formed `Response` for every expected
 *      outcome (400 bad sig, 400 livemode mismatch, 200 ok, 200 duplicate,
 *      200 with orphan row written by the failure module). We forward
 *      that response untouched.
 *   5. ANY error that propagates out is a transient/unknown failure →
 *      we return 500 so Stripe retries via its standard backoff (§8.4).
 *
 * Routes that call this MUST set:
 *   export const runtime  = 'nodejs';        // raw body needs Node, not Edge
 *   export const dynamic  = 'force-dynamic'; // never statically render
 */

import { handleStripeWebhook } from "~/server/services/payments/stripeWebhook";

export async function handleStripeWebhookRoute(
	req: Request,
	endpointKind: "platform" | "connect",
): Promise<Response> {
	// RAW body — required for HMAC verification.
	const rawBody = await req.text();
	const sig = req.headers.get("stripe-signature");

	try {
		// `handleStripeWebhook` returns a `Response` for every expected path
		// (including SignatureError → 400). Forward it as-is.
		return await handleStripeWebhook(rawBody, sig, endpointKind);
	} catch (err) {
		// Persistent business failures are caught inside `handleStripeWebhook`
		// and routed through the failure module (200 + orphan row). Anything
		// reaching here is transient (DB blip, network error during fee
		// fetch, …) → 500 → Stripe retries.
		console.error(`[stripe webhook] ${endpointKind} transient error`, err);
		return new Response("internal error", { status: 500 });
	}
}
