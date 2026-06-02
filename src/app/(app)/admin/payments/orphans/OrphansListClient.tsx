"use client";

import { OrphanedPurchaseStatus } from "@prisma/client";
import { useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { api } from "~/trpc/react";

/**
 * Phase 12a Round 3 Stream 5 — orphan triage table.
 *
 * Per-row actions match the three locked resolve outcomes (§10 + Round 2
 * Blocker #4):
 *
 *  1. **Reconcile manually** — for "I already fixed this in the dashboard /
 *     emailed the buyer / found the matching record." Opens a small form
 *     for free-text notes (optional but encouraged for auditability), then
 *     calls `payments.resolveOrphan` with `action: 'reconcile'`. Status
 *     row moves to RECONCILED.
 *
 *  2. **Refund via Stripe** — destructive (real money goes back). Confirms
 *     via `<AlertDialog>` first; on confirm calls `resolveOrphan` with
 *     `action: 'refund_via_stripe'`. The backend reads the original amount
 *     off `rawEvent` and builds the deterministic idempotency key
 *     (`manual-refund-<orphanId>`) — we don't pass one from the client.
 *
 *  3. **Ignore** — for noise / known dupes. Marks IGNORED with optional
 *     notes; confirm dialog is gentler (non-destructive).
 *
 * Status filter defaults to PENDING (the only actionable bucket); the
 * "All" option surfaces resolved rows for retrospective review.
 */

const STATUS_OPTIONS: Array<{
	label: string;
	value: OrphanedPurchaseStatus | "ALL";
}> = [
	{ label: "Pending", value: OrphanedPurchaseStatus.PENDING },
	{ label: "Reconciled", value: OrphanedPurchaseStatus.RECONCILED },
	{ label: "Refunded", value: OrphanedPurchaseStatus.REFUNDED },
	{ label: "Ignored", value: OrphanedPurchaseStatus.IGNORED },
	{ label: "All", value: "ALL" },
];

type ResolveAction = "reconcile" | "refund_via_stripe" | "ignore";

interface PendingDialog {
	orphanId: string;
	action: ResolveAction;
}

export default function OrphansListClient() {
	const { toast } = useToast();
	const utils = api.useUtils();

	const [statusFilter, setStatusFilter] = useState<
		OrphanedPurchaseStatus | "ALL"
	>(OrphanedPurchaseStatus.PENDING);
	const [pending, setPending] = useState<PendingDialog | null>(null);
	const [notes, setNotes] = useState("");

	const listQuery = api.payments.listOrphans.useQuery(
		statusFilter === "ALL" ? undefined : { status: statusFilter },
	);

	const resolveMutation = api.payments.resolveOrphan.useMutation({
		onSuccess: async (_data, variables) => {
			const label =
				variables.action === "refund_via_stripe"
					? "Refunded via Stripe"
					: variables.action === "reconcile"
						? "Marked reconciled"
						: "Marked ignored";
			toast(label, "success");
			setPending(null);
			setNotes("");
			await utils.payments.listOrphans.invalidate();
		},
		onError: (err) => {
			toast(err.message, "error");
			// Leave the dialog open so the user can read the error + retry or
			// pick a different action; don't reset notes either.
		},
	});

	const closeDialog = () => {
		if (resolveMutation.isPending) return;
		setPending(null);
		setNotes("");
	};

	const submit = () => {
		if (!pending) return;
		resolveMutation.mutate({
			orphanId: pending.orphanId,
			action: pending.action,
			notes: notes.trim() ? notes.trim() : undefined,
		});
	};

	const dialogConfig = pending ? getDialogConfig(pending.action) : null;

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2">
				<label
					htmlFor="orphan-status-filter"
					className="text-[var(--muted-foreground)] text-sm"
				>
					Status:
				</label>
				<select
					id="orphan-status-filter"
					value={statusFilter}
					onChange={(e) =>
						setStatusFilter(e.target.value as OrphanedPurchaseStatus | "ALL")
					}
					className="h-9 rounded-md border border-input bg-transparent px-3 text-[var(--foreground)] text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{STATUS_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
			</div>

			<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white">
				<table className="w-full text-sm">
					<thead className="bg-[var(--muted)] text-[var(--muted-foreground)] text-xs uppercase">
						<tr>
							<th className="px-4 py-2 text-left">Reason</th>
							<th className="px-4 py-2 text-left">Email</th>
							<th className="px-4 py-2 text-left">Session / PI</th>
							<th className="px-4 py-2 text-left">Created</th>
							<th className="px-4 py-2 text-left">Status</th>
							<th className="px-4 py-2 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{listQuery.isLoading && (
							<tr>
								<td
									colSpan={6}
									className="px-4 py-6 text-center text-[var(--muted-foreground)]"
								>
									Loading…
								</td>
							</tr>
						)}
						{listQuery.isError && (
							<tr>
								<td colSpan={6} className="px-4 py-6 text-center text-red-600">
									{listQuery.error.message}
								</td>
							</tr>
						)}
						{listQuery.data && listQuery.data.items.length === 0 && (
							<tr>
								<td
									colSpan={6}
									className="px-4 py-6 text-center text-[var(--muted-foreground)]"
								>
									No orphaned purchases.
								</td>
							</tr>
						)}
						{listQuery.data?.items.map((row) => (
							<tr key={row.id} className="border-[var(--border)] border-t">
								<td className="px-4 py-3 text-[var(--foreground)]">
									{row.reason}
								</td>
								<td className="px-4 py-3 text-[var(--foreground)]">
									{row.email ?? "—"}
								</td>
								<td className="px-4 py-3 font-mono text-[var(--muted-foreground)] text-xs">
									{row.providerSessionId ?? row.providerPaymentIntentId ?? "—"}
								</td>
								<td className="px-4 py-3 text-[var(--muted-foreground)]">
									{new Date(row.createdAt).toLocaleString()}
								</td>
								<td className="px-4 py-3">
									<StatusBadge status={row.status} />
								</td>
								<td className="px-4 py-3">
									<div className="flex justify-end gap-2">
										{row.status === OrphanedPurchaseStatus.PENDING ? (
											<>
												<Button
													variant="outline"
													size="sm"
													onClick={() =>
														setPending({
															orphanId: row.id,
															action: "reconcile",
														})
													}
												>
													Reconcile
												</Button>
												<Button
													variant="destructive-outline"
													size="sm"
													disabled={!row.providerPaymentIntentId}
													title={
														row.providerPaymentIntentId
															? undefined
															: "No payment intent — refund via Stripe dashboard"
													}
													onClick={() =>
														setPending({
															orphanId: row.id,
															action: "refund_via_stripe",
														})
													}
												>
													Refund via Stripe
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														setPending({
															orphanId: row.id,
															action: "ignore",
														})
													}
												>
													Ignore
												</Button>
											</>
										) : (
											<span className="text-[var(--muted-foreground)] text-xs italic">
												Resolved
											</span>
										)}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{pending && dialogConfig && (
				<AlertDialog
					open={true}
					title={dialogConfig.title}
					description={dialogConfig.description}
					confirmLabel={
						resolveMutation.isPending
							? dialogConfig.pendingLabel
							: dialogConfig.confirmLabel
					}
					cancelLabel="Cancel"
					destructive={dialogConfig.destructive}
					confirmDisabled={resolveMutation.isPending}
					onConfirm={submit}
					onCancel={closeDialog}
				>
					<label className="block space-y-1">
						<span className="text-[var(--muted-foreground)] text-xs">
							Notes (optional) — stored on the orphan row for audit
						</span>
						<textarea
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={3}
							maxLength={2000}
							placeholder="e.g. Buyer emailed; manually matched to invoice INV-000042"
							disabled={resolveMutation.isPending}
							className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
						/>
					</label>
				</AlertDialog>
			)}
		</div>
	);
}

function getDialogConfig(action: ResolveAction): {
	title: string;
	description: string;
	confirmLabel: string;
	pendingLabel: string;
	destructive: boolean;
} {
	switch (action) {
		case "reconcile":
			return {
				title: "Reconcile orphan manually?",
				description:
					"Mark this orphan as fixed outside the app (e.g. you matched it to a member by hand, or refunded it manually in the Stripe dashboard).",
				confirmLabel: "Reconcile",
				pendingLabel: "Reconciling…",
				destructive: false,
			};
		case "refund_via_stripe":
			return {
				title: "Refund via Stripe?",
				description:
					"This will issue a real refund through Stripe — money goes back to the buyer's card. The orphan will be marked REFUNDED. This cannot be undone.",
				confirmLabel: "Refund via Stripe",
				pendingLabel: "Refunding…",
				destructive: true,
			};
		case "ignore":
			return {
				title: "Ignore orphan?",
				description:
					"Mark this orphan as deliberately ignored (e.g. duplicate, test webhook). It will stop appearing in the default Pending view.",
				confirmLabel: "Ignore",
				pendingLabel: "Ignoring…",
				destructive: false,
			};
	}
}

function StatusBadge({ status }: { status: OrphanedPurchaseStatus }) {
	const styles: Record<OrphanedPurchaseStatus, string> = {
		[OrphanedPurchaseStatus.PENDING]:
			"bg-amber-50 text-amber-700 ring-amber-200",
		[OrphanedPurchaseStatus.RECONCILED]:
			"bg-blue-50 text-blue-700 ring-blue-200",
		[OrphanedPurchaseStatus.REFUNDED]:
			"bg-green-50 text-green-700 ring-green-200",
		[OrphanedPurchaseStatus.IGNORED]: "bg-gray-50 text-gray-600 ring-gray-200",
	};
	return (
		<span
			className={`inline-flex rounded-full px-2 py-0.5 font-medium text-xs ring-1 ring-inset ${styles[status]}`}
		>
			{status.toLowerCase()}
		</span>
	);
}
