"use client";

import { Archive, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { AlertDialog } from "~/app/_components/shared/AlertDialog";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { isAnyAdmin, isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Membership Types admin page (Phase 10a — phase10-memberships.md "Admin
// Screens" → Membership Types Management). Table: Name, Revenue Category, Plan
// Count, Status; actions Add / Edit / Archive.
//
// Mirrors the products Categories page (inline add + inline edit) but uses the
// AlertDialog archive-confirm pattern from PackagePlansClient (not
// window.confirm) and gates edit/archive behind isAnyAdmin — FACILITY can view
// (and sell) but only club/platform admins may edit or archive (#50/#51).
// ---------------------------------------------------------------------------

export default function MembershipTypesClient() {
	const { toast } = useToast();
	const [showInactive, setShowInactive] = useState(false);

	// New-type inline form
	const [showNewForm, setShowNewForm] = useState(false);
	const [newName, setNewName] = useState("");

	// Inline edit state
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");

	// Archive confirmation
	const [archiveTarget, setArchiveTarget] = useState<{
		membershipTypeId: string;
		name: string;
	} | null>(null);

	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();
	const { data: typesData, isLoading } = api.memberships.listTypes.useQuery({
		...(showInactive ? {} : { isActive: true }),
	});

	const utils = api.useUtils();

	const createMutation = api.memberships.createType.useMutation({
		onSuccess: () => {
			void utils.memberships.listTypes.invalidate();
			toast("Membership type created", "success");
			setNewName("");
			setShowNewForm(false);
		},
		onError: (err) => toast(err.message, "error"),
	});

	const updateMutation = api.memberships.updateType.useMutation({
		onSuccess: () => {
			void utils.memberships.listTypes.invalidate();
			toast("Membership type updated", "success");
			setEditingId(null);
			setEditName("");
		},
		onError: (err) => toast(err.message, "error"),
	});

	const archiveMutation = api.memberships.archiveType.useMutation({
		onSuccess: () => {
			void utils.memberships.listTypes.invalidate();
			toast("Membership type archived", "success");
		},
		onError: (err) => toast(err.message, "error"),
	});

	// FACILITY can view the list; only club/platform admins may add/edit/archive.
	const isFacilityOrAdmin = user ? isFacilityOrAbove(user) : false;
	const canManageTypes = user ? isAnyAdmin(user) : false;

	const handleCreate = () => {
		if (!newName.trim()) return;
		createMutation.mutate({ name: newName.trim() });
	};

	const startEdit = (membershipTypeId: string, name: string) => {
		setEditingId(membershipTypeId);
		setEditName(name);
	};

	const handleSaveEdit = (membershipTypeId: string) => {
		if (!editName.trim()) return;
		updateMutation.mutate({ membershipTypeId, name: editName.trim() });
	};

	const confirmArchive = () => {
		if (archiveTarget) {
			archiveMutation.mutate({
				membershipTypeId: archiveTarget.membershipTypeId,
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
						Only facility managers and admins can manage membership types.
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

	const types = typesData?.types ?? [];

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">
			{/* Header */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-bold text-2xl text-[var(--foreground)]">
						Membership Types
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Categorize memberships for reporting (e.g. "Adult Monthly", "Junior
						Annual"). Each type can have multiple plans.
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
					{canManageTypes && (
						<Button onClick={() => setShowNewForm(!showNewForm)}>
							<Plus size={16} />
							New Type
						</Button>
					)}
				</div>
			</div>

			{/* New-type inline form */}
			{showNewForm && canManageTypes && (
				<div className="glass-inset mb-4 space-y-3 p-4">
					<p className="font-medium text-[var(--foreground)] text-sm">
						New Membership Type
					</p>
					<div>
						<label
							htmlFor="new-membership-type-name"
							className="mb-1 block text-[var(--muted-foreground)] text-xs"
						>
							Name *
						</label>
						<Input
							id="new-membership-type-name"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleCreate();
							}}
							placeholder="e.g. Adult Monthly"
							maxLength={200}
							autoFocus
						/>
					</div>
					{createMutation.error && (
						<p className="text-red-500 text-xs">
							{createMutation.error.message}
						</p>
					)}
					<div className="flex gap-2">
						<Button
							size="sm"
							onClick={handleCreate}
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
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}

			{/* Empty state */}
			{types.length === 0 ? (
				<div className="flex h-64 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
					<div className="text-center">
						<p className="text-[var(--muted-foreground)] text-sm">
							No membership types yet
						</p>
						{canManageTypes && (
							<Button className="mt-4" onClick={() => setShowNewForm(true)}>
								<Plus size={16} />
								Create Your First Type
							</Button>
						)}
					</div>
				</div>
			) : (
				<>
					{/* Mobile: stacked cards */}
					<div className="space-y-3 md:hidden">
						{types.map((type) => {
							const isEditing = editingId === type.membershipTypeId;
							return (
								<div
									key={type.membershipTypeId}
									className={`rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 ${!type.isActive ? "opacity-60" : ""}`}
								>
									{isEditing ? (
										<div className="space-y-2">
											<Input
												value={editName}
												onChange={(e) => setEditName(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter")
														handleSaveEdit(type.membershipTypeId);
													if (e.key === "Escape") setEditingId(null);
												}}
												className="h-9 text-sm"
												autoFocus
											/>
											<div className="flex gap-2">
												<Button
													size="sm"
													onClick={() => handleSaveEdit(type.membershipTypeId)}
													disabled={
														!editName.trim() || updateMutation.isPending
													}
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
										</div>
									) : (
										<>
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0 flex-1">
													<div className="font-medium text-[var(--foreground)]">
														{type.name}
													</div>
													<div className="mt-0.5 text-[var(--muted-foreground)] text-xs">
														{type.revenueCategory?.label ??
															"No revenue category"}
													</div>
												</div>
												{type.isActive ? (
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
											<p className="mt-2 text-[var(--muted-foreground)] text-xs">
												{type._count.plans} plan
												{type._count.plans !== 1 ? "s" : ""}
											</p>
											{canManageTypes && (
												<div className="mt-3 flex justify-end gap-2 border-[var(--border)] border-t pt-3">
													<Button
														variant="ghost"
														size="sm"
														onClick={() =>
															startEdit(type.membershipTypeId, type.name)
														}
														aria-label="Edit membership type"
													>
														<Pencil size={14} />
														Edit
													</Button>
													{type.isActive && (
														<Button
															variant="ghost"
															size="sm"
															onClick={() =>
																setArchiveTarget({
																	membershipTypeId: type.membershipTypeId,
																	name: type.name,
																})
															}
															aria-label="Archive membership type"
															className="hover:bg-red-50 hover:text-red-600"
														>
															<Archive size={14} />
															Archive
														</Button>
													)}
												</div>
											)}
										</>
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
									<th className="px-4 py-3 font-medium">Revenue Category</th>
									<th className="px-4 py-3 font-medium">Plans</th>
									<th className="px-4 py-3 font-medium">Status</th>
									{canManageTypes && (
										<th className="px-4 py-3 text-right font-medium">
											Actions
										</th>
									)}
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--border)] bg-[var(--card)]">
								{types.map((type) => {
									const isEditing = editingId === type.membershipTypeId;
									return (
										<tr
											key={type.membershipTypeId}
											className={`hover:bg-[var(--accent)] ${!type.isActive ? "opacity-50" : ""}`}
										>
											<td className="px-4 py-3">
												{isEditing ? (
													<div className="flex items-center gap-2">
														<Input
															value={editName}
															onChange={(e) => setEditName(e.target.value)}
															onKeyDown={(e) => {
																if (e.key === "Enter")
																	handleSaveEdit(type.membershipTypeId);
																if (e.key === "Escape") setEditingId(null);
															}}
															className="h-8 text-sm"
															autoFocus
														/>
														<Button
															size="sm"
															onClick={() =>
																handleSaveEdit(type.membershipTypeId)
															}
															disabled={
																!editName.trim() || updateMutation.isPending
															}
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
													<span className="font-medium text-[var(--foreground)]">
														{type.name}
													</span>
												)}
											</td>
											<td className="px-4 py-3 text-[var(--foreground)] text-sm">
												{type.revenueCategory?.label ?? (
													<span className="text-[var(--muted-foreground)]">
														—
													</span>
												)}
											</td>
											<td className="px-4 py-3 text-[var(--foreground)] text-sm">
												{type._count.plans}
											</td>
											<td className="px-4 py-3">
												{type.isActive ? (
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
											{canManageTypes && (
												<td className="px-4 py-3">
													{!isEditing && (
														<div className="flex justify-end gap-2">
															<Button
																variant="ghost"
																size="icon"
																onClick={() =>
																	startEdit(type.membershipTypeId, type.name)
																}
																aria-label="Edit membership type"
															>
																<Pencil size={16} />
															</Button>
															{type.isActive && (
																<Button
																	variant="ghost"
																	size="icon"
																	onClick={() =>
																		setArchiveTarget({
																			membershipTypeId: type.membershipTypeId,
																			name: type.name,
																		})
																	}
																	aria-label="Archive membership type"
																	className="hover:bg-red-50 hover:text-red-600"
																>
																	<Archive size={16} />
																</Button>
															)}
														</div>
													)}
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
				description="Existing memberships on this type's plans are unaffected. The type is hidden from sell pickers. You can reactivate it later."
				confirmLabel="Archive"
				destructive
				onConfirm={confirmArchive}
				onCancel={() => setArchiveTarget(null)}
			/>
		</div>
	);
}
