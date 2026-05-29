import BillingPanel from "~/app/(app)/clients/[userId]/BillingPanel";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";

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
 */
export default async function MyInvoicesPage() {
	const user = await getOnboardedUserOrRedirect();

	return (
		<div className="mx-auto max-w-4xl p-4 sm:p-6">
			<h1 className="mb-4 font-semibold text-[var(--foreground)] text-xl">
				Invoices
			</h1>
			<BillingPanel userId={user.userId} audience="member" />
		</div>
	);
}
