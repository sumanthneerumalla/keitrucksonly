"use client";

import { Package, Plus } from "lucide-react";
import { useState } from "react";
import SellPackageModal from "~/app/(app)/admin/checkin/SellPackageModal";
import { Button } from "~/app/_components/shared/Button";
import { api } from "~/trpc/react";

interface MemberPackagesCardProps {
	userId: string;
	memberName: string;
}

function formatDate(date: Date | string | null) {
	if (!date) return "No expiry";
	return new Date(date).toLocaleDateString([], {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/**
 * Family-share label (public-shop.md #15 + D7). Renders only when the row
 * isn't the current user's own pack — i.e. when the credits are flowing from
 * a parent/sibling's package via `consumeCredit` widening. Matches the small
 * pill pattern used by client tags in `ClientsList.tsx` (rounded-full + xs).
 */
function OwnerBadge({
	ownedBy,
}: {
	ownedBy: {
		firstName: string | null;
		lastName: string | null;
		isCurrentUser: boolean;
	};
}) {
	if (ownedBy.isCurrentUser) return null;
	const name =
		[ownedBy.firstName, ownedBy.lastName].filter(Boolean).join(" ").trim() ||
		"family member";
	return (
		<span className="inline-flex items-center whitespace-nowrap rounded-full bg-[var(--muted)] px-2 py-0.5 font-medium text-[var(--muted-foreground)] text-xs">
			Owned by {name}
		</span>
	);
}

export default function MemberPackagesCard({
	userId,
	memberName,
}: MemberPackagesCardProps) {
	const [sellOpen, setSellOpen] = useState(false);

	const { data, isLoading } = api.packages.getMemberPackages.useQuery(
		{ userId },
		{ enabled: !!userId },
	);

	const packages = data?.packages ?? [];
	const activePackages = packages.filter((p) => p.status === "active");
	const inactivePackages = packages.filter((p) => p.status !== "active");

	return (
		<>
			<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
				<div className="mb-3 flex items-center justify-between">
					<h4 className="flex items-center gap-2 font-semibold text-[var(--foreground)] text-sm">
						<Package size={14} />
						Packages
					</h4>
					<Button variant="outline" size="sm" onClick={() => setSellOpen(true)}>
						<Plus size={14} />
						Sell Package
					</Button>
				</div>

				{isLoading ? (
					<p className="text-[var(--muted-foreground)] text-xs">Loading...</p>
				) : activePackages.length === 0 && inactivePackages.length === 0 ? (
					<p className="text-[var(--muted-foreground)] text-xs">No packages</p>
				) : (
					<div className="space-y-2">
						{activePackages.map((p) => {
							const pct =
								p.creditsTotal !== null && p.creditsTotal > 0
									? Math.min(100, (p.creditsUsed / p.creditsTotal) * 100)
									: 0;
							return (
								<div
									key={p.memberPackageId}
									className="rounded border border-[var(--border)] p-2"
								>
									<div className="flex items-center justify-between gap-2">
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-1.5">
												<p className="truncate font-medium text-[var(--foreground)] text-sm">
													{p.planName}
												</p>
												<OwnerBadge ownedBy={p.ownedBy} />
											</div>
											<p className="text-[var(--muted-foreground)] text-xs">
												{p.isGeneralDropIn
													? "General open play"
													: (p.productName ?? "—")}
											</p>
										</div>
										<span className="inline-flex items-center gap-1 whitespace-nowrap text-green-600 text-xs">
											<span className="h-2 w-2 rounded-full bg-green-600" />
											Active
										</span>
									</div>
									<div className="mt-2">
										<div className="flex justify-between text-[var(--muted-foreground)] text-xs">
											<span>
												{p.creditsRemaining ?? "∞"} of {p.creditsTotal ?? "∞"}{" "}
												credits
											</span>
											<span>Exp: {formatDate(p.endDate)}</span>
										</div>
										{p.creditsTotal !== null && (
											<div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
												<div
													className="h-full bg-[var(--primary)]"
													style={{ width: `${pct}%` }}
												/>
											</div>
										)}
									</div>
								</div>
							);
						})}

						{inactivePackages.length > 0 && (
							<details className="mt-2">
								<summary className="cursor-pointer text-[var(--muted-foreground)] text-xs">
									{inactivePackages.length} depleted/expired
								</summary>
								<div className="mt-2 space-y-1">
									{inactivePackages.map((p) => (
										<div
											key={p.memberPackageId}
											className="flex items-center justify-between gap-2 rounded border border-[var(--border)] p-2 opacity-60"
										>
											<div className="min-w-0">
												<div className="flex flex-wrap items-center gap-1.5">
													<p className="truncate font-medium text-[var(--foreground)] text-xs">
														{p.planName}
													</p>
													<OwnerBadge ownedBy={p.ownedBy} />
												</div>
												<p className="text-[var(--muted-foreground)] text-xs">
													{p.status}
												</p>
											</div>
										</div>
									))}
								</div>
							</details>
						)}
					</div>
				)}
			</div>

			{sellOpen && (
				<SellPackageModal
					userId={userId}
					memberName={memberName}
					onClose={() => setSellOpen(false)}
				/>
			)}
		</>
	);
}
