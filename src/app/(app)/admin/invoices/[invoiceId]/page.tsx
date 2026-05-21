import { redirect } from "next/navigation";
import InvoiceDetail from "~/app/_components/billing/InvoiceDetail";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isFacilityOrAbove } from "~/lib/utils";

/**
 * Phase 9a (C14) — admin invoice detail. Shares the `<InvoiceDetail>` component
 * with /clients/[userId]/invoices/[invoiceId]; per-invoice authorization lives
 * in `billing.getInvoice` (consumer OR payer OR same-club staff). `backHref`
 * points at the admin landing today; repoint at /admin/invoices once the C13
 * list page ships.
 */
export default async function AdminInvoiceDetailPage({
	params,
}: {
	params: Promise<{ invoiceId: string }>;
}) {
	const user = await getOnboardedUserOrRedirect();

	if (!isFacilityOrAbove(user)) {
		redirect("/dashboard");
	}

	const { invoiceId } = await params;

	return (
		<InvoiceDetail invoiceId={invoiceId} audience="staff" backHref="/admin" />
	);
}
