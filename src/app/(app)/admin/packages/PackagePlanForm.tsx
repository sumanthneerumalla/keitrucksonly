"use client";

import { ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { ToastContainer, useToast } from "~/app/_components/shared/Toast";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "~/app/_components/shared/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import { Select } from "~/app/_components/shared/ui/select";
import { isAnyAdmin } from "~/lib/utils";
import { api } from "~/trpc/react";

type DurationUnit = "days" | "weeks" | "months" | "years";
type EligibilityType = "event" | "general";

interface PackagePlanFormProps {
	mode: "create" | "edit";
	packagePlanId?: string;
}

export default function PackagePlanForm({
	mode,
	packagePlanId,
}: PackagePlanFormProps) {
	const router = useRouter();
	const { toasts, toast, dismiss } = useToast();

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [isActive, setIsActive] = useState(true);
	const [sessionCount, setSessionCount] = useState<number>(10);
	const [eligibilityType, setEligibilityType] =
		useState<EligibilityType>("event");
	const [productId, setProductId] = useState<string>("");
	const [productPickerOpen, setProductPickerOpen] = useState(false);
	const [priceInCents, setPriceInCents] = useState<number>(0);
	const [hasExpiry, setHasExpiry] = useState(true);
	const [durationValue, setDurationValue] = useState<number>(1);
	const [durationUnit, setDurationUnit] = useState<DurationUnit>("months");
	const [saving, setSaving] = useState(false);

	// Queries
	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();
	// Raised from 50 to 200 to avoid silently hiding products from clubs with large catalogs.
	// Long-term: replace with server-side typeahead search (same pattern as EventFormModal).
	const { data: productsData } = api.products.getProducts.useQuery({
		limit: 200,
	});

	// For edit mode, fetch the existing plan
	const { data: editPlanData, isLoading: isEditLoading } =
		api.packages.listPackagePlans.useQuery(
			{},
			{ enabled: mode === "edit" && !!packagePlanId },
		);

	// Populate form on edit mode
	useEffect(() => {
		if (mode !== "edit" || !editPlanData?.plans || !packagePlanId) return;
		const plan = editPlanData.plans.find(
			(p) => p.packagePlanId === packagePlanId,
		);
		if (!plan) return;
		setName(plan.name);
		setDescription(plan.description ?? "");
		setIsActive(plan.isActive);
		setSessionCount(plan.sessionCount ?? 10);
		setEligibilityType(plan.isGeneralDropIn ? "general" : "event");
		setProductId(plan.productId ?? "");
		setPriceInCents(plan.priceInCents);
		if (plan.durationValue !== null && plan.durationUnit !== null) {
			setHasExpiry(true);
			setDurationValue(plan.durationValue);
			setDurationUnit(plan.durationUnit as DurationUnit);
		} else {
			setHasExpiry(false);
		}
	}, [editPlanData, mode, packagePlanId]);

	const utils = api.useUtils();

	const createMutation = api.packages.createPackagePlan.useMutation({
		onSuccess: () => {
			void utils.packages.listPackagePlans.invalidate();
			toast("Package plan created", "success");
			router.push("/admin/packages");
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => setSaving(false),
	});

	const updateMutation = api.packages.updatePackagePlan.useMutation({
		onSuccess: () => {
			void utils.packages.listPackagePlans.invalidate();
			toast("Package plan updated", "success");
			router.push("/admin/packages");
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => setSaving(false),
	});

	const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
			const dollars = Number.parseFloat(value || "0");
			setPriceInCents(Math.round(dollars * 100));
		}
	};

	const priceInDollars = (priceInCents / 100).toFixed(2);

	const activeProducts = useMemo(
		() => productsData?.products.filter((p) => p.isActive) ?? [],
		[productsData],
	);

	// Auto-calculate price in create mode whenever product or session count changes.
	// Edit mode keeps the saved price so it's never clobbered.
	useEffect(() => {
		if (mode === "edit") return;
		if (!productId) return;
		const product = activeProducts.find((p) => p.productId === productId);
		if (!product) return;
		setPriceInCents(sessionCount * product.priceInCents);
	}, [mode, productId, sessionCount, activeProducts]);

	const selectedProductName = useMemo(() => {
		if (!productId) return "— Select a product —";
		const p = activeProducts.find((pp) => pp.productId === productId);
		return p?.name ?? "— Select a product —";
	}, [productId, activeProducts]);

	const handleSubmit = () => {
		if (!name.trim()) {
			toast("Name is required", "error");
			return;
		}
		if (eligibilityType === "event" && !productId) {
			toast("Select a product for event-specific packages", "error");
			return;
		}
		if (sessionCount < 1) {
			toast("Session count must be at least 1", "error");
			return;
		}
		if (hasExpiry && (durationValue < 1 || !durationUnit)) {
			toast("Enter a valid duration", "error");
			return;
		}

		setSaving(true);

		const commonData = {
			name: name.trim(),
			description: description.trim() || undefined,
			productId: eligibilityType === "event" ? productId : undefined,
			isGeneralDropIn: eligibilityType === "general",
			sessionCount,
			priceInCents,
			durationValue: hasExpiry ? durationValue : null,
			durationUnit: hasExpiry ? durationUnit : null,
			sortOrder: 0,
		};

		if (mode === "create") {
			createMutation.mutate(commonData);
		} else if (packagePlanId) {
			updateMutation.mutate({
				packagePlanId,
				...commonData,
				productId: eligibilityType === "event" ? productId : null,
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
				</div>
			</div>
		);
	}

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">
			<ToastContainer toasts={toasts} onDismiss={dismiss} />

			{/* Header */}
			<div className="mb-6">
				<h1 className="font-bold text-2xl text-[var(--foreground)]">
					{mode === "create" ? "New Package Plan" : "Edit Package Plan"}
				</h1>
				<p className="mt-1 text-[var(--muted-foreground)] text-sm">
					Create a package plan that staff can sell to members
				</p>
			</div>

			<div className="max-w-2xl space-y-8">
				{/* Basic Info */}
				<section className="space-y-4">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Basic Info
					</h2>
					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Name <span className="text-red-500">*</span>
						</label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g., 10-Session Drop-in Package"
							maxLength={200}
							disabled={saving}
						/>
					</div>

					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Description
						</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={3}
							placeholder="Optional description"
							maxLength={2000}
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

				{/* Credits */}
				<section className="space-y-4">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Credits
					</h2>
					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Number of credits <span className="text-red-500">*</span>
						</label>
						<Input
							type="number"
							min={1}
							max={10000}
							value={sessionCount}
							onChange={(e) =>
								setSessionCount(Number.parseInt(e.target.value, 10) || 0)
							}
							disabled={saving}
						/>
						<p className="text-[var(--muted-foreground)] text-xs">
							Each registration or check-in consumes 1 credit by default (or more
							if the event sets a higher credit cost). Unlimited packages will be
							added in Phase 8b.
						</p>
					</div>
				</section>

				{/* Eligibility */}
				<section className="space-y-4">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Eligibility
					</h2>
					<div className="space-y-2">
						<label className="flex cursor-pointer items-start gap-2 text-sm">
							<input
								type="radio"
								name="eligibility"
								checked={eligibilityType === "event"}
								onChange={() => setEligibilityType("event")}
								className="mt-0.5"
								disabled={saving}
							/>
							<div>
								<div className="font-medium text-[var(--foreground)]">
									Event-specific
								</div>
								<p className="text-[var(--muted-foreground)] text-xs">
									Covers calendar events linked to a specific product
								</p>
							</div>
						</label>
						<label className="flex cursor-pointer items-start gap-2 text-sm">
							<input
								type="radio"
								name="eligibility"
								checked={eligibilityType === "general"}
								onChange={() => setEligibilityType("general")}
								className="mt-0.5"
								disabled={saving}
							/>
							<div>
								<div className="font-medium text-[var(--foreground)]">
									General open play
								</div>
								<p className="text-[var(--muted-foreground)] text-xs">
									Deducts at any facility check-in — no event required
								</p>
							</div>
						</label>
					</div>

					{eligibilityType === "event" && (
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Linked Product <span className="text-red-500">*</span>
							</label>
							<Popover
								open={productPickerOpen}
								onOpenChange={setProductPickerOpen}
							>
								<PopoverTrigger asChild>
									<button
										type="button"
										className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
									>
										<span
											className={
												productId
													? "text-[var(--foreground)]"
													: "text-[var(--muted-foreground)]"
											}
										>
											{selectedProductName}
										</span>
										<ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
									</button>
								</PopoverTrigger>
								<PopoverContent
									className="w-[--radix-popover-trigger-width] p-0"
									align="start"
								>
									<Command>
										<CommandInput placeholder="Search products..." />
										<CommandList>
											<CommandEmpty>No products found.</CommandEmpty>
											<CommandGroup>
												{activeProducts.map((p) => (
													<CommandItem
														key={p.productId}
														value={p.name}
														onSelect={() => {
															setProductId(p.productId);
															if (mode === "create") {
																setPriceInCents(sessionCount * p.priceInCents);
															}
															setProductPickerOpen(false);
														}}
													>
														{p.name}
													</CommandItem>
												))}
											</CommandGroup>
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
							{activeProducts.length === 0 && (
								<p className="text-[var(--muted-foreground)] text-xs">
									No active products. Create one under{" "}
									<a href="/admin/products" className="underline">
										Products
									</a>
									.
								</p>
							)}
						</div>
					)}
				</section>

				{/* Pricing & Validity */}
				<section className="space-y-4">
					<h2 className="font-semibold text-[var(--foreground)] text-lg">
						Pricing & Validity
					</h2>

					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Price (USD) <span className="text-red-500">*</span>
						</label>
						<div className="relative">
							<span className="-translate-y-1/2 absolute top-1/2 left-3 text-[var(--muted-foreground)] text-sm">
								$
							</span>
							<Input
								type="text"
								value={priceInDollars}
								onChange={handlePriceChange}
								placeholder="0.00"
								disabled={saving}
								className="pl-7"
							/>
						</div>
					</div>

					<div className="space-y-2">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Validity
						</label>
						<label className="flex cursor-pointer items-start gap-2 text-sm">
							<input
								type="radio"
								name="validity"
								checked={hasExpiry}
								onChange={() => setHasExpiry(true)}
								className="mt-0.5"
								disabled={saving}
							/>
							<span className="text-[var(--foreground)]">Expires after</span>
						</label>
						{hasExpiry && (
							<div className="flex gap-2 pl-6">
								<Input
									type="number"
									min={1}
									max={1000}
									value={durationValue}
									onChange={(e) =>
										setDurationValue(Number.parseInt(e.target.value, 10) || 0)
									}
									disabled={saving}
									className="w-24"
								/>
								<Select
									value={durationUnit}
									onChange={(e) =>
										setDurationUnit(e.target.value as DurationUnit)
									}
									className="h-9 w-32"
								>
									<option value="days">days</option>
									<option value="weeks">weeks</option>
									<option value="months">months</option>
									<option value="years">years</option>
								</Select>
							</div>
						)}
						<label className="flex cursor-pointer items-start gap-2 text-sm">
							<input
								type="radio"
								name="validity"
								checked={!hasExpiry}
								onChange={() => setHasExpiry(false)}
								className="mt-0.5"
								disabled={saving}
							/>
							<span className="text-[var(--foreground)]">No expiry</span>
						</label>
					</div>
				</section>

				{/* Auto-Renew (deferred) */}
				<section className="space-y-2 rounded-lg bg-[var(--muted)] p-4">
					<h2 className="font-semibold text-[var(--muted-foreground)] text-sm">
						Auto-Renew
					</h2>
					<p className="text-[var(--muted-foreground)] text-xs">
						Deferred to Phase 8c — requires invoicing and Stripe integration.
					</p>
				</section>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t pt-4">
					<Button
						variant="outline"
						onClick={() => router.push("/admin/packages")}
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
