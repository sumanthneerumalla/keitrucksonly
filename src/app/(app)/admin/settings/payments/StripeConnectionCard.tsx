"use client";

import type { ClubStripeAccount } from "@prisma/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/app/_components/shared/dialog";
import { api } from "~/trpc/react";

interface ConnectionStatus {
	account: ClubStripeAccount | null;
	isReadyForCharges: boolean;
	/** Accounts v2 migration — prefill the pre-Connect form's contact email. */
	adminEmail: string | null;
}

interface StripeConnectionCardProps {
	initialStatus: ConnectionStatus;
}

type EntityType = "company" | "individual" | "non_profit" | "government_entity";

interface PreConnectFormState {
	businessName: string;
	country: string;
	entityType: EntityType;
	contactEmail: string;
	displayName: string;
}

/** Mirror of the server-side Zod input for `payments.startOnboarding`. */
function validatePreConnectForm(state: PreConnectFormState): {
	errors: Partial<Record<keyof PreConnectFormState, string>>;
	isValid: boolean;
} {
	const errors: Partial<Record<keyof PreConnectFormState, string>> = {};
	if (state.businessName.trim().length === 0) {
		errors.businessName = "Business name is required.";
	} else if (state.businessName.length > 200) {
		errors.businessName = "Business name must be 200 characters or fewer.";
	}
	if (state.country.trim().length !== 2) {
		errors.country = "Country code must be 2 letters.";
	}
	const email = state.contactEmail.trim();
	if (email.length === 0) {
		errors.contactEmail = "Contact email is required.";
	} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		errors.contactEmail = "Enter a valid email address.";
	}
	if (state.displayName.length > 200) {
		errors.displayName = "Display name must be 200 characters or fewer.";
	}
	return { errors, isValid: Object.keys(errors).length === 0 };
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

	// Accounts v2 migration (2026-06-01) — pre-Connect form modal. The
	// `[Set up Stripe →]` button opens this dialog; submit calls
	// `payments.startOnboarding` with the 5 collected fields, then
	// full-window-redirects to the returned hosted onboarding URL.
	const [setupDialogOpen, setSetupDialogOpen] = useState(false);
	const [formState, setFormState] = useState<PreConnectFormState>(() => ({
		businessName: "",
		country: "us",
		entityType: "company",
		contactEmail: initialStatus.adminEmail ?? "",
		displayName: "",
	}));
	const [submitAttempted, setSubmitAttempted] = useState(false);

	const validation = useMemo(
		() => validatePreConnectForm(formState),
		[formState],
	);

	const startOnboardingMutation = api.payments.startOnboarding.useMutation({
		onSuccess: (data) => {
			// Full-window navigation: Stripe Account Link is on stripe.com, so
			// the in-app router can't handle it. Replace the current entry so
			// the back button skips the throwaway "loading" state.
			window.location.href = data.url;
		},
		onError: (err) => toast(err.message, "error"),
	});

	function handleSubmitSetupForm(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setSubmitAttempted(true);
		if (!validation.isValid) return;
		startOnboardingMutation.mutate({
			businessName: formState.businessName.trim(),
			country: formState.country.trim().toLowerCase(),
			entityType: formState.entityType,
			contactEmail: formState.contactEmail.trim(),
			displayName:
				formState.displayName.trim().length > 0
					? formState.displayName.trim()
					: undefined,
		});
	}

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
		const isPending = startOnboardingMutation.isPending;
		return (
			<>
				<div className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
					<h2 className="mb-2 font-medium text-[var(--foreground)] text-lg">
						<span aria-hidden>⚪ </span>Stripe
					</h2>
					<p className="mb-4 text-[var(--muted-foreground)] text-sm">
						Accept online payments by connecting your Stripe account.
						ShuttleMentor takes no platform fee today.
					</p>
					<Button
						onClick={() => {
							setSubmitAttempted(false);
							setSetupDialogOpen(true);
						}}
						disabled={isPending}
					>
						{isPending ? "Redirecting…" : "Set up Stripe →"}
					</Button>
				</div>

				<Dialog
					open={setupDialogOpen}
					onOpenChange={(next) => {
						// Block dismiss while the redirect is in flight — closing the
						// dialog mid-redirect would leave the user on a "Redirecting…"
						// state with no way back.
						if (isPending) return;
						setSetupDialogOpen(next);
					}}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Set up Stripe</DialogTitle>
						</DialogHeader>
						<form onSubmit={handleSubmitSetupForm}>
							<DialogBody>
								<p className="text-[var(--muted-foreground)] text-sm">
									We'll send this info to Stripe along with your account
									creation. Stripe will then ask for additional verification
									(bank account, tax ID, etc.).
								</p>
								<FormField
									label="Business name"
									required
									error={
										submitAttempted ? validation.errors.businessName : undefined
									}
								>
									<input
										type="text"
										value={formState.businessName}
										onChange={(e) =>
											setFormState((s) => ({
												...s,
												businessName: e.target.value,
											}))
										}
										maxLength={200}
										disabled={isPending}
										className="block w-full rounded border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ink)] focus:outline-none disabled:opacity-50"
									/>
								</FormField>
								<FormField
									label="Country"
									required
									error={
										submitAttempted ? validation.errors.country : undefined
									}
									help="US-only for now — contact us if you need another country."
								>
									{/* US-only per owner direction (designFiles/roadmap/
									    phase12-stripe-connect.md §23 row 12). The select is
									    kept (rather than removed) so a future expansion
									    only re-enables more options. */}
									<select
										value={formState.country}
										onChange={(e) =>
											setFormState((s) => ({ ...s, country: e.target.value }))
										}
										disabled={isPending}
										className="block w-full rounded border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ink)] focus:outline-none disabled:opacity-50"
									>
										<option value="us">United States</option>
									</select>
								</FormField>
								<FormField
									label="Entity type"
									required
									error={
										submitAttempted ? validation.errors.entityType : undefined
									}
								>
									<select
										value={formState.entityType}
										onChange={(e) =>
											setFormState((s) => ({
												...s,
												entityType: e.target.value as EntityType,
											}))
										}
										disabled={isPending}
										className="block w-full rounded border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ink)] focus:outline-none disabled:opacity-50"
									>
										<option value="company">Company</option>
										<option value="individual">Individual</option>
										<option value="non_profit">Non-profit</option>
										<option value="government_entity">Government entity</option>
									</select>
								</FormField>
								<FormField
									label="Contact email"
									required
									error={
										submitAttempted ? validation.errors.contactEmail : undefined
									}
								>
									<input
										type="email"
										value={formState.contactEmail}
										onChange={(e) =>
											setFormState((s) => ({
												...s,
												contactEmail: e.target.value,
											}))
										}
										maxLength={255}
										disabled={isPending}
										className="block w-full rounded border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ink)] focus:outline-none disabled:opacity-50"
									/>
								</FormField>
								<FormField
									label="Display name"
									error={
										submitAttempted ? validation.errors.displayName : undefined
									}
									help="How your name appears to customers — defaults to business name."
								>
									<input
										type="text"
										value={formState.displayName}
										onChange={(e) =>
											setFormState((s) => ({
												...s,
												displayName: e.target.value,
											}))
										}
										maxLength={200}
										disabled={isPending}
										placeholder={formState.businessName}
										className="block w-full rounded border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ink)] focus:outline-none disabled:opacity-50"
									/>
								</FormField>
							</DialogBody>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setSetupDialogOpen(false)}
									disabled={isPending}
								>
									Cancel
								</Button>
								<Button
									type="submit"
									className="ml-2"
									disabled={
										isPending || (submitAttempted && !validation.isValid)
									}
								>
									{isPending ? "Redirecting…" : "Continue to Stripe →"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</>
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

function FormField({
	label,
	required,
	error,
	help,
	children,
}: {
	label: string;
	required?: boolean;
	error?: string;
	help?: string;
	children: React.ReactNode;
}) {
	// We don't use a <label> wrapper so we don't trip biome's
	// `noLabelWithoutControl` rule, which can't see through the polymorphic
	// `children` slot. The input is still adjacent and the caption text is
	// visible right above — accessibility is fine for this small admin form.
	return (
		<div>
			<p className="mb-1 block font-medium text-[var(--foreground)] text-sm">
				{label}
				{required ? <span className="ml-1 text-red-500">*</span> : null}
			</p>
			{children}
			{error ? (
				<p className="mt-1 text-red-600 text-xs">{error}</p>
			) : help ? (
				<p className="mt-1 text-[var(--muted-foreground)] text-xs">{help}</p>
			) : null}
		</div>
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
