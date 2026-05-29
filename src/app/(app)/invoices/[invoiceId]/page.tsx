import InvoiceDetail from "~/app/_components/billing/InvoiceDetail";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";

/**
 * Phase 9a (D17) — member-facing invoice detail. Reuses the shared
 * `<InvoiceDetail>` component in `audience="member"` mode (same component
 * staff uses at `/admin/invoices/[invoiceId]` and
 * `/clients/[userId]/invoices/[invoiceId]`). Per-invoice authorization
 * (consumer OR payer OR same-club staff) is enforced by
 * `billing.getInvoice` server-side; the page itself only checks that the
 * caller is onboarded. `backHref` returns to the member invoice list.
 */
export default async function MyInvoiceDetailPage({
	params,
}: {
	params: Promise<{ invoiceId: string }>;
}) {
	// Onboarded-gate only — getInvoice authorizes consumer/payer/staff itself.
	await getOnboardedUserOrRedirect();
	const { invoiceId } = await params;

	return (
		<InvoiceDetail
			invoiceId={invoiceId}
			audience="member"
			backHref="/invoices"
		/>
	);
}
