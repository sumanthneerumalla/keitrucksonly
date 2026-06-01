/**
 * Phase 12a — Stripe Platform-account webhook endpoint.
 *
 *   POST /api/webhooks/stripe/platform
 *
 * Registered in Stripe's Platform-account webhook settings. Receives events
 * fired on the platform account itself — primarily `account.updated` for
 * connected-account onboarding-status changes
 * (designFiles/roadmap/phase12-stripe-connect.md §8.1).
 *
 * Public route — no auth. Signature verification (HMAC over the raw body
 * using STRIPE_WEBHOOK_SECRET_PLATFORM) is the gate, performed as the FIRST
 * call inside `handleStripeWebhook` (§8.2). The middleware (src/middleware.ts)
 * only force-protects `/admin(.*)`, so this path is reachable unauthenticated.
 */

import { handleStripeWebhookRoute } from "../_shared";

// Node.js runtime is required: Edge doesn't reliably support `req.text()`
// for raw bytes, and the Stripe SDK signature verifier is a Node module.
export const runtime = "nodejs";

// Never statically render — every request must hit the handler.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
	return handleStripeWebhookRoute(req, "platform");
}
