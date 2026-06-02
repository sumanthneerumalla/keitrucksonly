/**
 * Phase 12a Round 3 Stream 7 — `/checkout/[sessionId]` Embedded Checkout page.
 *
 * Server component. Looks up the local `CheckoutSession` row by id and either:
 *   - 404s if the row doesn't exist (cuid-guessing protection — the id IS the
 *     auth, per phase12 §7.2 "owning the session id is sufficient to render
 *     the page");
 *   - redirects to the confirmation page if the row's status is not 'open'
 *     (already completed, expired, or voided — the buyer should see the
 *     terminal state, not a re-mount of Stripe's iframe);
 *   - otherwise renders `<CheckoutClient>` with the `clientSecret`.
 *
 * Auth: this is a `publicProcedure`-equivalent route per phase12 §7.4 — guests
 * completing a public-shop purchase must be able to reach the page without
 * logging in. The `(app)` group's layout does NOT gate on Clerk auth (it
 * loads a layout user when available and renders public chrome otherwise),
 * so no special handling is needed here.
 *
 * Prisma direct: rather than expose a new tRPC `getCheckoutSessionForRender`
 * query (which would touch `payments.ts` that Streams 5 and 6 are also
 * editing this round and likely conflict on), we read the CheckoutSession
 * row directly from `db`. This matches the existing pattern in
 * `(app)/club/[clubShortName]/page.tsx` etc., and the selected columns are
 * narrow enough that auditability is preserved by reading the code itself.
 *
 * Return URL: `/checkout/confirmation?session_id=<providerSessionId>` (the
 * Stripe `cs_xxx`, NOT our local cuid — `payments.getCheckoutSessionStatus`
 * keys off `providerSessionId` for the confirmation poll surface).
 */

import { notFound, redirect } from "next/navigation";
import { db } from "~/server/db";
import { getPlatformConfig } from "~/server/utils/platformConfig";
import { CheckoutClient } from "./CheckoutClient";

export default async function CheckoutPage({
	params,
}: {
	params: Promise<{ sessionId: string }>;
}) {
	const { sessionId } = await params;

	const session = await db.checkoutSession.findUnique({
		where: { id: sessionId },
		select: {
			clientSecret: true,
			providerSessionId: true,
			status: true,
		},
	});

	if (!session) notFound();

	if (session.status !== "open") {
		redirect(
			`/checkout/confirmation?session_id=${encodeURIComponent(session.providerSessionId)}`,
		);
	}

	const returnUrl = `/checkout/confirmation?session_id=${encodeURIComponent(session.providerSessionId)}`;

	// Phase 12a no-SSH workaround — resolve the publishable key server-side
	// (env-first, DB fallback) and pass it to the client component as a prop
	// instead of relying on `process.env.NEXT_PUBLIC_*` at module-eval time
	// in the client bundle. See designFiles/roadmap/phase12-stripe-connect.md §24.
	const publishableKey = await getPlatformConfig(
		"NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
		"stripe_publishable_key",
	);
	if (!publishableKey) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-red-900 text-sm">
					<p className="font-medium">Online checkout is not configured.</p>
					<p className="mt-2">
						Please contact the club directly to complete this purchase.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="container mx-auto px-4 py-8">
			<CheckoutClient
				clientSecret={session.clientSecret}
				publishableKey={publishableKey}
				returnUrl={returnUrl}
			/>
		</div>
	);
}
