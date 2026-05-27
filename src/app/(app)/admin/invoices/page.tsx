import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isFacilityOrAbove } from "~/lib/utils";
import InvoiceListClient from "./InvoiceListClient";

/**
 * Phase 9a (C13) — staff invoice list at /admin/invoices. Role-gated to
 * facility-or-above (mirrors the other admin pages); the searchable, paginated
 * list itself lives in the client component off `billing.listInvoices`.
 */
export default async function AdminInvoicesPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isFacilityOrAbove(user)) {
		redirect("/dashboard");
	}

	return (
		<Suspense fallback={null}>
			<InvoiceListClient />
		</Suspense>
	);
}
