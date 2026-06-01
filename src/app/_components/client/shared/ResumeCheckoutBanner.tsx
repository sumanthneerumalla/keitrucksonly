"use client";

/**
 * Phase 12a Round 3 Stream 6 — "Resume checkout" banner per
 * designFiles/roadmap/phase12-stripe-connect.md §7.8.13.
 *
 * Mounted in `/account/layout.tsx` so it shows above any /account/* page.
 * Queries `payments.listMyOpenCheckouts` on mount; if any non-expired open
 * checkout sessions exist for the viewer (matched on `initiatedByUserId`
 * per Round 2.7.1 — actor, not beneficiary), surfaces a one-line banner
 * with Resume + dismiss controls.
 *
 * Resume → router push to `/checkout/[checkoutSessionId]` — the Stripe iframe
 * page picks up the still-valid `clientSecret`.
 * Dismiss → `payments.dismissCheckoutSession` mutation → row flipped to
 * status='expired' → banner disappears on next refetch.
 */

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { formatCents } from "~/lib/money";
import { api } from "~/trpc/react";

export default function ResumeCheckoutBanner() {
	const router = useRouter();
	const { toast } = useToast();
	const utils = api.useUtils();

	// Guest visitors won't have a session — the query is `protectedProcedure`
	// so it'll fail for unauthenticated requests. We let react-query swallow
	// the error and just render nothing (the layout that mounts us is itself
	// gated by the AuthedLayout chrome).
	const { data, isLoading, error } = api.payments.listMyOpenCheckouts.useQuery(
		undefined,
		{
			// Tight cadence so a fresh checkout-form submission's row surfaces
			// without a manual refresh, but not so tight that we hammer the API.
			refetchOnWindowFocus: true,
			retry: false,
		},
	);

	const dismiss = api.payments.dismissCheckoutSession.useMutation({
		onSuccess: async () => {
			await utils.payments.listMyOpenCheckouts.invalidate();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	if (isLoading || error || !data || data.length === 0) return null;

	// §7.8.13 — the design shows a single banner. If multiple open sessions
	// exist (corner case) we surface the newest first (the query already
	// orders by createdAt desc).
	const session = data[0];
	if (!session) return null;

	return (
		<div className="border border-amber-300 border-b bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
			<div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 text-sm">
				<span aria-hidden>⏳</span>
				<span className="flex-1">
					You have an unfinished checkout for{" "}
					<span className="font-medium">{session.description}</span>
					{" — "}
					<span className="font-mono">
						{formatCents(session.amountInCents)}
					</span>
					.
				</span>
				<Button
					size="sm"
					variant="default"
					onClick={() => router.push(`/checkout/${session.checkoutSessionId}`)}
				>
					Resume
				</Button>
				<button
					type="button"
					aria-label="Dismiss"
					className="rounded p-1 transition-colors hover:bg-amber-100 dark:hover:bg-amber-800/40"
					disabled={dismiss.isPending}
					onClick={() =>
						dismiss.mutate({ checkoutSessionId: session.checkoutSessionId })
					}
				>
					<X size={14} />
				</button>
			</div>
		</div>
	);
}
