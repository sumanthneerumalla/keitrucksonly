"use client";

import { ChevronsUpDown, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
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
import { api } from "~/trpc/react";

/**
 * Phase 9a — Add a one-off / ad-hoc charge to a member's running tab. Mirrors
 * RecordPaymentModal's slide-out shell + form patterns (plain useState, useToast,
 * useUtils for cache invalidation). Two charge modes share one form:
 *
 *  - **Catalog item** — type-ahead pick from the product catalog (cmdk +
 *    Popover, same pattern as EventFormModal's product picker). Selecting fills
 *    the description and price; staff can still edit the price before saving.
 *  - **Custom charge** — pick "— Custom charge (no product) —" at the top of
 *    the list to bypass the catalog and type a free-text description + amount.
 *
 * The charge lands on the member's currently-open tab (or opens a fresh one)
 * via the server-side `billing.addAdHocCharge`. v1 charges the member being
 * viewed (self-pay); the backend supports an optional billTo for parent/payer
 * scenarios but the UI doesn't expose it yet to keep the modal simple.
 */

// First-page cap for the picker — most clubs have well under this. Above 200
// active products, the picker truncates and staff would need a search; we'd
// switch to server-side search via the `search` input on `getProducts` then.
const PICKER_PAGE_SIZE = 200;

function formatCents(cents: number): string {
	return (cents / 100).toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
	});
}

/**
 * Parse a dollar-string like "12.34" into integer cents without float math.
 * Mirrors RecordPaymentModal's helper (avoids IEEE 754 surprises). Returns null
 * for empty/invalid input. Accepts 0–2 digits of fractional part.
 */
function dollarStringToCents(input: string): number | null {
	const trimmed = input.trim();
	if (trimmed === "") return null;
	const match = trimmed.match(/^(\d+)(?:\.(\d{1,2}))?$/);
	if (!match) return null;
	const [, dollarsStr = "0", fractionalStr = ""] = match;
	const dollars = Number.parseInt(dollarsStr, 10);
	const cents = fractionalStr.padEnd(2, "0");
	return dollars * 100 + Number.parseInt(cents, 10);
}

interface AddChargeModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Consumer — the member whose tab the charge lands on. */
	userId: string;
}

export default function AddChargeModal({
	open,
	onOpenChange,
	userId,
}: AddChargeModalProps) {
	const { toast } = useToast();
	const utils = api.useUtils();

	// Form state
	const [productId, setProductId] = useState<string | null>(null);
	const [description, setDescription] = useState<string>("");
	const [quantity, setQuantity] = useState<string>("1");
	const [amountDollars, setAmountDollars] = useState<string>("");
	const [productPickerOpen, setProductPickerOpen] = useState<boolean>(false);

	// Reset on each open. Effect only reads `open` + calls stable setters, so
	// no biome suppression is needed (setState identities are stable in React).
	useEffect(() => {
		if (open) {
			setProductId(null);
			setDescription("");
			setQuantity("1");
			setAmountDollars("");
			setProductPickerOpen(false);
		}
	}, [open]);

	// Fetch the active product catalog only while the modal is open. Cap at
	// PICKER_PAGE_SIZE — typical clubs are well under. Sorted by createdAt desc
	// upstream; cmdk's CommandInput filters client-side by name as the user types.
	const productsQuery = api.products.getProducts.useQuery(
		{ limit: PICKER_PAGE_SIZE, page: 1, includeInactive: false },
		{ enabled: open },
	);

	const selectedProductLabel = useMemo(() => {
		if (!productId) return "— Custom charge (no product) —";
		const match = productsQuery.data?.products.find(
			(p) => p.productId === productId,
		);
		return match
			? `${match.name} (${formatCents(match.priceInCents)})`
			: "Loading product…";
	}, [productId, productsQuery.data]);

	const addChargeMutation = api.billing.addAdHocCharge.useMutation({
		onSuccess: async (data) => {
			toast(`Charge added to Invoice ${data.invoice.invoiceNumber}`, "success");
			// Mirror RecordPaymentModal: refresh BOTH the panel rollups AND any
			// open invoice-detail view for the affected invoice (otherwise that
			// view's `getInvoice` cache is stale until manual refetch).
			await Promise.all([
				utils.billing.getMemberBilling.invalidate({ userId }),
				utils.billing.getInvoice.invalidate({
					invoiceId: data.invoice.invoiceId,
				}),
			]);
			onOpenChange(false);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const saving = addChargeMutation.isPending;

	const parsedAmountCents = useMemo(
		() => dollarStringToCents(amountDollars),
		[amountDollars],
	);

	const parsedQuantity = useMemo(() => {
		const trimmed = quantity.trim();
		if (trimmed === "") return null;
		// Reject non-pure-integer input — `parseInt("1.5", 10)` returns 1, which
		// would silently lose the fractional part and surprise the user.
		if (!/^\d+$/.test(trimmed)) return null;
		const n = Number.parseInt(trimmed, 10);
		if (!Number.isFinite(n)) return null;
		return n;
	}, [quantity]);

	const handlePickProduct = (
		p: { productId: string; name: string; priceInCents: number } | null,
	) => {
		if (p === null) {
			// Custom charge — clear product, let staff type description + amount.
			setProductId(null);
			setDescription("");
			setAmountDollars("");
		} else {
			// Catalog item — fill description and price; staff can still edit either.
			setProductId(p.productId);
			setDescription(p.name);
			setAmountDollars((p.priceInCents / 100).toFixed(2));
		}
		setProductPickerOpen(false);
	};

	const handleSubmit = (e?: React.FormEvent) => {
		e?.preventDefault();

		const trimmedDescription = description.trim();
		if (trimmedDescription === "") {
			toast("Description is required", "error");
			return;
		}
		if (trimmedDescription.length > 500) {
			toast("Description must be 500 characters or fewer", "error");
			return;
		}

		if (
			parsedQuantity === null ||
			parsedQuantity < 1 ||
			parsedQuantity > 1000
		) {
			toast("Quantity must be a whole number between 1 and 1000", "error");
			return;
		}

		if (parsedAmountCents === null || parsedAmountCents <= 0) {
			toast("Amount must be greater than zero", "error");
			return;
		}
		// Per-unit cap (matches the backend Zod bound).
		if (parsedAmountCents > 100_000_000) {
			toast("Unit price cannot exceed $1,000,000", "error");
			return;
		}
		// Line total (price × qty) must fit the Int32 invoice columns and the
		// backend's matching guard.
		if (parsedAmountCents * parsedQuantity > 100_000_000) {
			toast("Line total cannot exceed $1,000,000", "error");
			return;
		}

		addChargeMutation.mutate({
			userId,
			productId,
			description: trimmedDescription,
			quantity: parsedQuantity,
			unitPriceInCents: parsedAmountCents,
		});
	};

	if (!open) return null;

	const close = () => {
		if (saving) return;
		onOpenChange(false);
	};

	const lineTotalCents =
		parsedAmountCents !== null && parsedQuantity !== null && parsedQuantity > 0
			? parsedAmountCents * parsedQuantity
			: null;

	return (
		<>
			{/* Backdrop — visual scrim; keyboard users close via the X button. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a visual scrim, focus stays in the modal — matches RecordPaymentModal */}
			<div
				className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
				onClick={saving ? undefined : () => onOpenChange(false)}
			/>

			{/* Modal */}
			<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
				{/* Header */}
				<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
					<h2 className="font-semibold text-[var(--foreground)] text-base">
						Add a charge
					</h2>
					<button
						onClick={close}
						disabled={saving}
						className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
						aria-label="Close"
						type="button"
					>
						<X size={18} />
					</button>
				</div>

				{/* Body */}
				<form
					onSubmit={handleSubmit}
					className="flex flex-1 flex-col overflow-hidden"
				>
					<div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
						{/* Product type-ahead picker */}
						<div className="space-y-1">
							<label
								htmlFor="add-charge-product"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Product
							</label>
							<Popover
								open={productPickerOpen}
								onOpenChange={setProductPickerOpen}
							>
								<PopoverTrigger asChild>
									<button
										id="add-charge-product"
										type="button"
										disabled={saving}
										className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
									>
										<span
											className={
												productId
													? "truncate text-[var(--foreground)]"
													: "truncate text-[var(--muted-foreground)]"
											}
										>
											{selectedProductLabel}
										</span>
										<ChevronsUpDown
											size={14}
											className="ml-2 shrink-0 opacity-50"
										/>
									</button>
								</PopoverTrigger>
								<PopoverContent
									className="w-[--radix-popover-trigger-width] p-0"
									align="start"
								>
									<Command>
										<CommandInput placeholder="Search products…" />
										<CommandList>
											<CommandEmpty>No products found.</CommandEmpty>
											{productsQuery.isError && (
												<div className="px-3 py-2 text-red-700 text-xs">
													Couldn't load products — try again.
												</div>
											)}
											<CommandGroup>
												<CommandItem
													value="custom charge"
													onSelect={() => handlePickProduct(null)}
												>
													— Custom charge (no product) —
												</CommandItem>
												{productsQuery.data?.products.map((p) => (
													<CommandItem
														key={p.productId}
														// Suffix productId so two products that share an exact
														// `name` (allowed by schema — `Product.name` isn't unique)
														// don't collapse into a single row in cmdk's value-keyed
														// filter. User-typed name prefixes still match.
														value={`${p.name} ${p.productId}`}
														onSelect={() =>
															handlePickProduct({
																productId: p.productId,
																name: p.name,
																priceInCents: p.priceInCents,
															})
														}
													>
														{p.name} ({formatCents(p.priceInCents)})
													</CommandItem>
												))}
											</CommandGroup>
											{productsQuery.data &&
												productsQuery.data.pagination.total >
													PICKER_PAGE_SIZE && (
													<div className="border-[var(--border)] border-t px-3 py-2 text-[var(--muted-foreground)] text-xs italic">
														Showing first {PICKER_PAGE_SIZE} of{" "}
														{productsQuery.data.pagination.total} — refine your
														search or pick "Custom charge".
													</div>
												)}
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
							<p className="text-[var(--muted-foreground)] text-xs">
								Pick an item to pre-fill description + price (still editable),
								or choose “Custom charge” to type your own.
							</p>
						</div>

						{/* Description */}
						<div className="space-y-1">
							<label
								htmlFor="add-charge-description"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Description <span className="text-red-500">*</span>
							</label>
							<input
								id="add-charge-description"
								type="text"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="e.g., Gatorade, Court rental fee"
								maxLength={500}
								disabled={saving}
								className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
							/>
						</div>

						{/* Quantity + Amount side by side */}
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1">
								<label
									htmlFor="add-charge-quantity"
									className="font-medium text-[var(--foreground)] text-sm"
								>
									Quantity <span className="text-red-500">*</span>
								</label>
								<input
									id="add-charge-quantity"
									type="number"
									step="1"
									min="1"
									max="1000"
									value={quantity}
									onChange={(e) => setQuantity(e.target.value)}
									disabled={saving}
									className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
								/>
							</div>
							<div className="space-y-1">
								<label
									htmlFor="add-charge-amount"
									className="font-medium text-[var(--foreground)] text-sm"
								>
									Unit price <span className="text-red-500">*</span>
								</label>
								<div className="relative">
									<span className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-[var(--muted-foreground)] text-sm">
										$
									</span>
									<input
										id="add-charge-amount"
										type="number"
										step="0.01"
										min="0"
										value={amountDollars}
										onChange={(e) => setAmountDollars(e.target.value)}
										disabled={saving}
										className="flex h-9 w-full rounded-md border border-input bg-transparent py-2 pr-3 pl-7 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
									/>
								</div>
							</div>
						</div>

						{/* Live line total */}
						<div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
							<div className="flex items-center justify-between">
								<span className="text-[var(--muted-foreground)]">
									Line total
								</span>
								<span className="font-mono font-semibold text-[var(--foreground)]">
									{lineTotalCents !== null ? formatCents(lineTotalCents) : "—"}
								</span>
							</div>
							<p className="mt-1 text-[var(--muted-foreground)] text-xs">
								Lands on the member’s open tab — a fresh one opens automatically
								if none is open.
							</p>
						</div>
					</div>

					{/* Footer */}
					<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t px-6 py-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={close}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={saving}>
							{saving ? "Adding…" : "Add charge"}
						</Button>
					</div>
				</form>
			</div>
		</>
	);
}
