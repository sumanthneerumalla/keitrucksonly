"use client";

import { AlertCircle, X } from "lucide-react";
import { useState } from "react";
import BillToUserPicker from "~/app/_components/shared/BillToUserPicker";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { formatCents } from "~/lib/money";
import { api } from "~/trpc/react";

/**
 * Phase 9a (E18) — "Needs billing" card on the client page. Lists this member's
 * UNCOVERED billable event registrations: events with a productId + creditCost
 * that the member attended (or no-showed / late-cancelled) without a covering
 * package, that haven't yet been billed. Each row is a one-click "Bill" button
 * that calls `billing.chargeEventRegistration` and removes the row on success.
 *
 * Hidden entirely when there are no uncovered sessions (no empty-state noise).
 * Inactive-product rows show but their Bill button is disabled — staff are
 * pointed at "Add charge" with a custom amount for those.
 */

interface UncoveredEventsCardProps {
	userId: string;
}

const STATUS_LABEL: Record<string, string> = {
	CHECKED_IN: "Attended",
	NO_SHOW: "No-show",
	LATE_CANCEL: "Late cancel",
};

function formatEventDate(d: Date | string): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(d));
}

export default function UncoveredEventsCard({
	userId,
}: UncoveredEventsCardProps) {
	const { toast } = useToast();
	const utils = api.useUtils();
	// Per-row pending tracker so only the clicked row's button shows "Billing…".
	// `chargeMutation.isPending` is the global guard against double-click.
	const [pendingId, setPendingId] = useState<string | null>(null);
	// Bill-to modal state — when non-null, a modal appears for this row asking
	// who to bill. Stores the registrationId of the row being billed.
	const [billingRegistrationId, setBillingRegistrationId] = useState<
		string | null
	>(null);
	const [billToUser, setBillToUser] = useState<{
		userId: string;
		firstName: string | null;
		lastName: string | null;
		email: string | null;
	} | null>(null);
	// True when staff typed a bill-to query but didn't pick anyone — blocks
	// Confirm so they can't silently fall through to self-pay.
	const [billToTypedButUnselected, setBillToTypedButUnselected] =
		useState<boolean>(false);

	const query = api.billing.listUncoveredEvents.useQuery(
		{ userId },
		{ enabled: !!userId },
	);

	const chargeMutation = api.billing.chargeEventRegistration.useMutation({
		onSuccess: async (data) => {
			toast(`Charge added to Invoice ${data.invoice.invoiceNumber}`, "success");
			// Refresh the panel rollups + the needs-billing list (the just-billed
			// row drops off) + any open invoice-detail view for the affected
			// invoice (parity with RecordPaymentModal / AddChargeModal).
			await Promise.all([
				utils.billing.listUncoveredEvents.invalidate({ userId }),
				utils.billing.getMemberBilling.invalidate({ userId }),
				utils.billing.getInvoice.invalidate({
					invoiceId: data.invoice.invoiceId,
				}),
			]);
			setPendingId(null);
		},
		onError: (err) => {
			toast(err.message, "error");
			setPendingId(null);
		},
	});

	// Quiet rendering — no skeleton while loading first time, no empty state
	// when there's nothing to bill. The card only appears when there's work.
	if (query.isLoading) return null;
	const rows = query.data?.rows ?? [];
	if (rows.length === 0) return null;

	return (
		<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
			<h4 className="mb-2 flex items-center gap-2 font-semibold text-amber-900 text-sm dark:text-amber-100">
				<AlertCircle size={14} />
				Needs billing — {rows.length}{" "}
				{rows.length === 1 ? "session" : "sessions"}
			</h4>
			<p className="mb-3 text-amber-800 text-xs dark:text-amber-200">
				Billable sessions this member completed without a covering package.
				Click <span className="font-medium">Bill</span> to add the charge to
				their open tab (a fresh tab opens if none is open).
			</p>
			<ul className="space-y-2">
				{rows.map((r) => {
					const isPending = pendingId === r.registrationId;
					const disabled = chargeMutation.isPending || !r.productIsActive;
					return (
						<li
							key={r.registrationId}
							className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2 dark:border-amber-900 dark:bg-amber-950/20"
						>
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium text-[var(--foreground)] text-sm">
									{r.eventTitle}
								</div>
								<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--muted-foreground)] text-xs">
									<span>{formatEventDate(r.eventStart)}</span>
									<span aria-hidden>·</span>
									<span>{STATUS_LABEL[r.status] ?? r.status}</span>
									<span aria-hidden>·</span>
									<span className="font-mono">
										{formatCents(r.priceInCents)}
									</span>
									{!r.productIsActive && (
										<>
											<span aria-hidden>·</span>
											<span className="text-amber-700 dark:text-amber-300">
												product inactive — use Add charge
											</span>
										</>
									)}
								</div>
							</div>
							<Button
								size="sm"
								variant="outline"
								disabled={disabled}
								onClick={() => {
									setBillingRegistrationId(r.registrationId);
									setBillToUser(null);
								}}
							>
								{isPending ? "Billing…" : "Bill"}
							</Button>
						</li>
					);
				})}
			</ul>

			{/* Bill-to modal — appears when the user clicks Bill on a row */}
			{billingRegistrationId !== null && (
				<>
					{/* Backdrop */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a visual scrim */}
					<div
						className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
						onClick={() => {
							if (!chargeMutation.isPending) {
								setBillingRegistrationId(null);
								setBillToUser(null);
							}
						}}
					/>
					{/* Modal */}
					<div className="glass-panel -translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 w-full max-w-sm rounded-lg border border-[var(--border)] shadow-xl">
						{/* Header */}
						<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
							<h3 className="font-semibold text-[var(--foreground)] text-base">
								Who to bill?
							</h3>
							<button
								onClick={() => {
									if (!chargeMutation.isPending) {
										setBillingRegistrationId(null);
										setBillToUser(null);
									}
								}}
								disabled={chargeMutation.isPending}
								className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
								aria-label="Close"
								type="button"
							>
								<X size={18} />
							</button>
						</div>
						{/* Body */}
						<div className="space-y-4 px-6 py-5">
							<BillToUserPicker
								consumerId={userId}
								value={billToUser}
								onChange={setBillToUser}
								disabled={chargeMutation.isPending}
								label="Bill to"
								helperText="Choose who pays for this event. Defaults to the member."
								onTypedButUnselectedChange={setBillToTypedButUnselected}
							/>
						</div>
						{/* Footer */}
						<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t px-6 py-4">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => {
									setBillingRegistrationId(null);
									setBillToUser(null);
								}}
								disabled={chargeMutation.isPending}
							>
								Cancel
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={chargeMutation.isPending || billToTypedButUnselected}
								onClick={() => {
									setPendingId(billingRegistrationId);
									chargeMutation.mutate({
										registrationId: billingRegistrationId,
										billToUserId: billToUser?.userId,
									});
									setBillingRegistrationId(null);
									setBillToUser(null);
									setBillToTypedButUnselected(false);
								}}
							>
								{chargeMutation.isPending ? "Billing…" : "Confirm"}
							</Button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
