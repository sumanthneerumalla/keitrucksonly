import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";
import { isAnyAdmin } from "~/lib/utils";
import { api } from "~/trpc/server";
import StripeConnectionCard from "./StripeConnectionCard";

/**
 * Phase 12a Round 3 Stream 5 — /admin/settings/payments.
 *
 * Server component: fetches the cached connection status via
 * `payments.getConnectionStatus` (which per §23 #3 does NOT round-trip to
 * Stripe — the cached `ClubStripeAccount` row is the source of truth) and
 * hands it to the `<StripeConnectionCard>` client component for rendering.
 *
 * The auto-refresh on `?stripe=return` (Stripe Account Link redirect) is
 * handled client-side inside `<StripeConnectionCard>` — see the useEffect
 * there. We don't refresh here because server components can't easily mutate
 * from a query string without a fresh trip through the routing layer.
 */
export default async function AdminPaymentsSettingsPage() {
	const user = await getOnboardedUserOrRedirect();

	if (!isAnyAdmin(user)) {
		redirect("/dashboard");
	}

	const status = await api.payments.getConnectionStatus();

	return (
		<div className="p-6">
			<div className="mb-6">
				<Link
					href="/admin/settings"
					className="text-[var(--muted-foreground)] text-sm hover:text-[var(--foreground)]"
				>
					← Settings
				</Link>
				<h1 className="mt-2 font-semibold text-2xl text-[var(--foreground)]">
					Payments
				</h1>
				<p className="mt-1 text-[var(--muted-foreground)] text-sm">
					Connect Stripe to accept online payments. ShuttleMentor takes no
					platform fee today.
				</p>
			</div>

			<StripeConnectionCard initialStatus={status} />
		</div>
	);
}
