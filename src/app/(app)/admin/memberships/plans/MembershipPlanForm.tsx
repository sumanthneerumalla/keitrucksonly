"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatBilling } from "~/app/(app)/admin/memberships/plans/billingFormat";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { Select } from "~/app/_components/shared/ui/select";
import { isAnyAdmin } from "~/lib/utils";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Membership Plan create/edit form (Phase 10a — phase10-memberships.md "Admin
// Screens" → Membership Plan Create/Edit, Tab 1 "Plan Details").
//
// Mirrors PackagePlanForm: same page shell (h-[calc(100vh-5rem)] + max-w-2xl
// sectioned layout), edit-mode hydration from the list query, create/update
// mutations with toast + router.push back to the list, isAnyAdmin access gate
// (club/platform admins only), and dollars->cents conversion for the fee.
//
// Fields: membership type (dropdown), description, billing (every N
// day/week/month/year), bill N times per contract (blank = indefinite),
// fee billed each term (USD -> feePerTermInCents), and Active (edit only).
// First-term proration + billing anchor are CLUB-level (Membership Preferences),
// NOT per plan. The autoRenew toggle is shown DISABLED with a "coming soon"
// hint (schema shipped, inert in 10a — see Auto-Renew Toggle §).
// ---------------------------------------------------------------------------

type BillingUnit = "day" | "week" | "month" | "year";

interface MembershipPlanFormProps {
	mode: "create" | "edit";
	membershipPlanId?: string;
}

/**
 * Derive the coarse billingFrequency label from interval + unit so the stored
 * value stays consistent with the cadence the staff picked (the backend may
 * recompute this; we send a correct value regardless). "custom" covers
 * anything that isn't a plain 1-month / 3-month / 1-year cadence.
 */
function deriveBillingFrequency(interval: number, unit: BillingUnit): string {
	if (unit === "month" && interval === 1) return "monthly";
	if (unit === "month" && interval === 3) return "quarterly";
	if (unit === "year" && interval === 1) return "annually";
	return "custom";
}

export default function MembershipPlanForm({
	mode,
	membershipPlanId,
}: MembershipPlanFormProps) {
	const router = useRouter();
	const { toast } = useToast();

	const [membershipTypeId, setMembershipTypeId] = useState<string>("");
	const [description, setDescription] = useState("");
	const [billingInterval, setBillingInterval] = useState<number>(1);
	const [billingUnit, setBillingUnit] = useState<BillingUnit>("month");
	const [hasCycleLimit, setHasCycleLimit] = useState(false);
	const [billingCycles, setBillingCycles] = useState<number>(12);
	const [feePerTermInCents, setFeePerTermInCents] = useState<number>(0);
	const [isActive, setIsActive] = useState(true);
	const [saving, setSaving] = useState(false);

	// Queries
	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();
	// Active types only for the picker (archived types can't take new plans).
	const { data: typesData } = api.memberships.listTypes.useQuery({
		isActive: true,
	});

	// For edit mode, fetch the existing plan from the list (mirrors PackagePlanForm,
	// which reuses listPackagePlans rather than a dedicated get).
	const { data: editPlanData, isLoading: isEditLoading } =
		api.memberships.listPlans.useQuery(
			{},
			{ enabled: mode === "edit" && !!membershipPlanId },
		);

	// Populate form on edit mode
	useEffect(() => {
		if (mode !== "edit" || !editPlanData?.plans || !membershipPlanId) return;
		const plan = editPlanData.plans.find(
			(p) => p.membershipPlanId === membershipPlanId,
		);
		if (!plan) return;
		setMembershipTypeId(plan.membershipTypeId);
		setDescription(plan.description);
		setBillingInterval(plan.billingInterval);
		setBillingUnit(plan.billingUnit as BillingUnit);
		if (plan.billingCycles !== null) {
			setHasCycleLimit(true);
			setBillingCycles(plan.billingCycles);
		} else {
			setHasCycleLimit(false);
		}
		setFeePerTermInCents(plan.feePerTermInCents);
		setIsActive(plan.isActive);
	}, [editPlanData, mode, membershipPlanId]);

	const utils = api.useUtils();

	const createMutation = api.memberships.createPlan.useMutation({
		onSuccess: () => {
			void utils.memberships.listPlans.invalidate();
			toast("Membership plan created", "success");
			router.push("/admin/memberships/plans");
		},
		onError: (err) => toast(err.message, "error"),
		onSettled: () => setSaving(false),
	});

	const updateMutation = api.memberships.updatePlan.useMutation({
		onSuccess: () => {
			void utils.memberships.listPlans.invalidate();
			toast("Membership plan updated", "success");
			router.push("/admin/memberships/plans");
		},
		onError: (err) => toast(err.message, "error"),
		onSettled: () => setSaving(false),
	});

	const handleFeeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
			const dollars = Number.parseFloat(value || "0");
			setFeePerTermInCents(Math.round(dollars * 100));
		}
	};

	const feeInDollars = (feePerTermInCents / 100).toFixed(2);

	const types = useMemo(() => typesData?.types ?? [], [typesData]);

	const billingPreview = formatBilling({
		billingInterval,
		billingUnit,
		billingCycles: hasCycleLimit ? billingCycles : null,
	});

	const handleSubmit = () => {
		if (!membershipTypeId) {
			toast("Select a membership type", "error");
			return;
		}
		if (!description.trim()) {
			toast("Description is required", "error");
			return;
		}
		if (billingInterval < 1) {
			toast("Billing interval must be at least 1", "error");
			return;
		}
		if (hasCycleLimit && billingCycles < 1) {
			toast("Number of billing cycles must be at least 1", "error");
			return;
		}

		setSaving(true);

		const commonData = {
			membershipTypeId,
			description: description.trim(),
			billingFrequency: deriveBillingFrequency(billingInterval, billingUnit),
			billingInterval,
			billingUnit,
			billingCycles: hasCycleLimit ? billingCycles : null,
			feePerTermInCents,
		};

		if (mode === "create") {
			createMutation.mutate(commonData);
		} else if (membershipPlanId) {
			updateMutation.mutate({
				membershipPlanId,
				...commonData,
				isActive,
			});
		}
	};

	const canManagePlans = user ? isAnyAdmin(user) : false;

	if (isUserLoading || (mode === "edit" && isEditLoading)) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<p className="text-[var(--muted-foreground)] text-sm">Loading...</p>
			</div>
		);
	}

	if (!canManagePlans) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="text-center">
					<h2 className="font-semibold text-[var(--foreground)] text-xl">
						Access Denied
					</h2>
					<p className="mt-2 text-[var(--muted-foreground)] text-sm">
						Only club and platform admins can manage membership plans.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">
			{/* Header */}
			<div className="mb-6">
				<h1 className="font-bold text-2xl text-[var(--foreground)]">
					{mode === "create" ? "New Membership Plan" : "Edit Membership Plan"}
				</h1>
				<p className="mt-1 text-[var(--muted-foreground)] text-sm">
					Configure how this membership bills. Staff can sell it to members.
				</p>
			</div>

			<div className="max-w-2xl space-y-8">
				{/* Plan Details */}
				<section className="space-y-4">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Plan Details
					</h2>

					<div className="space-y-1">
						<label
							htmlFor="plan-type"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Membership Type <span className="text-red-500">*</span>
						</label>
						<Select
							id="plan-type"
							value={membershipTypeId}
							onChange={(e) => setMembershipTypeId(e.target.value)}
							disabled={saving}
							className="h-9"
						>
							<option value="">— Select a type —</option>
							{types.map((t) => (
								<option key={t.membershipTypeId} value={t.membershipTypeId}>
									{t.name}
								</option>
							))}
						</Select>
						{types.length === 0 && (
							<p className="text-[var(--muted-foreground)] text-xs">
								No active membership types. Create one under{" "}
								<a href="/admin/memberships/types" className="underline">
									Membership Types
								</a>
								.
							</p>
						)}
					</div>

					<div className="space-y-1">
						<label
							htmlFor="plan-description"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Description <span className="text-red-500">*</span>
						</label>
						<textarea
							id="plan-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
							placeholder='e.g., "$50/month, 12-month contract"'
							maxLength={500}
							disabled={saving}
							className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
						/>
					</div>

					{mode === "edit" && (
						<label className="flex cursor-pointer select-none items-center gap-2 text-[var(--muted-foreground)] text-sm">
							<input
								type="checkbox"
								checked={isActive}
								onChange={(e) => setIsActive(e.target.checked)}
								className="h-4 w-4 rounded border-input accent-[var(--primary)]"
							/>
							Active
						</label>
					)}
				</section>

				{/* Billing */}
				<section className="space-y-4">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Billing
					</h2>

					<div className="space-y-1">
						<label
							htmlFor="plan-billing-interval"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Bill every <span className="text-red-500">*</span>
						</label>
						<div className="flex gap-2">
							<Input
								id="plan-billing-interval"
								type="number"
								min={1}
								max={1000}
								value={billingInterval}
								onChange={(e) =>
									setBillingInterval(Number.parseInt(e.target.value, 10) || 0)
								}
								disabled={saving}
								className="w-24"
							/>
							<Select
								value={billingUnit}
								onChange={(e) => setBillingUnit(e.target.value as BillingUnit)}
								disabled={saving}
								className="h-9 w-32"
							>
								<option value="day">day(s)</option>
								<option value="week">week(s)</option>
								<option value="month">month(s)</option>
								<option value="year">year(s)</option>
							</Select>
						</div>
						<p className="text-[var(--muted-foreground)] text-xs">
							Period length. Each term runs from the member's signup date (e.g.
							Feb 15 &rarr; Mar 14). Billing anchor &amp; first-term proration
							are configured per club under Membership Preferences.
						</p>
					</div>

					<div className="space-y-2">
						<label
							htmlFor="plan-cycles-indefinite"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Contract length
						</label>
						<label className="flex cursor-pointer items-start gap-2 text-sm">
							<input
								id="plan-cycles-indefinite"
								type="radio"
								name="cycles"
								checked={!hasCycleLimit}
								onChange={() => setHasCycleLimit(false)}
								className="mt-0.5"
								disabled={saving}
							/>
							<span className="text-[var(--foreground)]">
								Indefinite (bill until cancelled)
							</span>
						</label>
						<label className="flex cursor-pointer items-start gap-2 text-sm">
							<input
								type="radio"
								name="cycles"
								checked={hasCycleLimit}
								onChange={() => setHasCycleLimit(true)}
								className="mt-0.5"
								disabled={saving}
							/>
							<span className="text-[var(--foreground)]">
								Bill a fixed number of times
							</span>
						</label>
						{hasCycleLimit && (
							<div className="flex items-center gap-2 pl-6">
								<Input
									type="number"
									min={1}
									max={1000}
									value={billingCycles}
									onChange={(e) =>
										setBillingCycles(Number.parseInt(e.target.value, 10) || 0)
									}
									disabled={saving}
									className="w-24"
								/>
								<span className="text-[var(--muted-foreground)] text-sm">
									times each contract
								</span>
							</div>
						)}
					</div>

					<div className="space-y-1">
						<label
							htmlFor="plan-fee"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Fee billed each term (USD) <span className="text-red-500">*</span>
						</label>
						<div className="relative">
							<span className="-translate-y-1/2 absolute top-1/2 left-3 text-[var(--muted-foreground)] text-sm">
								$
							</span>
							<Input
								id="plan-fee"
								type="text"
								value={feeInDollars}
								onChange={handleFeeChange}
								placeholder="0.00"
								disabled={saving}
								className="pl-7"
							/>
						</div>
						<p className="text-[var(--muted-foreground)] text-xs">
							Charged {billingPreview}.
						</p>
					</div>
				</section>

				{/* Auto-Renew — schema shipped, inert in 10a (Auto-Renew Toggle §). */}
				<section className="space-y-2 rounded-lg bg-[var(--muted)] p-4">
					<div className="flex items-center justify-between">
						<h2 className="font-semibold text-[var(--muted-foreground)] text-sm">
							Auto-Renew
						</h2>
						<span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[var(--muted-foreground)] text-xs">
							Coming soon
						</span>
					</div>
					<label className="flex cursor-not-allowed select-none items-center gap-2 text-[var(--muted-foreground)] text-sm">
						<input
							type="checkbox"
							checked={false}
							disabled
							aria-label="Auto-renew (coming soon)"
							className="h-4 w-4 rounded border-input accent-[var(--primary)]"
						/>
						Automatically renew memberships on this plan
					</label>
					<p className="text-[var(--muted-foreground)] text-xs">
						Coming soon — requires the recurring-charge generator (and Stripe
						for auto-charge). In the meantime, memberships are fixed-term: they
						expire at the term end and staff sell a new term to renew.
					</p>
				</section>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t pt-4">
					<Button
						variant="outline"
						onClick={() => router.push("/admin/memberships/plans")}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={saving}>
						{saving
							? "Saving..."
							: mode === "create"
								? "Create Plan"
								: "Save Changes"}
					</Button>
				</div>
			</div>
		</div>
	);
}
