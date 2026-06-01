"use client";

/**
 * Phase 12a Round 3 Stream 6 — shared confirmation client with polling.
 *
 * Powers BOTH `/shop/confirmation` (guest variant — sign-in CTAs) and
 * `/checkout/confirmation` (in-app variant — sends logged-in members back
 * to the relevant /account/* page).
 *
 * Polling (§7.8.11 E5): every 2s for up to 30s. The webhook race window —
 * Stripe charges the card BEFORE the local row is updated — is the reason
 * for the polling loop. We stop polling on 'completed' / 'expired' /
 * 'failed' and stop fetching at 15 polls regardless.
 *
 * Branches (§7.8.7 SIMPLIFIED 2026-05-30 — 3 cases matching the 3 family-
 * group outcomes from §7.8.6):
 *   1. `no_op_self_pay`              — buyer === beneficiary (one identity)
 *   2. `created`                     — both new, we linked them as a family
 *   3. `not_linked_existing_group`   — one or both already had a family group,
 *                                       so we left them alone
 *
 * The poll endpoint deliberately returns a minimal surface (status +
 * familyGroupOutcome) — no emails / identities — so we render branches by
 * familyGroupOutcome alone. The copy is the §7.8.7 mockup, not final UX.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import type { FamilyGroupLinkOutcome } from "~/server/services/payments/types";
import { api } from "~/trpc/react";

interface ConfirmationClientProps {
	sessionId: string;
	variant: "guest" | "inapp";
}

const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 15; // 15 * 2s = 30s total

type Status = "open" | "completed" | "expired" | "failed";

export default function ConfirmationClient({
	sessionId,
	variant,
}: ConfirmationClientProps) {
	const [polls, setPolls] = useState(0);
	const [stoppedPolling, setStoppedPolling] = useState(false);

	const { data, refetch } = api.payments.getCheckoutSessionStatus.useQuery(
		{ sessionId },
		{
			refetchOnWindowFocus: false,
		},
	);

	useEffect(() => {
		if (stoppedPolling) return;
		// Stop conditions: terminal status from server, or 15 polls reached.
		if (
			data?.status === "completed" ||
			data?.status === "expired" ||
			data?.status === "failed"
		) {
			setStoppedPolling(true);
			return;
		}
		if (polls >= MAX_POLLS) {
			setStoppedPolling(true);
			return;
		}
		const handle = setInterval(() => {
			setPolls((n) => n + 1);
			void refetch();
		}, POLL_INTERVAL_MS);
		return () => clearInterval(handle);
	}, [data?.status, polls, refetch, stoppedPolling]);

	const status: Status = data?.status ?? "open";

	if (status === "expired" || status === "failed") {
		return (
			<div className="mx-auto max-w-2xl space-y-4 p-6 text-center">
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Checkout was not completed
				</h1>
				<p className="text-[var(--muted-foreground)] text-sm">
					Your card was not charged. If you were trying to complete a purchase,
					please start again from the shop.
				</p>
			</div>
		);
	}

	if (status === "open") {
		// Either still waiting (polls in progress) or we hit the 30s ceiling.
		return (
			<div className="mx-auto max-w-2xl space-y-4 p-6 text-center">
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					{stoppedPolling
						? "Processing — receipt is in your email"
						: "Finishing up your purchase…"}
				</h1>
				<p className="text-[var(--muted-foreground)] text-sm">
					{stoppedPolling
						? "Your payment is processing. Check your email for the receipt — your account will be ready once you sign in."
						: "We're confirming your payment with the bank. This usually takes a few seconds."}
				</p>
				{stoppedPolling && (
					<div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setPolls(0);
								setStoppedPolling(false);
								void refetch();
							}}
						>
							Refresh
						</Button>
					</div>
				)}
			</div>
		);
	}

	// status === 'completed' — pick the branch from familyGroupOutcome.
	return (
		<SuccessBranches outcome={data?.familyGroupOutcome} variant={variant} />
	);
}

function SuccessBranches({
	outcome,
	variant,
}: {
	outcome: FamilyGroupLinkOutcome | undefined;
	variant: "guest" | "inapp";
}) {
	// Match the §7.8.7 SIMPLIFIED case table (3 branches). Without an outcome
	// value (single-identity path or a refund.created event) we render the
	// self-pay branch.
	const isSelfPay = outcome === undefined || outcome === "no_op_self_pay";
	const isCreatedFamilyGroup = outcome === "created";
	const isExistingGroupUntouched = outcome === "not_linked_existing_group";

	// In-app variants give the user a direct deep link rather than a sign-in
	// CTA. Defaults to /invoices — the member-facing self-service billing page
	// (the broadest "what did I just buy" landing pad before per-item
	// destinations exist).
	const inappCta = (
		<Button asChild>
			<Link href="/invoices">Go to my account →</Link>
		</Button>
	);
	const guestSignInCta = (
		<Button asChild>
			<Link href="/sign-in">Sign in →</Link>
		</Button>
	);

	return (
		<div className="mx-auto max-w-2xl space-y-6 p-6 text-center">
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl text-[var(--foreground)]">
					Thanks! Your payment was received.
				</h1>
				<p className="text-[var(--muted-foreground)] text-sm">
					A receipt has been sent to the email on file.
				</p>
			</div>

			{isSelfPay && (
				<div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
					{variant === "guest" ? (
						<>
							<p>
								Your ShuttleMentor account is ready. Sign in using the email you
								provided at checkout to see your purchase.
							</p>
							<div>{guestSignInCta}</div>
						</>
					) : (
						<>
							<p>Your purchase is on your account.</p>
							<div>{inappCta}</div>
						</>
					)}
				</div>
			)}

			{isCreatedFamilyGroup && (
				<div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
					<p>
						We've linked you and the beneficiary as a family group so credits
						can be shared. The beneficiary's account holds the credits /
						registration; this payment is recorded on yours.
					</p>
					{variant === "guest" ? (
						<div>{guestSignInCta}</div>
					) : (
						<div>{inappCta}</div>
					)}
				</div>
			)}

			{isExistingGroupUntouched && (
				<div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-700/40 dark:bg-amber-900/20">
					<p className="text-[var(--foreground)]">
						Your purchase is recorded — the beneficiary's account holds the
						credits / registration and this payment is on yours. You or the
						beneficiary is already in a family group, so we didn't auto-link
						you. If you'd like to be linked, contact your club admin.
					</p>
					{variant === "guest" ? (
						<div>{guestSignInCta}</div>
					) : (
						<div>{inappCta}</div>
					)}
				</div>
			)}
		</div>
	);
}
