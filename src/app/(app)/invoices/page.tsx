import BillingPanel from "~/app/(app)/clients/[userId]/BillingPanel";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import ResumeCheckoutBanner from "~/app/_components/client/shared/ResumeCheckoutBanner";
import { db } from "~/server/db";

/**
 * Phase 9a (D17) — member-facing self-service billing / invoices page. Reuses
 * the staff-side `BillingPanel` in `audience="member"` mode so the same code
 * powers both surfaces:
 *
 *   - Add charge button — hidden.
 *   - "Needs billing" amber card — hidden.
 *   - Per-row "Record Payment" / "Mark as due" staff actions — hidden.
 *   - Void invoices hidden (per `invoiceStatusDisplay.hiddenFromMember`).
 *   - Invoice-detail links route to `/invoices/[id]` (not the staff client
 *     profile path).
 *
 * Backend: `billing.getMemberBilling` was widened from `facilityProcedure` to
 * `protectedProcedure` with an in-handler self-or-same-club-staff check,
 * mirroring `getInvoice`. The Round-5 widening means a parent who pays for
 * kids (bill-to invoices) also sees those kids' invoices on this page.
 *
 * Phase 12a Round 3 — per-row "Pay $X" affordance: shown to members on
 * positive-balance invoices when the club's Stripe Connect link is healthy
 * (chargesEnabled && !disconnectedAt). We resolve that server-side here and
 * pass it as `clubChargesEnabled` because `payments.getConnectionStatus` is
 * clubAdmin-only. The ResumeCheckoutBanner (§7.8.13) is mounted here so any
 * member with an unfinished checkout sees it on their billing hub — the
 * natural landing after "I started buying something but got distracted".
 */
export default async function MyInvoicesPage() {
	const user = await getOnboardedUserOrRedirect();

	// Read-only Stripe-Connect status lookup. The actual pay-now mutation
	// (`payments.startCheckout.invoice`) re-checks chargesEnabled
	// authoritatively; this just suppresses the button on a disconnected club.
	const account = await db.clubStripeAccount.findUnique({
		where: { clubShortName: user.clubShortName },
		select: { chargesEnabled: true, disconnectedAt: true },
	});
	const clubChargesEnabled =
		account?.chargesEnabled === true && account.disconnectedAt === null;

	return (
		<>
			<ResumeCheckoutBanner />
			<div className="mx-auto max-w-4xl p-4 sm:p-6">
				<h1 className="mb-4 font-semibold text-[var(--foreground)] text-xl">
					My Invoices
				</h1>
				<BillingPanel
					userId={user.userId}
					audience="member"
					clubChargesEnabled={clubChargesEnabled}
				/>
			</div>
		</>
	);
}
