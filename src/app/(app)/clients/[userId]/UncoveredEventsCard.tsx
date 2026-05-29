"use client";

import { AlertCircle } from "lucide-react";
import { useState } from "react";
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
									setPendingId(r.registrationId);
									chargeMutation.mutate({ registrationId: r.registrationId });
								}}
							>
								{isPending ? "Billing…" : "Bill"}
							</Button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
