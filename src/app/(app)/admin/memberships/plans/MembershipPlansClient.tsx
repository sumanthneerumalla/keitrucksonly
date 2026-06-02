"use client";

import { Archive, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatBilling } from "~/app/(app)/admin/memberships/plans/billingFormat";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import { isAnyAdmin, isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Membership Plans admin page (Phase 10a — phase10-memberships.md "Admin
// Screens" → Membership Plans Management). Table: Type, Description, Billing
// (e.g. "$50 every 1 month x 12"), Fee, Status — GROUPED BY membership type.
// Actions: Create, Edit, Archive.
//
// Mirrors PackagePlansClient: list query (active-by-default + "Show inactive"),
// AlertDialog archive-confirm (#51), isAnyAdmin gating so FACILITY can view +
// sell but only club/platform admins edit/archive (#50). Create/edit live on
// dedicated /new + /[id]/edit routes (same as packages), backed by the shared
// MembershipPlanForm.
// ---------------------------------------------------------------------------

export default function MembershipPlansClient() {
	const { toast } = useToast();
	const [showInactive, setShowInactive] = useState(false);
	const [archiveTarget, setArchiveTarget] = useState<{
		membershipPlanId: string;
		description: string;
	} | null>(null);

	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();
	const { data: plansData, isLoading } = api.memberships.listPlans.useQuery({
		...(showInactive ? {} : { isActive: true }),
	});

	const utils = api.useUtils();

	const archiveMutation = api.memberships.archivePlan.useMutation({
		onSuccess: () => {
			void utils.memberships.listPlans.invalidate();
			toast("Membership plan archived", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	// FACILITY can view + sell; only club/platform admins edit/archive (#50).
	const isFacilityOrAdmin = user ? isFacilityOrAbove(user) : false;
	const canManagePlans = user ? isAnyAdmin(user) : false;

	const plans = useMemo(() => plansData?.plans ?? [], [plansData]);

	// Group plans by membership type for display ("Grouped by membership type").
	const groups = useMemo(() => {
		const byType = new Map<string, { typeName: string; plans: typeof plans }>();
		for (const plan of plans) {
			const key = plan.membershipTypeId;
			const existing = byType.get(key);
			if (existing) {
				existing.plans.push(plan);
			} else {
				byType.set(key, {
					typeName: plan.membershipType?.name ?? "Unknown type",
					plans: [plan],
				});
			}
		}
		return Array.from(byType.values()).sort((a, b) =>
			a.typeName.localeCompare(b.typeName),
		);
	}, [plans]);

	const formatFee = (cents: number) =>
		new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
		}).format(cents / 100);

	const confirmArchive = () => {
		if (archiveTarget) {
			archiveMutation.mutate({
				membershipPlanId: archiveTarget.membershipPlanId,
			});
			setArchiveTarget(null);
		}
	};

	if (isUserLoading) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<p className="text-[var(--muted-foreground)] text-sm">Loading...</p>
			</div>
		);
	}

	if (!isFacilityOrAdmin) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="text-center">
					<h2 className="font-semibold text-[var(--foreground)] text-xl">
						Access Denied
					</h2>
					<p className="mt-2 text-[var(--muted-foreground)] text-sm">
						Only facility managers and admins can manage membership plans.
					</p>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="animate-pulse space-y-4">
					<div className="h-8 w-48 rounded bg-gray-200" />
					<div className="h-96 w-full rounded bg-gray-200" />
				</div>
			</div>
		);
	}

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">
			{/* Header */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-bold text-2xl text-[var(--foreground)]">
						Membership Plans
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Configure how memberships bill — frequency, fee, and contract
						length. Staff sell these to members.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<label className="flex cursor-pointer select-none items-center gap-2 text-[var(--muted-foreground)] text-sm">
						<input
							type="checkbox"
							checked={showInactive}
							onChange={(e) => setShowInactive(e.target.checked)}
							className="h-4 w-4 rounded border-input accent-[var(--primary)]"
						/>
						Show inactive
					</label>
					{canManagePlans && (
						<Link href="/admin/memberships/plans/new">
							<Button>
								<Plus size={16} />
								New Plan
							</Button>
						</Link>
					)}
				</div>
			</div>

			{/* Empty state */}
			{plans.length === 0 ? (
				<div className="flex h-64 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
					<div className="text-center">
						<p className="text-[var(--muted-foreground)] text-sm">
							No membership plans yet
						</p>
						{canManagePlans && (
							<Link href="/admin/memberships/plans/new">
								<Button className="mt-4">
									<Plus size={16} />
									Create Your First Plan
								</Button>
							</Link>
						)}
					</div>
				</div>
			) : (
				<div className="space-y-8">
					{groups.map((group) => (
						<section key={group.typeName} className="space-y-3">
							<h2 className="font-semibold text-[var(--foreground)] text-lg">
								{group.typeName}
							</h2>

							{/* Mobile: stacked cards */}
							<div className="space-y-3 md:hidden">
								{group.plans.map((plan) => (
									<div
										key={plan.membershipPlanId}
										className={`rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 ${!plan.isActive ? "opacity-60" : ""}`}
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0 flex-1">
												<div className="font-medium text-[var(--foreground)]">
													{plan.description}
												</div>
												<div className="mt-0.5 text-[var(--muted-foreground)] text-xs">
													{formatBilling(plan)}
												</div>
											</div>
											{plan.isActive ? (
												<span className="inline-flex shrink-0 items-center gap-1 text-green-600 text-xs">
													<span className="h-2 w-2 rounded-full bg-green-600" />
													Active
												</span>
											) : (
												<span className="inline-flex shrink-0 items-center gap-1 text-[var(--muted-foreground)] text-xs">
													<span className="h-2 w-2 rounded-full bg-gray-400" />
													Inactive
												</span>
											)}
										</div>
										<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
											<div>
												<dt className="text-[var(--muted-foreground)] text-xs">
													Fee / term
												</dt>
												<dd className="text-[var(--foreground)]">
													{formatFee(plan.feePerTermInCents)}
												</dd>
											</div>
											<div>
												<dt className="text-[var(--muted-foreground)] text-xs">
													Active Sales
												</dt>
												<dd className="text-[var(--foreground)]">
													{plan._count.memberMemberships} active
												</dd>
											</div>
										</dl>
										{canManagePlans && (
											<div className="mt-3 flex justify-end gap-2 border-[var(--border)] border-t pt-3">
												<Link
													href={`/admin/memberships/plans/${plan.membershipPlanId}/edit`}
												>
													<Button
														variant="ghost"
														size="sm"
														aria-label="Edit membership plan"
													>
														<Pencil size={14} />
														Edit
													</Button>
												</Link>
												{plan.isActive && (
													<Button
														variant="ghost"
														size="sm"
														onClick={() =>
															setArchiveTarget({
																membershipPlanId: plan.membershipPlanId,
																description: plan.description,
															})
														}
														aria-label="Archive membership plan"
														className="hover:bg-red-50 hover:text-red-600"
													>
														<Archive size={14} />
														Archive
													</Button>
												)}
											</div>
										)}
									</div>
								))}
							</div>

							{/* Desktop: table */}
							<div className="hidden overflow-hidden rounded-lg border border-[var(--border)] md:block">
								<table className="w-full">
									<thead className="bg-[var(--muted)] text-left text-sm">
										<tr>
											<th className="px-4 py-3 font-medium">Description</th>
											<th className="px-4 py-3 font-medium">Billing</th>
											<th className="px-4 py-3 font-medium">Fee</th>
											<th className="px-4 py-3 font-medium">Active Sales</th>
											<th className="px-4 py-3 font-medium">Status</th>
											{canManagePlans && (
												<th className="px-4 py-3 text-right font-medium">
													Actions
												</th>
											)}
										</tr>
									</thead>
									<tbody className="divide-y divide-[var(--border)] bg-[var(--card)]">
										{group.plans.map((plan) => (
											<tr
												key={plan.membershipPlanId}
												className={`hover:bg-[var(--accent)] ${!plan.isActive ? "opacity-50" : ""}`}
											>
												<td className="px-4 py-3">
													<div className="font-medium text-[var(--foreground)]">
														{plan.description}
													</div>
												</td>
												<td className="px-4 py-3 text-[var(--foreground)] text-sm">
													{formatBilling(plan)}
												</td>
												<td className="px-4 py-3 text-[var(--foreground)] text-sm">
													{formatFee(plan.feePerTermInCents)}
												</td>
												<td className="px-4 py-3 text-[var(--muted-foreground)] text-sm">
													{plan._count.memberMemberships} active
												</td>
												<td className="px-4 py-3">
													{plan.isActive ? (
														<span className="inline-flex items-center gap-1 text-green-600 text-xs">
															<span className="h-2 w-2 rounded-full bg-green-600" />
															Active
														</span>
													) : (
														<span className="inline-flex items-center gap-1 text-[var(--muted-foreground)] text-xs">
															<span className="h-2 w-2 rounded-full bg-gray-400" />
															Inactive
														</span>
													)}
												</td>
												{canManagePlans && (
													<td className="px-4 py-3">
														<div className="flex justify-end gap-2">
															<Link
																href={`/admin/memberships/plans/${plan.membershipPlanId}/edit`}
															>
																<Button
																	variant="ghost"
																	size="icon"
																	aria-label="Edit membership plan"
																>
																	<Pencil size={16} />
																</Button>
															</Link>
															{plan.isActive && (
																<Button
																	variant="ghost"
																	size="icon"
																	onClick={() =>
																		setArchiveTarget({
																			membershipPlanId: plan.membershipPlanId,
																			description: plan.description,
																		})
																	}
																	aria-label="Archive membership plan"
																	className="hover:bg-red-50 hover:text-red-600"
																>
																	<Archive size={16} />
																</Button>
															)}
														</div>
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</section>
					))}
				</div>
			)}

			<AlertDialog
				open={archiveTarget !== null}
				title={`Archive "${archiveTarget?.description}"?`}
				description="Existing sold memberships are unaffected. The plan is hidden from sell pickers. You can reactivate it later."
				confirmLabel="Archive"
				destructive
				onConfirm={confirmArchive}
				onCancel={() => setArchiveTarget(null)}
			/>
		</div>
	);
}
