"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
 * Phase 9a Round 5 — Bill-to typeahead.
 *
 * The "Bill to" field is OPTIONAL. When left blank the backend defaults to the
 * consumer (i.e. self-pay) and `billToUserId` is omitted from the mutation
 * payload. Search reuses the existing `api.user.searchMembers` query (same
 * club-scoped name/email contains, same 10-row cap, same alphabetical order,
 * already used by the staff check-in flow). That endpoint accepts any
 * non-empty query, but we gate the firing here with a 4-char minimum so a
 * stray keystroke can't trigger a server request. The consumer is filtered
 * from results client-side (the backend treats consumer-as-bill-to as a
 * no-op but hiding it avoids confusion for staff).
 *
 * Round 5 review fixes folded in:
 *  - 200ms debounce on the query so a fast typer doesn't fire one request
 *    per keystroke (Fix B).
 *  - `maxLength=100` on the input matches the server-side Zod `max(100)`
 *    so the user can't type past the limit and hit an opaque error (Fix C).
 *  - Submit is disabled when the user has typed something but hasn't picked
 *    anyone — prevents silently falling back to self-pay when staff probably
 *    meant to bill someone else (Fix D).
 *  - Dropdown closes on outside click (Fix E), mirroring AdminCheckinClient.
 */

type BillToUser = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
};

function formatUserName(u: {
	firstName: string | null;
	lastName: string | null;
}): string {
	const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
	return name || "(no name)";
}

export default function SellPackageModal({
	userId,
	memberName,
	onClose,
}: SellPackageModalProps) {
	const { toast } = useToast();
	const [selectedPlanId, setSelectedPlanId] = useState<string>("");
	const [notes, setNotes] = useState("");
	const [saving, setSaving] = useState(false);
	const [billToQuery, setBillToQuery] = useState<string>("");
	const [debouncedBillToQuery, setDebouncedBillToQuery] = useState<string>("");
	const [billToUser, setBillToUser] = useState<BillToUser | null>(null);
	const [showDropdown, setShowDropdown] = useState<boolean>(true);
	const billToWrapperRef = useRef<HTMLDivElement>(null);

	// Round 5 review fix B — debounce 200ms before firing the server query.
	useEffect(() => {
		const t = setTimeout(() => setDebouncedBillToQuery(billToQuery), 200);
		return () => clearTimeout(t);
	}, [billToQuery]);

	// Round 5 review fix E — close the dropdown when the user clicks outside
	// the bill-to wrapper. Mirrors the pattern in AdminCheckinClient.tsx.
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (
				billToWrapperRef.current &&
				!billToWrapperRef.current.contains(e.target as Node)
			) {
				setShowDropdown(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const { data: plansData, isLoading } = api.packages.listPackagePlans.useQuery(
		{ isActive: true },
	);

	const trimmedBillToQuery = billToQuery.trim();
	const trimmedDebouncedQuery = debouncedBillToQuery.trim();
	// Gate the server query on the DEBOUNCED value so we don't fire on every
	// keystroke. The 4-char minimum + 200ms debounce together keep the request
	// count low even for fast typers.
	const billToSearchEnabled =
		billToUser === null && trimmedDebouncedQuery.length >= 4;

	const billToSearch = api.user.searchMembers.useQuery(
		{ query: trimmedDebouncedQuery },
		{ enabled: billToSearchEnabled },
	);

	const billToResults = (billToSearch.data?.members ?? []).filter(
		(r) => r.userId !== userId,
	);

	// True when the user has typed something but hasn't picked from the
	// dropdown. Used to disable Submit + show an inline warning (Fix D).
	const billToTypedButUnselected =
		trimmedBillToQuery.length > 0 && billToUser === null;

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
		setBillToQuery("");
		setBillToUser(null);
		onClose();
	};

	const selectBillToUser = (u: BillToUser) => {
		setBillToUser(u);
		setBillToQuery("");
	};

	const clearBillToUser = () => {
		setBillToUser(null);
		setBillToQuery("");
	};

	return (
		<>
			{/* Backdrop */}
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
						<label className="font-medium text-[var(--foreground)] text-sm">
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
						<label className="font-medium text-[var(--foreground)] text-sm">
							Notes
						</label>
						<textarea
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
					<div className="space-y-1">
						<label
							htmlFor="sell-package-bill-to"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Bill to{" "}
							<span className="font-normal text-[var(--muted-foreground)]">
								(optional)
							</span>
						</label>

						{billToUser ? (
							/* Selected chip */
							<div className="flex flex-wrap items-center gap-2">
								<span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--muted)] px-3 py-1 text-[var(--foreground)] text-sm">
									<span className="font-medium">
										{formatUserName(billToUser)}
									</span>
									{billToUser.email ? (
										<span className="text-[var(--muted-foreground)] text-xs">
											({billToUser.email})
										</span>
									) : null}
									<button
										type="button"
										onClick={clearBillToUser}
										disabled={saving}
										aria-label="Clear bill-to user"
										className="ml-1 rounded-full p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-50"
									>
										<X size={12} />
									</button>
								</span>
							</div>
						) : (
							/* Search input + result dropdown */
							<div ref={billToWrapperRef} className="relative">
								<input
									id="sell-package-bill-to"
									type="text"
									value={billToQuery}
									onChange={(e) => {
										setBillToQuery(e.target.value);
										// Re-open the dropdown on every keystroke so a previous
										// outside-click dismissal doesn't strand the user.
										setShowDropdown(true);
									}}
									onFocus={() => setShowDropdown(true)}
									placeholder="Search by name or email..."
									disabled={saving}
									autoComplete="off"
									maxLength={100}
									className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
								/>

								{trimmedBillToQuery.length > 0 && showDropdown && (
									<div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--card)] shadow-md">
										{trimmedBillToQuery.length < 4 ? (
											<p className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
												Type at least 4 characters to search.
											</p>
										) : billToSearch.isLoading ||
											trimmedBillToQuery !== trimmedDebouncedQuery ? (
											// "Searching..." covers both the debounce window
											// (user typed past 4 chars but the 200ms timer
											// hasn't fired yet) and the actual server fetch.
											<p className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
												Searching...
											</p>
										) : billToResults.length === 0 ? (
											<p className="px-3 py-2 text-[var(--muted-foreground)] text-xs">
												No matches found.
											</p>
										) : (
											<ul className="py-1">
												{billToResults.map((r) => (
													<li key={r.userId}>
														<button
															type="button"
															onClick={() => selectBillToUser(r)}
															className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]"
														>
															<span className="text-[var(--foreground)]">
																{formatUserName(r)}
															</span>
															{r.email ? (
																<span className="text-[var(--muted-foreground)] text-xs">
																	{r.email}
																</span>
															) : null}
														</button>
													</li>
												))}
											</ul>
										)}
									</div>
								)}
							</div>
						)}

						{billToTypedButUnselected ? (
							<p className="text-amber-600 text-xs dark:text-amber-400">
								Pick someone from the dropdown, or clear the search to bill{" "}
								{memberName} directly.
							</p>
						) : (
							<p className="text-[var(--muted-foreground)] text-xs">
								Leave blank to bill {memberName} directly.
							</p>
						)}
					</div>
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
