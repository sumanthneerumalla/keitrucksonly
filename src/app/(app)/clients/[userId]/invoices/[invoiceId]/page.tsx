import { redirect } from "next/navigation";
import InvoiceDetail from "~/app/_components/billing/InvoiceDetail";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isFacilityOrAbove } from "~/lib/utils";

/**
 * Phase 9a (C14) — staff invoice detail, reached by drilling into an invoice
 * row from a client's BillingPanel. Shares the `<InvoiceDetail>` component with
 * /admin/invoices/[invoiceId]; per-invoice authorization lives in
 * `billing.getInvoice` (consumer OR payer OR same-club staff).
 */
export default async function ClientInvoiceDetailPage({
	params,
}: {
	params: Promise<{ userId: string; invoiceId: string }>;
}) {
	const user = await getOnboardedUserOrRedirect();

	if (!isFacilityOrAbove(user)) {
		redirect("/dashboard");
	}

	const { userId, invoiceId } = await params;

	return (
		<InvoiceDetail
			invoiceId={invoiceId}
			audience="staff"
			backHref={`/clients/${userId}`}
		/>
	);
}
