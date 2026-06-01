"use client";

import type { ClubStripeAccount } from "@prisma/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

interface ConnectionStatus {
	account: ClubStripeAccount | null;
	isReadyForCharges: boolean;
}

interface StripeConnectionCardProps {
	initialStatus: ConnectionStatus;
}

/**
 * Phase 12a Round 3 Stream 5 — Stripe connection card.
 *
 * Renders two distinct states off the cached `ClubStripeAccount` row:
 *
 * 1. **Not connected** (`account === null`): white card with a single
 *    [Connect Stripe →] button that calls `payments.startOnboarding` and
 *    full-window-redirects to the returned Account Link URL. We use
 *    `window.location.href` rather than Next.js's router because Account
 *    Link is an external Stripe domain — a `router.push` would attempt to
 *    treat it as an internal route.
 *
 * 2. **Connected** (`account !== null`): account email + status pills for
 *    chargesEnabled / payoutsEnabled, last-sync timestamp, an external
 *    "Open Stripe dashboard" link, a Refresh button (manual trigger for
 *    `payments.refreshAccountStatus`), and a Disconnect button gated by
 *    an AlertDialog.
 *
 * Auto-refresh: when the user lands here with `?stripe=return` (the URL we
 * pass to `provider.createOnboardingLink`), we call
 * `payments.refreshAccountStatus` once on mount so the page reflects the
 * outcome of onboarding without requiring a manual click. Stripe's
 * `account.updated` webhook eventually does the same thing async — this is
 * the synchronous belt that catches the typical case where the user
 * completes onboarding and returns before the webhook arrives.
 */
export default function StripeConnectionCard({
	initialStatus,
}: StripeConnectionCardProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { toast } = useToast();

	const isReturning = searchParams.get("stripe") === "return";
	// Guard so StrictMode's double-mount in dev doesn't fire the auto-refresh
	// twice. Also flips back to false once refresh completes so we don't loop.
	const autoRefreshedRef = useRef(false);

	const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

	const startOnboardingMutation = api.payments.startOnboarding.useMutation({
		onSuccess: (data) => {
			// Full-window navigation: Stripe Account Link is on stripe.com, so
			// the in-app router can't handle it. Replace the current entry so
			// the back button skips the throwaway "loading" state.
			window.location.href = data.url;
		},
		onError: (err) => toast(err.message, "error"),
	});

	const refreshMutation = api.payments.refreshAccountStatus.useMutation({
		onSuccess: () => {
			toast("Stripe status refreshed", "success");
			// Re-fetch the page so the server component picks up the new row.
			router.refresh();
		},
		onError: (err) => toast(err.message, "error"),
	});

	const disconnectMutation = api.payments.disconnect.useMutation({
		onSuccess: () => {
			toast("Stripe disconnected", "success");
			setConfirmDisconnectOpen(false);
			router.refresh();
		},
		onError: (err) => {
			toast(err.message, "error");
			setConfirmDisconnectOpen(false);
		},
	});

	// Auto-refresh on Stripe return. Only runs when we have a row to refresh
	// (the very first onboarding click creates the row INSIDE the mutation,
	// so by the time Stripe redirects us back, the row exists).
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional once-on-mount-when-returning effect
	useEffect(() => {
		if (
			isReturning &&
			!autoRefreshedRef.current &&
			initialStatus.account !== null
		) {
			autoRefreshedRef.current = true;
			refreshMutation.mutate();
			// Strip the ?stripe=return param so a reload doesn't re-trigger.
			router.replace("/admin/settings/payments");
		}
	}, []);

	if (initialStatus.account === null) {
		// ─── Not connected ────────────────────────────────────────────────
		return (
			<div className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
				<h2 className="mb-2 font-medium text-[var(--foreground)] text-lg">
					<span aria-hidden>⚪ </span>Stripe
				</h2>
				<p className="mb-4 text-[var(--muted-foreground)] text-sm">
					Accept online payments by connecting your Stripe account.
					ShuttleMentor takes no platform fee today.
				</p>
				<Button
					onClick={() => startOnboardingMutation.mutate()}
					disabled={startOnboardingMutation.isPending}
				>
					{startOnboardingMutation.isPending
						? "Redirecting…"
						: "Connect Stripe →"}
				</Button>
			</div>
		);
	}

	// ─── Connected ────────────────────────────────────────────────────────
	const account = initialStatus.account;
	const isDisconnected = account.disconnectedAt !== null;
	const dashboardUrl = account.livemode
		? `https://dashboard.stripe.com/${account.stripeAccountId}`
		: `https://dashboard.stripe.com/${account.stripeAccountId}/test`;

	return (
		<>
			<div className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
				<div className="mb-4 flex items-start justify-between gap-4">
					<div>
						<h2 className="font-medium text-[var(--foreground)] text-lg">
							<span aria-hidden>{isDisconnected ? "⚪ " : "✅ "}</span>
							Stripe
						</h2>
						{account.accountEmail && (
							<p className="mt-1 text-[var(--muted-foreground)] text-sm">
								{account.accountEmail}
							</p>
						)}
						{isDisconnected && (
							<p className="mt-1 font-medium text-amber-600 text-sm">
								Disconnected
							</p>
						)}
					</div>
					<div className="flex flex-col items-end gap-1 text-xs">
						<StatusPill label="Charges" enabled={account.chargesEnabled} />
						<StatusPill label="Payouts" enabled={account.payoutsEnabled} />
					</div>
				</div>

				<div className="mb-4 grid grid-cols-2 gap-2 text-sm">
					<div className="text-[var(--muted-foreground)]">Account ID</div>
					<div className="text-right font-mono text-[var(--foreground)] text-xs">
						{account.stripeAccountId}
					</div>
					<div className="text-[var(--muted-foreground)]">Mode</div>
					<div className="text-right text-[var(--foreground)]">
						{account.livemode ? "Live" : "Test"}
					</div>
					<div className="text-[var(--muted-foreground)]">Last synced</div>
					<div className="text-right text-[var(--foreground)]">
						{formatRelativeTime(account.lastSyncedAt)}
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<a
						href={dashboardUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-[var(--line-2)] bg-transparent px-3 font-medium text-[var(--ink)] text-sm transition-colors hover:bg-[rgba(20,19,14,0.04)]"
					>
						Open Stripe dashboard ↗
					</a>
					<Button
						variant="outline"
						size="sm"
						onClick={() => refreshMutation.mutate()}
						disabled={refreshMutation.isPending}
					>
						{refreshMutation.isPending ? "Refreshing…" : "Refresh"}
					</Button>
					{!isDisconnected && (
						<Button
							variant="destructive-outline"
							size="sm"
							onClick={() => setConfirmDisconnectOpen(true)}
							disabled={disconnectMutation.isPending}
						>
							Disconnect
						</Button>
					)}
				</div>
			</div>

			<AlertDialog
				open={confirmDisconnectOpen}
				title="Disconnect Stripe?"
				description="ShuttleMentor will stop offering online payments for this club. Your Stripe account itself stays open — you can reconnect at any time."
				confirmLabel={
					disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"
				}
				cancelLabel="Cancel"
				destructive
				confirmDisabled={disconnectMutation.isPending}
				onConfirm={() => disconnectMutation.mutate({ confirm: true })}
				onCancel={() => {
					if (!disconnectMutation.isPending) setConfirmDisconnectOpen(false);
				}}
			/>
		</>
	);
}

function StatusPill({ label, enabled }: { label: string; enabled: boolean }) {
	return (
		<span
			className={
				enabled
					? "inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700"
					: "inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
			}
		>
			<span aria-hidden>{enabled ? "✓" : "⏳"}</span>
			{label} {enabled ? "enabled" : "pending"}
		</span>
	);
}

function formatRelativeTime(date: Date | string): string {
	const d = typeof date === "string" ? new Date(date) : date;
	const ms = Date.now() - d.getTime();
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
