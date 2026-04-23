"use client";

import { Archive, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { ToastContainer, useToast } from "~/app/_components/shared/Toast";
import { isAnyAdmin, isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";

export default function PackagePlansClient() {
	const { toasts, toast, dismiss } = useToast();
	const [showInactive, setShowInactive] = useState(false);
	const [archiveTarget, setArchiveTarget] = useState<{
		packagePlanId: string;
		name: string;
	} | null>(null);

	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();
	const { data: plansData, isLoading } =
		api.packages.listPackagePlans.useQuery({
			...(showInactive ? {} : { isActive: true }),
		});

	const utils = api.useUtils();

	const archiveMutation = api.packages.archivePackagePlan.useMutation({
		onSuccess: () => {
			void utils.packages.listPackagePlans.invalidate();
			toast("Package plan archived", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	const isFacilityOrAdmin = user ? isFacilityOrAbove(user) : false;
	// Package plan CRUD requires club admin; facility can view list + sell packages but not create/edit/archive
	const canManagePlans = user ? isAnyAdmin(user) : false;

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
						Only facility managers and admins can manage packages.
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

	const plans = plansData?.plans ?? [];

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

	const handleArchive = (packagePlanId: string, name: string) => {
		setArchiveTarget({ packagePlanId, name });
	};

	const confirmArchive = () => {
		if (archiveTarget) {
			archiveMutation.mutate({ packagePlanId: archiveTarget.packagePlanId });
			setArchiveTarget(null);
		}
	};

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">
			<ToastContainer toasts={toasts} onDismiss={dismiss} />

			{/* Header */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-bold text-2xl text-[var(--foreground)]">
						Package Plans
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Create and manage credit package plans that staff can sell to members
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
						<Link href="/admin/packages/new">
							<Button>
								<Plus size={16} />
								New Package Plan
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
							No package plans yet
						</p>
						{canManagePlans && (
							<Link href="/admin/packages/new">
								<Button className="mt-4">
									<Plus size={16} />
									Create Your First Package Plan
								</Button>
							</Link>
						)}
					</div>
				</div>
			) : (
			<>
				{/* Mobile: stacked cards */}
				<div className="space-y-3 md:hidden">
					{plans.map((plan) => {
						const eligibility = plan.isGeneralDropIn
							? "General open play"
							: (plan.product?.name ?? "—");
						return (
							<div
								key={plan.packagePlanId}
								className={`rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 ${!plan.isActive ? "opacity-60" : ""}`}
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="font-medium text-[var(--foreground)]">
											{plan.name}
										</div>
										{plan.description && (
											<div className="mt-0.5 line-clamp-2 text-[var(--muted-foreground)] text-xs">
												{plan.description}
											</div>
										)}
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
											Eligibility
										</dt>
										<dd className="text-[var(--foreground)]">{eligibility}</dd>
									</div>
									<div>
										<dt className="text-[var(--muted-foreground)] text-xs">
											Credits
										</dt>
										<dd className="text-[var(--foreground)]">
											{plan.sessionCount ?? "Unlimited"}
										</dd>
									</div>
									<div>
										<dt className="text-[var(--muted-foreground)] text-xs">
											Price
										</dt>
										<dd className="text-[var(--foreground)]">
											{formatPrice(plan.priceInCents)}
										</dd>
									</div>
									<div>
										<dt className="text-[var(--muted-foreground)] text-xs">
											Valid For
										</dt>
										<dd className="text-[var(--foreground)]">
											{formatValidity(plan.durationValue, plan.durationUnit)}
										</dd>
									</div>
									<div className="col-span-2">
										<dt className="text-[var(--muted-foreground)] text-xs">
											Active Sales
										</dt>
										<dd className="text-[var(--foreground)]">
											{plan._count.memberPackages} active
										</dd>
									</div>
								</dl>
								{canManagePlans && (
									<div className="mt-3 flex justify-end gap-2 border-[var(--border)] border-t pt-3">
										<Link href={`/admin/packages/${plan.packagePlanId}/edit`}>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit package plan"
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
													handleArchive(plan.packagePlanId, plan.name)
												}
												aria-label="Archive package plan"
												className="hover:bg-red-50 hover:text-red-600"
											>
												<Archive size={14} />
												Archive
											</Button>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>

				{/* Desktop: table */}
				<div className="hidden overflow-hidden rounded-lg border border-[var(--border)] md:block">
					<table className="w-full">
						<thead className="bg-[var(--muted)] text-left text-sm">
							<tr>
								<th className="px-4 py-3 font-medium">Name</th>
								<th className="px-4 py-3 font-medium">Eligibility</th>
								<th className="px-4 py-3 font-medium">Credits</th>
								<th className="px-4 py-3 font-medium">Price</th>
								<th className="px-4 py-3 font-medium">Valid For</th>
								<th className="px-4 py-3 font-medium">Active Sales</th>
								<th className="px-4 py-3 font-medium">Status</th>
								{canManagePlans && <th className="px-4 py-3 text-right font-medium">Actions</th>}
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--border)] bg-[var(--card)]">
							{plans.map((plan) => {
								const eligibility = plan.isGeneralDropIn
									? "General open play"
									: (plan.product?.name ?? "—");
								return (
									<tr
										key={plan.packagePlanId}
										className={`hover:bg-[var(--accent)] ${!plan.isActive ? "opacity-50" : ""}`}
									>
										<td className="px-4 py-3">
											<div className="font-medium text-[var(--foreground)]">
												{plan.name}
											</div>
											{plan.description && (
												<div className="mt-0.5 line-clamp-1 text-[var(--muted-foreground)] text-xs">
													{plan.description}
												</div>
											)}
										</td>
										<td className="px-4 py-3 text-[var(--foreground)] text-sm">
											{eligibility}
										</td>
										<td className="px-4 py-3 text-[var(--foreground)] text-sm">
											{plan.sessionCount ?? "Unlimited"}
										</td>
										<td className="px-4 py-3 text-[var(--foreground)] text-sm">
											{formatPrice(plan.priceInCents)}
										</td>
										<td className="px-4 py-3 text-[var(--foreground)] text-sm">
											{formatValidity(plan.durationValue, plan.durationUnit)}
										</td>
										<td className="px-4 py-3 text-[var(--muted-foreground)] text-sm">
											{plan._count.memberPackages} active
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
													<Link href={`/admin/packages/${plan.packagePlanId}/edit`}>
														<Button
															variant="ghost"
															size="icon"
															aria-label="Edit package plan"
														>
															<Pencil size={16} />
														</Button>
													</Link>
													{plan.isActive && (
														<Button
															variant="ghost"
															size="icon"
															onClick={() =>
																handleArchive(plan.packagePlanId, plan.name)
															}
															aria-label="Archive package plan"
															className="hover:bg-red-50 hover:text-red-600"
														>
															<Archive size={16} />
														</Button>
													)}
												</div>
											</td>
										)}
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</>
			)}

			<AlertDialog
				open={archiveTarget !== null}
				title={`Archive "${archiveTarget?.name}"?`}
				description="Existing sold packages are unaffected. You can reactivate the plan later."
				confirmLabel="Archive"
				destructive
				onConfirm={confirmArchive}
				onCancel={() => setArchiveTarget(null)}
			/>
		</div>
	);
}
