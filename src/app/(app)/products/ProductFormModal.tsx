"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { ProfileImageUploader } from "~/app/_components/shared/ProfileImageUploader";
import { useToast } from "~/app/_components/shared/Toast";
import { Select } from "~/app/_components/shared/ui/select";
import { api } from "~/trpc/react";

type Product = {
	productId: string;
	categoryId: string;
	name: string;
	description: string | null;
	priceInCents: number;
	currency: string;
};

interface ProductFormModalProps {
	product?: Product | null;
	onClose: () => void;
}

export default function ProductFormModal({
	product,
	onClose,
}: ProductFormModalProps) {
	const isEdit = product != null;
	const { toast } = useToast();

	const [categoryId, setCategoryId] = useState<string>(
		product?.categoryId ?? "",
	);
	const [name, setName] = useState(product?.name ?? "");
	const [description, setDescription] = useState(product?.description ?? "");
	const [sku, setSku] = useState("");
	const [priceInCents, setPriceInCents] = useState(product?.priceInCents ?? 0);
	const [saving, setSaving] = useState(false);

	// Public Shop fields (decisions #2 + #5). The current `getProducts` query
	// does not return these scalar columns or image bytes for v1, so editing
	// an existing product starts from defaults — saving will overwrite. (D2)
	const [isPubliclyListed, setIsPubliclyListed] = useState(false);
	const [publicDescription, setPublicDescription] = useState("");
	const [publicImageDataUrl, setPublicImageDataUrl] = useState<
		string | null | undefined
	>(undefined);

	const { data: categoriesData, isLoading: isCategoriesLoading } =
		api.categories.listCategories.useQuery();

	const utils = api.useUtils();

	const createMutation = api.products.createProduct.useMutation({
		onSuccess: () => {
			void utils.products.getProducts.invalidate();
			toast("Product created successfully", "success");
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => {
			setSaving(false);
		},
	});

	const updateMutation = api.products.updateProduct.useMutation({
		onSuccess: () => {
			void utils.products.getProducts.invalidate();
			toast("Product updated successfully", "success");
			onClose();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
		onSettled: () => {
			setSaving(false);
		},
	});

	const handleSave = () => {
		if (!name.trim()) {
			toast("Product name is required", "error");
			return;
		}
		if (!categoryId) {
			toast("Please select a category", "error");
			return;
		}

		setSaving(true);

		if (isEdit && product) {
			updateMutation.mutate({
				productId: product.productId,
				categoryId,
				name: name.trim(),
				description: description.trim() || null,
				priceInCents,
				isPubliclyListed,
				publicDescription: publicDescription.trim() || null,
				// undefined = don't touch existing image; null/string = set/clear
				...(publicImageDataUrl !== undefined ? { publicImageDataUrl } : {}),
			});
		} else {
			createMutation.mutate({
				categoryId,
				name: name.trim(),
				description: description.trim() || undefined,
				sku: sku.trim() || undefined,
				priceInCents,
				currency: "usd",
				isPubliclyListed,
				publicDescription: publicDescription.trim() || null,
				...(publicImageDataUrl !== undefined ? { publicImageDataUrl } : {}),
			});
		}
	};

	const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		// Allow empty string or valid decimal numbers
		if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
			const dollars = Number.parseFloat(value || "0");
			setPriceInCents(Math.round(dollars * 100));
		}
	};

	const priceInDollars = (priceInCents / 100).toFixed(2);

	// Build tree-aware category options
	const categories = categoriesData?.categories ?? [];
	const topLevel = categories.filter((c) => !c.parentCategoryId && c.isActive);
	const childrenOf = (parentId: string) =>
		categories.filter((c) => c.parentCategoryId === parentId && c.isActive);

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
				onClick={saving ? undefined : onClose}
			/>

			{/* Modal */}
			<div className="glass-panel fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-[var(--border)] border-l shadow-xl">
				{/* Header */}
				<div className="flex items-center justify-between border-[var(--border)] border-b px-6 py-4">
					<h2 className="font-semibold text-[var(--foreground)] text-base">
						{isEdit ? "Edit Product" : "New Product"}
					</h2>
					<button
						onClick={onClose}
						disabled={saving}
						className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
						aria-label="Close"
					>
						<X size={18} />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
					{/* Category */}
					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Category <span className="text-red-500">*</span>
						</label>
						{isCategoriesLoading ? (
							<div className="h-9 animate-pulse rounded-md bg-gray-200" />
						) : (
							<Select
								value={categoryId}
								onChange={(e) => setCategoryId(e.target.value)}
								className="h-9"
							>
								<option value="">Select a category...</option>
								{topLevel.map((parent) => {
									const children = childrenOf(parent.categoryId);
									if (children.length > 0) {
										return (
											<optgroup key={parent.categoryId} label={parent.name}>
												{children.map((child) => (
													<option
														key={child.categoryId}
														value={child.categoryId}
													>
														{child.name}
													</option>
												))}
											</optgroup>
										);
									}
									// Leaf top-level category (no children) — selectable
									return (
										<option key={parent.categoryId} value={parent.categoryId}>
											{parent.name}
										</option>
									);
								})}
							</Select>
						)}
						<p className="text-[var(--muted-foreground)] text-xs">
							Products must be assigned to a leaf category.
						</p>
					</div>

					{/* Name */}
					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Product Name <span className="text-red-500">*</span>
						</label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g., Drop-in Badminton, 1-on-1 Coaching Session"
							maxLength={200}
							disabled={saving}
						/>
					</div>

					{/* Description */}
					<div className="space-y-1">
						<label className="font-medium text-[var(--foreground)] text-sm">
							Description
						</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={3}
							placeholder="Optional description of what's included"
							maxLength={2000}
							disabled={saving}
							className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
						/>
					</div>

					{/* SKU */}
					{!isEdit && (
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								SKU
							</label>
							<Input
								value={sku}
								onChange={(e) => setSku(e.target.value)}
								placeholder="Optional product SKU"
								maxLength={100}
								disabled={saving}
							/>
							<p className="text-[var(--muted-foreground)] text-xs">
								Optional identifier for internal tracking (max 100 characters).
							</p>
						</div>
					)}

					{/* Price */}
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
						<p className="text-[var(--muted-foreground)] text-xs">
							Enter 0 for free events. Price is stored in cents ({priceInCents}
							¢).
						</p>
					</div>

					{/* Public Shop (decisions #2 + #5 + D2) */}
					<div className="space-y-3 rounded-md border border-[var(--border)] p-3">
						<h3 className="font-semibold text-[var(--foreground)] text-sm">
							Public Shop
						</h3>
						<label className="flex cursor-pointer select-none items-center gap-2 text-[var(--foreground)] text-sm">
							<input
								type="checkbox"
								checked={isPubliclyListed}
								onChange={(e) => setIsPubliclyListed(e.target.checked)}
								disabled={saving}
								className="h-4 w-4 rounded border-input accent-[var(--primary)]"
							/>
							List on public shop
						</label>
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Public description (shown to shoppers)
							</label>
							<textarea
								value={publicDescription}
								onChange={(e) => setPublicDescription(e.target.value)}
								rows={3}
								placeholder="Marketing copy for the public shop"
								maxLength={2000}
								disabled={saving}
								className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
							/>
						</div>
						<div className="space-y-1">
							<label className="font-medium text-[var(--foreground)] text-sm">
								Public image
							</label>
							<ProfileImageUploader
								initialImageUrl={null}
								onChange={(imageData) => setPublicImageDataUrl(imageData)}
							/>
							<p className="text-[var(--muted-foreground)] text-xs">
								Hero image used on the public shop detail page (PNG, ≤5MB).
							</p>
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-[var(--border)] border-t px-6 py-4">
					<Button
						variant="outline"
						size="sm"
						onClick={onClose}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						onClick={handleSave}
						disabled={!name.trim() || !categoryId || saving}
					>
						{saving ? "Saving..." : isEdit ? "Save Changes" : "Create Product"}
					</Button>
				</div>
			</div>
		</>
	);
}
