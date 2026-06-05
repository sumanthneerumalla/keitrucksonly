"use client";

import { Archive, ChevronDown, ChevronRight, Pencil, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Category = {
	categoryId: string;
	clubShortName: string;
	name: string;
	parentCategoryId: string | null;
	sortOrder: number;
	isActive: boolean;
	_count: { products: number; children: number };
};

interface CategoryRowProps {
	category: Category;
	depth: number;
	childrenOf: (parentId: string) => Category[];
	expandedIds: Set<string>;
	toggleExpand: (id: string) => void;
	editingId: string | null;
	editName: string;
	setEditName: (name: string) => void;
	handleSaveEdit: (categoryId: string) => void;
	setEditingId: (id: string | null) => void;
	startEdit: (category: Category) => void;
	updateIsPending: boolean;
	addingSubTo: string | null;
	subName: string;
	setSubName: (name: string) => void;
	handleCreateSub: (parentId: string) => void;
	setAddingSubTo: (id: string | null) => void;
	createIsPending: boolean;
	handleArchive: (category: Category) => void;
}

// ---------------------------------------------------------------------------
// CategoryRow — extracted as a stable top-level component so React doesn't
// remount it on every parent re-render (which would reset input cursor).
// ---------------------------------------------------------------------------

function CategoryRow({
	category,
	depth,
	childrenOf,
	expandedIds,
	toggleExpand,
	editingId,
	editName,
	setEditName,
	handleSaveEdit,
	setEditingId,
	startEdit,
	updateIsPending,
	addingSubTo,
	subName,
	setSubName,
	handleCreateSub,
	setAddingSubTo,
	createIsPending,
	handleArchive,
}: CategoryRowProps) {
	const children = childrenOf(category.categoryId);
	const hasChildren = children.length > 0;
	const isExpanded = expandedIds.has(category.categoryId);
	const isEditing = editingId === category.categoryId;
	const isTopLevel = depth === 0;

	return (
		<>
			<div
				className={`flex items-center gap-2 border-[var(--border)] border-b px-4 py-3 hover:bg-[var(--accent)] ${!category.isActive ? "opacity-50" : ""}`}
				style={{ paddingLeft: `${depth * 24 + 16}px` }}
			>
				{/* Expand/collapse toggle */}
				<button
					type="button"
					className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--muted-foreground)]"
					onClick={() => hasChildren && toggleExpand(category.categoryId)}
					disabled={!hasChildren}
				>
					{hasChildren ? (
						isExpanded ? (
							<ChevronDown size={14} />
						) : (
							<ChevronRight size={14} />
						)
					) : (
						<span className="h-1 w-1 rounded-full bg-[var(--muted-foreground)]" />
					)}
				</button>

				{/* Name or inline edit */}
				<div className="min-w-0 flex-1">
					{isEditing ? (
						<div className="flex items-center gap-2">
							<Input
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSaveEdit(category.categoryId);
									if (e.key === "Escape") setEditingId(null);
								}}
								className="h-8 text-sm"
								autoFocus
							/>
							<Button
								size="sm"
								onClick={() => handleSaveEdit(category.categoryId)}
								disabled={!editName.trim() || updateIsPending}
							>
								Save
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => setEditingId(null)}
							>
								Cancel
							</Button>
						</div>
					) : (
						<span className="font-medium text-[var(--foreground)] text-sm">
							{category.name}
						</span>
					)}
				</div>

				{/* Meta badges */}
				{!isEditing && (
					<>
						<span className="text-[var(--muted-foreground)] text-xs">
							{category._count.products} product
							{category._count.products !== 1 ? "s" : ""}
						</span>

						{category.isActive ? (
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

						{/* Actions */}
						<div className="flex gap-1">
							{isTopLevel && (
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										setAddingSubTo(
											addingSubTo === category.categoryId
												? null
												: category.categoryId,
										);
										setSubName("");
										if (!isExpanded) toggleExpand(category.categoryId);
									}}
									aria-label="Add subcategory"
									title="Add subcategory"
								>
									<Plus size={14} />
								</Button>
							)}
							<Button
								variant="ghost"
								size="icon"
								onClick={() => startEdit(category)}
								aria-label="Edit category"
								title="Edit"
							>
								<Pencil size={14} />
							</Button>
							{category.isActive && (
								<Button
									variant="ghost"
									size="icon"
									onClick={() => handleArchive(category)}
									aria-label="Archive category"
									title="Archive"
									className="hover:bg-red-50 hover:text-red-600"
								>
									<Archive size={14} />
								</Button>
							)}
						</div>
					</>
				)}
			</div>

			{/* Inline add-subcategory form */}
			{addingSubTo === category.categoryId && (
				<div
					className="flex items-center gap-2 border-[var(--border)] border-b bg-[var(--accent)] px-4 py-2"
					style={{ paddingLeft: `${(depth + 1) * 24 + 16}px` }}
				>
					<Input
						value={subName}
						onChange={(e) => setSubName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleCreateSub(category.categoryId);
							if (e.key === "Escape") setAddingSubTo(null);
						}}
						placeholder="Subcategory name"
						className="h-8 text-sm"
						autoFocus
					/>
					<Button
						size="sm"
						onClick={() => handleCreateSub(category.categoryId)}
						disabled={!subName.trim() || createIsPending}
					>
						{createIsPending ? "Adding..." : "Add"}
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => setAddingSubTo(null)}
					>
						Cancel
					</Button>
				</div>
			)}

			{/* Children */}
			{isExpanded &&
				children.map((child) => (
					<CategoryRow
						key={child.categoryId}
						category={child}
						depth={depth + 1}
						childrenOf={childrenOf}
						expandedIds={expandedIds}
						toggleExpand={toggleExpand}
						editingId={editingId}
						editName={editName}
						setEditName={setEditName}
						handleSaveEdit={handleSaveEdit}
						setEditingId={setEditingId}
						startEdit={startEdit}
						updateIsPending={updateIsPending}
						addingSubTo={addingSubTo}
						subName={subName}
						setSubName={setSubName}
						handleCreateSub={handleCreateSub}
						setAddingSubTo={setAddingSubTo}
						createIsPending={createIsPending}
						handleArchive={handleArchive}
					/>
				))}
		</>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CategoriesClient() {
	const { toast } = useToast();
	const [showInactive, setShowInactive] = useState(false);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

	// New category form
	const [showNewForm, setShowNewForm] = useState(false);
	const [newName, setNewName] = useState("");
	const [newParentId, setNewParentId] = useState<string>("");

	// Edit state
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");

	// Subcategory creation
	const [addingSubTo, setAddingSubTo] = useState<string | null>(null);
	const [subName, setSubName] = useState("");

	// Queries
	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();
	const { data: categoriesData, isLoading } =
		api.categories.listCategories.useQuery();

	const utils = api.useUtils();

	// Mutations
	const createMutation = api.categories.createCategory.useMutation({
		onSuccess: () => {
			void utils.categories.listCategories.invalidate();
			toast("Category created", "success");
			setNewName("");
			setNewParentId("");
			setShowNewForm(false);
			setSubName("");
			setAddingSubTo(null);
		},
		onError: (err) => toast(err.message, "error"),
	});

	const updateMutation = api.categories.updateCategory.useMutation({
		onSuccess: () => {
			void utils.categories.listCategories.invalidate();
			toast("Category updated", "success");
			setEditingId(null);
			setEditName("");
		},
		onError: (err) => toast(err.message, "error"),
	});

	const archiveMutation = api.categories.archiveCategory.useMutation({
		onSuccess: () => {
			void utils.categories.listCategories.invalidate();
			toast("Category archived", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	// Access control
	const isFacilityOrAdmin = user ? isFacilityOrAbove(user) : false;

	// Build tree from flat list
	const allCategories: Category[] = categoriesData?.categories ?? [];
	const visible = showInactive
		? allCategories
		: allCategories.filter((c) => c.isActive);

	const childrenOf = useCallback(
		(parentId: string) =>
			visible
				.filter((c) => c.parentCategoryId === parentId)
				.sort(
					(a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
				),
		[visible],
	);

	const topLevel = visible
		.filter((c) => !c.parentCategoryId)
		.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

	// Only top-level (no parent) categories can be parents in dropdown
	const topLevelAll = allCategories.filter(
		(c) => !c.parentCategoryId && c.isActive,
	);

	const toggleExpand = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const handleCreateTopLevel = () => {
		if (!newName.trim()) return;
		createMutation.mutate({
			name: newName.trim(),
			parentCategoryId: newParentId || undefined,
		});
	};

	const handleCreateSub = useCallback(
		(parentId: string) => {
			if (!subName.trim()) return;
			createMutation.mutate({
				name: subName.trim(),
				parentCategoryId: parentId,
			});
		},
		[subName, createMutation],
	);

	const handleSaveEdit = useCallback(
		(categoryId: string) => {
			if (!editName.trim()) return;
			updateMutation.mutate({ categoryId, name: editName.trim() });
		},
		[editName, updateMutation],
	);

	const handleArchive = useCallback(
		(category: Category) => {
			if (
				window.confirm(
					`Archive "${category.name}"? This will deactivate the category.`,
				)
			) {
				archiveMutation.mutate({ categoryId: category.categoryId });
			}
		},
		[archiveMutation],
	);

	const startEdit = useCallback((category: Category) => {
		setEditingId(category.categoryId);
		setEditName(category.name);
	}, []);

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
						Only facility managers and admins can manage categories.
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

	// Shared props for all CategoryRow instances
	const rowProps = {
		childrenOf,
		expandedIds,
		toggleExpand,
		editingId,
		editName,
		setEditName,
		handleSaveEdit,
		setEditingId,
		startEdit,
		updateIsPending: updateMutation.isPending,
		addingSubTo,
		subName,
		setSubName,
		handleCreateSub,
		setAddingSubTo,
		createIsPending: createMutation.isPending,
		handleArchive,
	};

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">
			{/* Header */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-bold text-2xl text-[var(--foreground)]">
						Product Categories
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Manage hierarchical product categories (up to 2 levels)
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
					<Button onClick={() => setShowNewForm(!showNewForm)}>
						<Plus size={16} />
						New Category
					</Button>
				</div>
			</div>

			{/* New Category form */}
			{showNewForm && (
				<div className="glass-inset mb-4 space-y-3 p-4">
					<p className="font-medium text-[var(--foreground)] text-sm">
						New Category
					</p>
					<div>
						<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
							Name *
						</label>
						<Input
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleCreateTopLevel();
							}}
							placeholder="e.g. Rackets"
							maxLength={200}
						/>
					</div>
					<div>
						<label className="mb-1 block text-[var(--muted-foreground)] text-xs">
							Parent Category (optional)
						</label>
						<select
							value={newParentId}
							onChange={(e) => setNewParentId(e.target.value)}
							className="flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-[var(--foreground)] text-base shadow-xs outline-none md:text-sm"
						>
							<option value="">None (top-level)</option>
							{topLevelAll.map((c) => (
								<option key={c.categoryId} value={c.categoryId}>
									{c.name}
								</option>
							))}
						</select>
					</div>
					{createMutation.error && (
						<p className="text-red-500 text-xs">
							{createMutation.error.message}
						</p>
					)}
					<div className="flex gap-2">
						<Button
							size="sm"
							onClick={handleCreateTopLevel}
							disabled={!newName.trim() || createMutation.isPending}
						>
							{createMutation.isPending ? "Creating..." : "Create"}
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								setShowNewForm(false);
								setNewName("");
								setNewParentId("");
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}

			{/* Category tree */}
			{topLevel.length === 0 ? (
				<div className="flex h-64 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
					<div className="text-center">
						<p className="text-[var(--muted-foreground)] text-sm">
							No categories yet
						</p>
						<Button className="mt-4" onClick={() => setShowNewForm(true)}>
							<Plus size={16} />
							Create Your First Category
						</Button>
					</div>
				</div>
			) : (
				<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
					{/* Table header */}
					<div className="flex items-center gap-2 bg-[var(--muted)] px-4 py-3 text-left text-sm">
						<span className="h-5 w-5 shrink-0" />
						<span className="min-w-0 flex-1 font-medium">Name</span>
						<span className="font-medium text-xs">Products</span>
						<span className="font-medium text-xs">Status</span>
						<span className="w-[100px] text-right font-medium text-xs">
							Actions
						</span>
					</div>

					{/* Tree rows */}
					{topLevel.map((cat) => (
						<CategoryRow
							key={cat.categoryId}
							category={cat}
							depth={0}
							{...rowProps}
						/>
					))}
				</div>
			)}
		</div>
	);
}
