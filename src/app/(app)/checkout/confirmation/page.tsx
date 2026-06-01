import ConfirmationClient from "~/app/(app)/shop/confirmation/ConfirmationClient";

/**
 * Phase 12a Round 3 Stream 6 — in-app checkout confirmation page.
 *
 * Variant of `/shop/confirmation` for logged-in members landing back from
 * Stripe Embedded Checkout. Same polling logic (§7.8.11 E5), but the
 * success branches deep-link to `/account/*` pages instead of nudging the
 * user to sign in. We delegate to the shared ConfirmationClient with
 * `variant="inapp"`.
 */
export default async function CheckoutConfirmationPage({
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
					This page is shown after a checkout finishes. The confirmation
					reference is missing from the URL — check your email for the receipt.
				</p>
			</div>
		);
	}

	return <ConfirmationClient sessionId={session_id} variant="inapp" />;
}
