import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isAnyAdmin } from "~/lib/utils";
import OrphansListClient from "./OrphansListClient";

/**
 * Phase 12a Round 3 Stream 5 — /admin/payments/orphans.
 *
 * Server gate for the orphan-purchase triage queue (§10). The actual list +
 * filter + per-row resolve actions live in `<OrphansListClient>`; the page
 * itself just enforces the admin role and renders the shell.
 *
 * Data fetch happens client-side (via tRPC `useQuery`) rather than here so
 * the page can refetch instantly after a `resolveOrphan` mutation without
 * a full Server-Component reload.
 */
export default async function AdminOrphansPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isAnyAdmin(user)) {
		redirect("/dashboard");
	}

	return (
		<div className="p-6">
			<div className="mb-6">
				<Link
					href="/admin"
					className="text-[var(--muted-foreground)] text-sm hover:text-[var(--foreground)]"
				>
					← Admin
				</Link>
				<h1 className="mt-2 font-semibold text-2xl text-[var(--foreground)]">
					Orphaned purchases
				</h1>
				<p className="mt-1 text-[var(--muted-foreground)] text-sm">
					Payments that arrived from Stripe but couldn't be matched to a
					purchase. Resolve each row by reconciling manually, refunding via
					Stripe, or ignoring.
				</p>
			</div>

			<OrphansListClient />
		</div>
	);
}
