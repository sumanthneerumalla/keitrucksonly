"use client";

import { Pencil, Plus, Search, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import ProductFormModal from "~/app/(app)/products/ProductFormModal";
import { useUrlPagination } from "~/app/_components/hooks/use-url-pagination";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { PaginationControls } from "~/app/_components/shared/ui/pagination-controls";
import { Select } from "~/app/_components/shared/ui/select";
import { isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";

type Product = {
	productId: string;
	categoryId: string;
	categoryName: string;
	name: string;
	description: string | null;
	sku: string | null;
	priceInCents: number;
	currency: string;
	stripeProductId: string | null;
	stripePriceId: string | null;
	isActive: boolean;
	createdByUser: {
		firstName: string | null;
		lastName: string | null;
	};
	_count: {
		calendarEvents: number;
		registrations: number;
	};
	createdAt: Date;
};

export default function ProductsClient() {
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingProduct, setEditingProduct] = useState<Product | null>(null);
	const [showInactive, setShowInactive] = useState(false);
	const { toast } = useToast();

	// URL-driven pagination and search
	const {
		page,
		limit,
		search,
		searchInput,
		setSearchInput,
		setPage,
		setLimit,
		syncUrl,
	} = useUrlPagination({ defaultLimit: 20, validLimits: [10, 20, 50] });

	// Category filter from URL
	const searchParams = useSearchParams();
	const categoryFilter = searchParams.get("category") ?? "";

	const setCategoryFilter = useCallback(
		(value: string) => {
			syncUrl({ page: "1", category: value || undefined });
		},
		[syncUrl],
	);

	// Queries
	const { data: user, isLoading: isUserLoading } = api.user.getOrCreateProfile.useQuery();
	const { data: categoriesData } = api.categories.listCategories.useQuery();

	const queryInput = useMemo(
		() => ({
			page,
			limit,
			includeInactive: showInactive,
			...(categoryFilter && { categoryId: categoryFilter }),
			...(search && { search }),
		}),
		[page, limit, showInactive, categoryFilter, search],
	);

	const { data: productsData, isLoading } = api.products.getProducts.useQuery(queryInput, {
		staleTime: 30_000,
	});

	const utils = api.useUtils();

	// Prefetch next page
	useEffect(() => {
		if (productsData && productsData.pagination.page < productsData.pagination.pageCount) {
			void utils.products.getProducts.prefetch(
				{ ...queryInput, page: page + 1 },
				{ staleTime: 30_000 },
			);
		}
	}, [productsData, queryInput, page, utils]);

	// Reset page when showInactive toggles
	const handleToggleInactive = (checked: boolean) => {
		setShowInactive(checked);
		setPage(1);
	};

	const deleteProductMutation = api.products.deleteProduct.useMutation({
		onSuccess: () => {
			void utils.products.getProducts.invalidate();
			toast("Product deleted successfully", "success");
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const toggleActiveMutation = api.products.updateProduct.useMutation({
		onSuccess: (_, vars) => {
			void utils.products.getProducts.invalidate();
			toast(
				vars.isActive ? "Product activated" : "Product deactivated",
				"success",
			);
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const handleToggleActive = (product: Product) => {
		toggleActiveMutation.mutate({
			productId: product.productId,
			isActive: !product.isActive,
		});
	};

	const isFacilityOrAdmin = user ? isFacilityOrAbove(user) : false;

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
						Only facility managers and admins can manage products.
					</p>
				</div>
			</div>
		);
	}

	const handleEdit = (product: Product) => {
		setEditingProduct(product);
		setIsFormOpen(true);
	};

	const handleDelete = (product: Product) => {
		if (product._count.calendarEvents > 0) {
			toast(
				`Cannot delete product linked to ${product._count.calendarEvents} event(s)`,
				"error",
			);
			return;
		}
		if (product._count.registrations > 0) {
			toast(
				`Cannot delete product with ${product._count.registrations} registration(s)`,
				"error",
			);
			return;
		}
		if (window.confirm(`Delete "${product.name}"?`)) {
			deleteProductMutation.mutate({ productId: product.productId });
		}
	};

	const handleCloseForm = () => {
		setIsFormOpen(false);
		setEditingProduct(null);
	};

	const formatPrice = (cents: number, currency: string) => {
		const dollars = cents / 100;
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: currency.toUpperCase(),
		}).format(dollars);
	};

	// Build category filter options: group by parent
	const categories = categoriesData?.categories ?? [];
	const topLevel = categories.filter((c) => !c.parentCategoryId && c.isActive);
	const childrenOf = (parentId: string) =>
		categories.filter((c) => c.parentCategoryId === parentId && c.isActive);

	const products = productsData?.products ?? [];
	const pagination = productsData?.pagination;

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">

			{/* Header */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-bold text-2xl text-[var(--foreground)]">
						Products
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Manage products for bookable events, coaching sessions, and credit
						packs
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<label className="flex cursor-pointer select-none items-center gap-2 text-[var(--muted-foreground)] text-sm">
						<input
							type="checkbox"
							checked={showInactive}
							onChange={(e) => handleToggleInactive(e.target.checked)}
							className="h-4 w-4 rounded border-input accent-[var(--primary)]"
						/>
						Show inactive
					</label>
					<Button onClick={() => setIsFormOpen(true)}>
						<Plus size={16} />
						New Product
					</Button>
				</div>
			</div>

			{/* Filters */}
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
				<div className="relative flex-1 sm:max-w-xs">
					<Search
						size={16}
						className="-translate-y-1/2 absolute top-1/2 left-3 text-[var(--muted-foreground)]"
					/>
					<Input
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						placeholder="Search by name or SKU..."
						className="pl-9"
					/>
				</div>
				<Select
					value={categoryFilter}
					onChange={(e) => setCategoryFilter(e.target.value)}
					className="h-9 sm:max-w-xs"
				>
					<option value="">All Categories</option>
					{topLevel.map((parent) => {
						const children = childrenOf(parent.categoryId);
						if (children.length > 0) {
							return (
								<optgroup key={parent.categoryId} label={parent.name}>
									{children.map((child) => (
										<option key={child.categoryId} value={child.categoryId}>
											{child.name}
										</option>
									))}
								</optgroup>
							);
						}
						return (
							<option key={parent.categoryId} value={parent.categoryId}>
								{parent.name}
							</option>
						);
					})}
				</Select>
			</div>

			{/* Loading */}
			{isLoading ? (
				<div className="flex h-64 items-center justify-center">
					<div className="animate-pulse space-y-4">
						<div className="h-8 w-48 rounded bg-gray-200" />
						<div className="h-96 w-full rounded bg-gray-200" />
					</div>
				</div>
			) : products.length === 0 ? (
				<div className="flex h-64 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
					<div className="text-center">
						<p className="text-[var(--muted-foreground)] text-sm">
							No products yet
						</p>
						<Button className="mt-4" onClick={() => setIsFormOpen(true)}>
							<Plus size={16} />
							Create Your First Product
						</Button>
					</div>
				</div>
			) : (
				<>
					{/* Mobile cards */}
					<div className="space-y-3 md:hidden">
						{products.map((product) => (
							<div
								key={product.productId}
								className={`rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 ${!product.isActive ? "opacity-50" : ""}`}
							>
								<div className="mb-2 flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="font-medium text-[var(--foreground)]">
											{product.name}
										</p>
										{product.description && (
											<p className="mt-0.5 line-clamp-1 text-[var(--muted-foreground)] text-xs">
												{product.description}
											</p>
										)}
									</div>
									<div className="flex shrink-0 gap-1">
										<Button
											variant="ghost"
											size="icon"
											onClick={() => handleToggleActive(product)}
											disabled={toggleActiveMutation.isPending}
											aria-label={
												product.isActive
													? "Deactivate product"
													: "Activate product"
											}
											title={product.isActive ? "Deactivate" : "Activate"}
										>
											{product.isActive ? (
												<ToggleRight size={16} className="text-green-600" />
											) : (
												<ToggleLeft size={16} />
											)}
										</Button>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => handleEdit(product)}
											aria-label="Edit product"
										>
											<Pencil size={16} />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => handleDelete(product)}
											aria-label="Delete product"
											className="hover:bg-red-50 hover:text-red-600"
										>
											<Trash2 size={16} />
										</Button>
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2 text-xs">
									<span className="inline-flex rounded-full bg-[var(--accent)] px-2 py-1 font-medium text-[var(--foreground)]">
										{product.categoryName}
									</span>
									{product.sku && (
										<span className="text-[var(--muted-foreground)]">
											SKU: {product.sku}
										</span>
									)}
									<span className="text-[var(--foreground)]">
										{formatPrice(product.priceInCents, product.currency)}
									</span>
									<span className="text-[var(--muted-foreground)]">
										{product._count.calendarEvents} events ·{" "}
										{product._count.registrations} registrations
									</span>
									{product.isActive ? (
										<span className="inline-flex items-center gap-1 text-green-600">
											<span className="h-2 w-2 rounded-full bg-green-600" />
											Active
										</span>
									) : (
										<span className="inline-flex items-center gap-1 text-[var(--muted-foreground)]">
											<span className="h-2 w-2 rounded-full bg-gray-400" />
											Inactive
										</span>
									)}
								</div>
							</div>
						))}
					</div>

					{/* Desktop table */}
					<div className="hidden overflow-hidden rounded-lg border border-[var(--border)] md:block">
						<table className="w-full">
							<thead className="bg-[var(--muted)] text-left text-sm">
								<tr>
									<th className="px-4 py-3 font-medium">Name</th>
									<th className="px-4 py-3 font-medium">Category</th>
									<th className="px-4 py-3 font-medium">Price</th>
									<th className="px-4 py-3 font-medium">Usage</th>
									<th className="px-4 py-3 font-medium">Status</th>
									<th className="px-4 py-3 text-right font-medium">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--border)] bg-[var(--card)]">
								{products.map((product) => (
									<tr
										key={product.productId}
										className={`hover:bg-[var(--accent)] ${!product.isActive ? "opacity-50" : ""}`}
									>
										<td className="px-4 py-3">
											<div>
												<div className="font-medium text-[var(--foreground)]">
													{product.name}
												</div>
												{product.description && (
													<div className="mt-0.5 line-clamp-1 text-[var(--muted-foreground)] text-xs">
														{product.description}
													</div>
												)}
												{product.sku && (
													<div className="mt-0.5 text-[var(--muted-foreground)] text-xs">
														SKU: {product.sku}
													</div>
												)}
											</div>
										</td>
										<td className="px-4 py-3">
											<span className="inline-flex rounded-full bg-[var(--accent)] px-2 py-1 font-medium text-[var(--foreground)] text-xs">
												{product.categoryName}
											</span>
										</td>
										<td className="px-4 py-3 text-[var(--foreground)] text-sm">
											{formatPrice(product.priceInCents, product.currency)}
										</td>
										<td className="px-4 py-3 text-[var(--muted-foreground)] text-sm">
											{product._count.calendarEvents} events,{" "}
											{product._count.registrations} registrations
										</td>
										<td className="px-4 py-3">
											{product.isActive ? (
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
										<td className="px-4 py-3">
											<div className="flex justify-end gap-2">
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleToggleActive(product)}
													disabled={toggleActiveMutation.isPending}
													aria-label={
														product.isActive
															? "Deactivate product"
															: "Activate product"
													}
													title={product.isActive ? "Deactivate" : "Activate"}
												>
													{product.isActive ? (
														<ToggleRight size={16} className="text-green-600" />
													) : (
														<ToggleLeft size={16} />
													)}
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleEdit(product)}
													aria-label="Edit product"
												>
													<Pencil size={16} />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleDelete(product)}
													aria-label="Delete product"
													className="hover:bg-red-50 hover:text-red-600"
												>
													<Trash2 size={16} />
												</Button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Pagination */}
					{pagination && (
						<PaginationControls
							page={pagination.page}
							pageCount={pagination.pageCount}
							total={pagination.total}
							limit={pagination.limit}
							onPageChange={setPage}
						/>
					)}
				</>
			)}

			{/* Product Form Modal */}
			{isFormOpen && (
				<ProductFormModal product={editingProduct} onClose={handleCloseForm} />
			)}
		</div>
	);
}
