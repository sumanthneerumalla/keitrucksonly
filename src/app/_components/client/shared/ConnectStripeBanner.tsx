"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "~/trpc/react";

/**
 * Phase 12a Round 3 Stream 5 — amber "connect Stripe" prompt on the admin
 * dashboard.
 *
 * Visibility is driven by `payments.shouldShowConnectBanner` (§23 #11):
 * the predicate returns `show: true` when the club has paid offerings or
 * outstanding invoices but no live Stripe connection. The page-level
 * banner is purely informational — it never blocks anything else from
 * rendering — so we let the tRPC `useQuery` resolve lazily without a
 * Suspense fallback.
 *
 * Dismissal is local state only (in-memory). Per spec there's no
 * persistence — the banner returns on the next page load until the
 * admin actually connects. This matches the "soft nudge" intent: we
 * want it visible enough to be a periodic reminder, but not so sticky
 * that admins resent it.
 */
export default function ConnectStripeBanner() {
	const { data } = api.payments.shouldShowConnectBanner.useQuery();
	const [dismissed, setDismissed] = useState(false);

	if (!data || data.show !== true || dismissed) return null;

	return (
		<div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
			<div className="flex-1 text-amber-900 text-sm">
				<span className="font-medium">
					Connect Stripe to accept online payments.
				</span>{" "}
				<Link
					href="/admin/settings/payments"
					className="font-medium underline hover:text-amber-700"
				>
					Set up payments →
				</Link>
			</div>
			<button
				type="button"
				onClick={() => setDismissed(true)}
				className="rounded p-1 text-amber-900 transition-colors hover:bg-amber-100"
				aria-label="Dismiss"
			>
				<X size={16} />
			</button>
		</div>
	);
}
