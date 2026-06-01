"use client";

import { X } from "lucide-react";
import { useState } from "react";
import BillToUserPicker from "~/app/_components/shared/BillToUserPicker";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { Select } from "~/app/_components/shared/ui/select";
import { api } from "~/trpc/react";

interface SellPackageModalProps {
	userId: string;
	memberName: string;
	onClose: () => void;
}

/**
 * Phase 9a Round 5 — Bill-to typeahead (shared component).
 *
 * The "Bill to" field is OPTIONAL. When left blank the backend defaults to the
 * consumer (i.e. self-pay) and `billToUserId` is omitted from the mutation
 * payload. The search/debounce/dropdown behavior lives in the shared
 * BillToUserPicker; this modal only tracks the selected user and whether staff
 * typed without picking (which disables Submit — Fix D — so they can't silently
 * fall back to self-pay when they probably meant to bill someone else).
 */

type BillToUser = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
};

export default function SellPackageModal({
	userId,
	memberName,
	onClose,
}: SellPackageModalProps) {
	const { toast } = useToast();
	const [selectedPlanId, setSelectedPlanId] = useState<string>("");
	const [notes, setNotes] = useState("");
	const [saving, setSaving] = useState(false);
	const [billToUser, setBillToUser] = useState<BillToUser | null>(null);
	// True when staff typed a bill-to query but didn't pick anyone — blocks
	// Submit so they can't silently fall through to self-pay (Fix D).
	const [billToTypedButUnselected, setBillToTypedButUnselected] =
		useState<boolean>(false);

	const { data: plansData, isLoading } = api.packages.listPackagePlans.useQuery(
		{ isActive: true },
	);

	const utils = api.useUtils();

	const sellMutation = api.packages.sellPackage.useMutation({
		onSuccess: () => {
			void utils.packages.getMemberPackages.invalidate({ userId });
			toast("Package sold", "success");
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => setSaving(false),
	});

	const plans = plansData?.plans ?? [];
	const selectedPlan = plans.find((p) => p.packagePlanId === selectedPlanId);

	const formatPrice = (cents: number) =>
		new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
		}).format(cents / 100);

	const formatValidity = (
		durationValue: number | null,
		durationUnit: string | null,
	) => {
		if (durationValue === null || durationUnit === null) return "No expiry";
		return `${durationValue} ${durationUnit}`;
	};

	const handleSell = () => {
		if (!selectedPlanId) {
			toast("Select a package plan", "error");
			return;
		}
		setSaving(true);
		sellMutation.mutate({
			userId,
			packagePlanId: selectedPlanId,
			notes: notes.trim() || undefined,
			// Only include billToUserId when the user explicitly picked someone
			// other than the consumer. Backend defaults to the consumer when
			// the field is absent.
			...(billToUser ? { billToUserId: billToUser.userId } : {}),
		});
	};

	const handleClose = () => {
		if (saving) return;
		// Reset bill-to state on close so a reopened modal starts clean.
		setBillToUser(null);
		onClose();
	};

	return (
		<>
			{/* Backdrop */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a visual scrim */}
			<div
				className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
				onClick={saving ? undefined : handleClose}
			/>

			{/* Modal */}
			<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
				{/* Header */}
				<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
					<h2 className="font-semibold text-[var(--foreground)] text-base">
						Sell Package to {memberName}
					</h2>
					<button
						onClick={handleClose}
						disabled={saving}
						className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
						aria-label="Close"
						type="button"
					>
						<X size={18} />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
					{/* Plan picker */}
					<div className="space-y-1">
						<label
							htmlFor="sell-package-plan"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Package Plan <span className="text-red-500">*</span>
						</label>
						{isLoading ? (
							<p className="text-[var(--muted-foreground)] text-xs">
								Loading...
							</p>
						) : plans.length === 0 ? (
							<p className="text-[var(--muted-foreground)] text-xs">
								No active package plans. Create one under{" "}
								<a href="/admin/packages" className="underline">
									Packages
								</a>
								.
							</p>
						) : (
							<Select
								id="sell-package-plan"
								value={selectedPlanId}
								onChange={(e) => setSelectedPlanId(e.target.value)}
								className="h-9"
							>
								<option value="">— Select a plan —</option>
								{plans.map((plan) => (
									<option key={plan.packagePlanId} value={plan.packagePlanId}>
										{plan.name} — {formatPrice(plan.priceInCents)}
									</option>
								))}
							</Select>
						)}
					</div>

					{/* Plan summary */}
					{selectedPlan && (
						<div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-sm">
							<div className="grid grid-cols-2 gap-2">
								<div className="text-[var(--muted-foreground)]">
									Eligibility
								</div>
								<div className="text-[var(--foreground)]">
									{selectedPlan.isGeneralDropIn
										? "General open play"
										: (selectedPlan.product?.name ?? "—")}
								</div>
								<div className="text-[var(--muted-foreground)]">Credits</div>
								<div className="text-[var(--foreground)]">
									{selectedPlan.sessionCount ?? "Unlimited"}
								</div>
								<div className="text-[var(--muted-foreground)]">Price</div>
								<div className="text-[var(--foreground)]">
									{formatPrice(selectedPlan.priceInCents)}
								</div>
								<div className="text-[var(--muted-foreground)]">Valid for</div>
								<div className="text-[var(--foreground)]">
									{formatValidity(
										selectedPlan.durationValue,
										selectedPlan.durationUnit,
									)}
								</div>
							</div>
						</div>
					)}

					{/* Notes */}
					<div className="space-y-1">
						<label
							htmlFor="sell-package-notes"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Notes
						</label>
						<textarea
							id="sell-package-notes"
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={3}
							placeholder="Optional notes"
							maxLength={2000}
							disabled={saving}
							className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
						/>
					</div>

					{/* Bill to (optional) */}
					<BillToUserPicker
						consumerId={userId}
						value={billToUser}
						onChange={setBillToUser}
						disabled={saving}
						label="Bill to (optional)"
						helperText={`Leave blank to bill ${memberName} directly.`}
						onTypedButUnselectedChange={setBillToTypedButUnselected}
					/>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t px-6 py-4">
					<Button
						variant="outline"
						size="sm"
						onClick={handleClose}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						onClick={handleSell}
						disabled={!selectedPlanId || saving || billToTypedButUnselected}
					>
						{saving ? "Selling..." : "Sell Package"}
					</Button>
				</div>
			</div>
		</>
	);
}
