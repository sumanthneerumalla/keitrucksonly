import ConfirmationClient from "~/app/(app)/shop/confirmation/ConfirmationClient";

/**
 * Phase 12a Round 3 Stream 6 — public-shop checkout confirmation page.
 *
 * Stripe's return URL substitutes `{CHECKOUT_SESSION_ID}` with the Stripe
 * session id (cs_xxx). We pass that down to the client component which
 * polls `payments.getCheckoutSessionStatus({ sessionId })` every 2s for
 * up to 30s waiting for the webhook to mark the row 'completed' (§7.8.11 E5).
 *
 * Branches per §7.8.7 (the 6-case state machine) are picked from the
 * `familyGroupOutcome` value the webhook stamps on `CheckoutSession.intent`
 * after `linkFamilyGroup` runs.
 */
export default async function ShopConfirmationPage({
	searchParams,
}: {
	searchParams: Promise<{ session_id?: string }>;
}) {
	const { session_id } = await searchParams;

	if (!session_id) {
		return (
			<div className="mx-auto max-w-2xl space-y-4 p-6 text-center">
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Missing confirmation reference
				</h1>
				<p className="text-[var(--muted-foreground)] text-sm">
					This page is shown after a checkout finishes. It looks like the
					confirmation reference is missing from the URL — if you just paid,
					please check your email for the receipt.
				</p>
			</div>
		);
	}

	return <ConfirmationClient sessionId={session_id} variant="guest" />;
}
