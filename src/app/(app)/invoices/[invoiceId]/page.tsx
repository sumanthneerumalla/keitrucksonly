import InvoiceDetail from "~/app/_components/billing/InvoiceDetail";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { db } from "~/server/db";

/**
 * Phase 9a (D17) — member-facing invoice detail. Reuses the shared
 * `<InvoiceDetail>` component in `audience="member"` mode (same component
 * staff uses at `/admin/invoices/[invoiceId]` and
 * `/clients/[userId]/invoices/[invoiceId]`). Per-invoice authorization
 * (consumer OR payer OR same-club staff) is enforced by
 * `billing.getInvoice` server-side; the page itself only checks that the
 * caller is onboarded. `backHref` returns to the member invoice list.
 *
 * Phase 12a Round 3 — `clubChargesEnabled` is resolved server-side here
 * and passed in so InvoiceDetail can gate the "Pay $X" button without the
 * member calling `payments.getConnectionStatus` (which is clubAdmin-only).
 * Returning `false` for an invoice the viewer can't see is the safe default
 * — the button just doesn't appear.
 */
export default async function MyInvoiceDetailPage({
	params,
}: {
	params: Promise<{ invoiceId: string }>;
}) {
	// Onboarded-gate only — getInvoice authorizes consumer/payer/staff itself.
	await getOnboardedUserOrRedirect();
	const { invoiceId } = await params;

	const invoice = await db.invoice.findUnique({
		where: { invoiceId },
		select: { clubShortName: true },
	});
	let clubChargesEnabled = false;
	if (invoice) {
		const account = await db.clubStripeAccount.findUnique({
			where: { clubShortName: invoice.clubShortName },
			select: { chargesEnabled: true, disconnectedAt: true },
		});
		clubChargesEnabled =
			account?.chargesEnabled === true && account.disconnectedAt === null;
	}

	return (
		<InvoiceDetail
			invoiceId={invoiceId}
			audience="member"
			backHref="/invoices"
			clubChargesEnabled={clubChargesEnabled}
		/>
	);
}
