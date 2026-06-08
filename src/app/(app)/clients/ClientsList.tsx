"use client";

import { Gender } from "@prisma/client";
import {
	Check,
	ChevronsUpDown,
	Download,
	Pencil,
	Search,
	Settings2,
	Tag,
	UserPlus,
	X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUrlPagination } from "~/app/_components/hooks/use-url-pagination";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import ManageTagsDialog from "~/app/_components/shared/ManageTagsDialog";
import { TagEditor } from "~/app/_components/shared/TagEditor";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/app/_components/shared/dialog";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "~/app/_components/shared/ui/command";
import { PaginationControls } from "~/app/_components/shared/ui/pagination-controls";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import { Select } from "~/app/_components/shared/ui/select";
import { ROLE_HIERARCHY, assignableRoles, cn, isAnyAdmin } from "~/lib/utils";
import { type RouterInputs, api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UserRole = RouterInputs["user"]["createUser"]["role"];

// ---------------------------------------------------------------------------
// Role badge colors
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
	STUDENT: "bg-gray-100 text-gray-700",
	COACH: "bg-blue-100 text-blue-700",
	FACILITY: "bg-green-100 text-green-700",
	CLUB_ADMIN: "bg-purple-100 text-purple-700",
	PLATFORM_ADMIN: "bg-red-100 text-red-700",
};

function RoleBadge({ role }: { role: string }) {
	return (
		<span
			className={`inline-block rounded-full px-2 py-0.5 font-medium text-xs ${ROLE_COLORS[role] ?? "bg-gray-100 text-gray-700"}`}
		>
			{role.replaceAll("_", " ")}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClubUser = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	userType: string;
	activeFacilityId: string | null;
	clubShortName: string;
	clubMemberships: {
		facilityId: string;
		role: string;
		facility: { facilityId: string; name: string };
	}[];
	userTags?: {
		tagId: string;
		tag: { tagId: string; name: string; bgColor: string; textColor: string };
	}[];
};

// ---------------------------------------------------------------------------
// Create User Modal
// ---------------------------------------------------------------------------

function CreateUserModal({
	open,
	onClose,
	callerType,
	toast,
}: {
	open: boolean;
	onClose: () => void;
	callerType: string;
	toast: (msg: string, variant: "success" | "error") => void;
}) {
	const utils = api.useUtils();
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [email, setEmail] = useState("");
	const [gender, setGender] = useState<Gender | "">("");
	const [role, setRole] = useState<UserRole>("STUDENT");
	const [facilityId, setFacilityId] = useState("");
	const [createNewClub, setCreateNewClub] = useState(false);
	const [newClubName, setNewClubName] = useState("");
	const [newClubShortName, setNewClubShortName] = useState("");
	const [error, setError] = useState("");
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

	const { data: facilities } = api.calendar.getFacilities.useQuery();
	const roles = useMemo(() => assignableRoles(callerType), [callerType]);
	const isPlatform = callerType === "PLATFORM_ADMIN";
	const showNewClubOption = isPlatform && role === "CLUB_ADMIN";

	// Reset new club state when role changes away from CLUB_ADMIN
	useEffect(() => {
		if (!showNewClubOption) setCreateNewClub(false);
	}, [showNewClubOption]);

	// Set default facility when facilities load
	useEffect(() => {
		if (facilities?.[0] && !facilityId) {
			setFacilityId(facilities[0].facilityId);
		}
	}, [facilities, facilityId]);

	const setUserTagsMutation = api.user.setUserTags.useMutation({
		onSuccess: () => {
			void utils.user.listClubUsers.invalidate();
		},
		onError: (err) => {
			toast(`Client created but failed to set tags: ${err.message}`, "error");
		},
	});

	const createMutation = api.user.createUser.useMutation({
		onSuccess: (newUser) => {
			void utils.user.listClubUsers.invalidate();
			toast("Client created", "success");
			if (selectedTagIds.length > 0) {
				setUserTagsMutation.mutate({
					userId: newUser.userId,
					tagIds: selectedTagIds,
				});
			}
			resetAndClose();
		},
		onError: (err) => setError(err.message),
	});

	function resetAndClose() {
		setFirstName("");
		setLastName("");
		setEmail("");
		setGender("");
		setRole("STUDENT");
		setFacilityId(facilities?.[0]?.facilityId ?? "");
		setCreateNewClub(false);
		setNewClubName("");
		setNewClubShortName("");
		setSelectedTagIds([]);
		setError("");
		onClose();
	}

	return (
		<Dialog open={open} onOpenChange={(v) => !v && resetAndClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Create Client</DialogTitle>
					<DialogDescription>
						Add a new member to your club. They will receive an email to set
						their password.
					</DialogDescription>
				</DialogHeader>

				<DialogBody>
					<div className="space-y-2">
						<label
							htmlFor="client-first-name"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Name
						</label>
						<div className="grid grid-cols-2 gap-2">
							<Input
								id="client-first-name"
								placeholder="First name"
								value={firstName}
								onChange={(e) => setFirstName(e.target.value)}
							/>
							<Input
								placeholder="Last name"
								value={lastName}
								onChange={(e) => setLastName(e.target.value)}
							/>
						</div>
					</div>

					<div className="space-y-2">
						<label
							htmlFor="client-email"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Email
						</label>
						<Input
							id="client-email"
							placeholder="email@example.com"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<label
							htmlFor="client-gender"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Gender
						</label>
						<Select
							id="client-gender"
							value={gender}
							onChange={(e) => setGender(e.target.value as Gender | "")}
						>
							<option value="">Select gender</option>
							<option value={Gender.MALE}>Male</option>
							<option value={Gender.FEMALE}>Female</option>
						</Select>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<label
								htmlFor="client-role"
								className="font-medium text-[var(--foreground)] text-sm"
							>
								Role
							</label>
							<Select
								id="client-role"
								value={role}
								onChange={(e) => setRole(e.target.value as UserRole)}
							>
								{roles.map((r) => (
									<option key={r} value={r}>
										{r.replaceAll("_", " ")}
									</option>
								))}
							</Select>
						</div>

						{!createNewClub && (
							<div className="space-y-2">
								<label
									htmlFor="client-facility"
									className="font-medium text-[var(--foreground)] text-sm"
								>
									Facility
								</label>
								<Select
									id="client-facility"
									value={facilityId}
									onChange={(e) => setFacilityId(e.target.value)}
								>
									{facilities?.map((f) => (
										<option key={f.facilityId} value={f.facilityId}>
											{f.name}
										</option>
									))}
								</Select>
							</div>
						)}
					</div>

					{/* New club option -- PLATFORM_ADMIN + CLUB_ADMIN role only */}
					{showNewClubOption && (
						<div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
							<label className="flex items-center gap-2 font-medium text-sm">
								<input
									type="checkbox"
									checked={createNewClub}
									onChange={(e) => setCreateNewClub(e.target.checked)}
									className="h-4 w-4 rounded border-gray-300 accent-[var(--primary)]"
								/>
								Create in a new club
							</label>
							{createNewClub && (
								<div className="space-y-2">
									<Input
										placeholder="Club name (e.g. DC Badminton)"
										value={newClubName}
										onChange={(e) => setNewClubName(e.target.value)}
									/>
									<Input
										placeholder="Club shortname (e.g. dc-badminton)"
										value={newClubShortName}
										onChange={(e) =>
											setNewClubShortName(
												e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
											)
										}
									/>
								</div>
							)}
						</div>
					)}

					{/* Tags */}
					<div className="space-y-2">
						<label
							htmlFor="client-tags"
							className="font-medium text-[var(--foreground)] text-sm"
						>
							Tags
						</label>
						<TagEditor
							selectedTagIds={selectedTagIds}
							onChange={setSelectedTagIds}
						/>
					</div>

					{error && <p className="text-red-500 text-xs">{error}</p>}
				</DialogBody>

				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={resetAndClose}>
						Cancel
					</Button>
					<Button
						onClick={() => {
							setError("");
							createMutation.mutate({
								firstName,
								lastName,
								email,
								gender: gender as Gender,
								role,
								...(createNewClub
									? {
											newClub: {
												clubName: newClubName.trim(),
												clubShortName: newClubShortName.trim(),
											},
										}
									: { facilityId }),
							});
						}}
						disabled={
							createMutation.isPending ||
							!firstName.trim() ||
							!lastName.trim() ||
							!email.trim() ||
							!gender ||
							(!createNewClub && !facilityId) ||
							(createNewClub &&
								(!newClubName.trim() || !newClubShortName.trim()))
						}
					>
						{createMutation.isPending ? "Creating..." : "Create Client"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Edit User Modal
// ---------------------------------------------------------------------------

function EditUserModal({
	user,
	onClose,
	callerType,
	toast,
}: {
	user: ClubUser | null;
	onClose: () => void;
	callerType: string;
	toast: (msg: string, variant: "success" | "error") => void;
}) {
	const utils = api.useUtils();
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [error, setError] = useState("");
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

	const { data: facilities } = api.calendar.getFacilities.useQuery();
	const roles = useMemo(() => assignableRoles(callerType), [callerType]);
	const canEdit = useMemo(() => {
		if (!user) return false;
		const highestRole = user.clubMemberships.reduce(
			(max, m) => Math.max(max, ROLE_HIERARCHY[m.role] ?? 0),
			0,
		);
		return (ROLE_HIERARCHY[callerType] ?? 0) > highestRole;
	}, [user, callerType]);

	useEffect(() => {
		if (user) {
			setFirstName(user.firstName ?? "");
			setLastName(user.lastName ?? "");
			setSelectedTagIds(user.userTags?.map((ut) => ut.tagId) ?? []);
			setError("");
		}
	}, [user]);

	function invalidateAndRefresh() {
		void utils.user.listClubUsers.invalidate();
	}

	const updateProfileMutation = api.user.updateUserProfile.useMutation({
		onSuccess: () => {
			invalidateAndRefresh();
			toast("Profile updated", "success");
		},
		onError: (err) => setError(err.message),
	});

	const updateRoleMutation = api.user.updateUserRole.useMutation({
		onSuccess: () => {
			invalidateAndRefresh();
			toast("Role updated", "success");
		},
		onError: (err) => setError(err.message),
	});

	const addFacilityMutation = api.user.addUserToFacility.useMutation({
		onSuccess: () => {
			invalidateAndRefresh();
			toast("Added to facility", "success");
		},
		onError: (err) => setError(err.message),
	});

	const removeFacilityMutation = api.user.removeUserFromFacility.useMutation({
		onSuccess: () => {
			invalidateAndRefresh();
			toast("Removed from facility", "success");
		},
		onError: (err) => setError(err.message),
	});

	const setUserTagsMutation = api.user.setUserTags.useMutation({
		onSuccess: () => {
			invalidateAndRefresh();
			toast("Tags updated", "success");
		},
		onError: (err) => setError(err.message),
	});

	if (!user) return null;

	const membershipMap = new Map(
		user.clubMemberships.map((m) => [m.facilityId, m.role]),
	);

	return (
		<Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Edit Client</DialogTitle>
					<DialogDescription>
						{user.firstName} {user.lastName} &bull; {user.email}
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-6">
					<div className="space-y-3">
						<h3 className="font-medium text-[var(--muted-foreground)] text-sm">
							Profile
						</h3>
						<div className="grid grid-cols-2 gap-2">
							<Input
								placeholder="First name"
								value={firstName}
								onChange={(e) => setFirstName(e.target.value)}
								disabled={!canEdit}
							/>
							<Input
								placeholder="Last name"
								value={lastName}
								onChange={(e) => setLastName(e.target.value)}
								disabled={!canEdit}
							/>
						</div>
						{canEdit && (
							<Button
								size="sm"
								variant="outline"
								onClick={() =>
									updateProfileMutation.mutate({
										userId: user.userId,
										firstName: firstName.trim(),
										lastName: lastName.trim(),
									})
								}
								disabled={updateProfileMutation.isPending}
							>
								{updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
							</Button>
						)}
					</div>

					<div className="space-y-3">
						<h3 className="font-medium text-[var(--muted-foreground)] text-sm">
							Facilities & Roles
						</h3>
						<div className="space-y-1">
							{facilities?.map((f) => {
								const currentRole = membershipMap.get(f.facilityId);
								const isMember = !!currentRole;

								return (
									<div
										key={f.facilityId}
										className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
											isMember
												? "bg-[var(--accent)]"
												: "hover:bg-[var(--accent)]"
										}`}
									>
										<input
											type="checkbox"
											checked={isMember}
											disabled={!canEdit}
											onChange={() => {
												if (isMember) {
													removeFacilityMutation.mutate({
														userId: user.userId,
														facilityId: f.facilityId,
													});
												} else {
													addFacilityMutation.mutate({
														userId: user.userId,
														facilityId: f.facilityId,
														role: "STUDENT" as UserRole,
													});
												}
											}}
											className="h-4 w-4 shrink-0 rounded border-gray-300 accent-[var(--primary)]"
										/>
										<span className="min-w-0 flex-1 truncate font-medium text-sm">
											{f.name}
										</span>
										{isMember && canEdit && (
											<Select
												value={currentRole}
												onChange={(e) =>
													updateRoleMutation.mutate({
														userId: user.userId,
														facilityId: f.facilityId,
														newRole: e.target.value as UserRole,
													})
												}
												className="h-auto w-auto shrink-0 px-2 py-1 text-xs"
											>
												{roles.map((r) => (
													<option key={r} value={r}>
														{r.replaceAll("_", " ")}
													</option>
												))}
											</Select>
										)}
										{isMember && !canEdit && <RoleBadge role={currentRole} />}
									</div>
								);
							})}
						</div>
					</div>

					{canEdit && (
						<div className="space-y-3">
							<h3 className="font-medium text-[var(--muted-foreground)] text-sm">
								Tags
							</h3>
							<TagEditor
								selectedTagIds={selectedTagIds}
								onChange={setSelectedTagIds}
							/>
							<Button
								size="sm"
								variant="outline"
								onClick={() =>
									setUserTagsMutation.mutate({
										userId: user.userId,
										tagIds: selectedTagIds,
									})
								}
								disabled={setUserTagsMutation.isPending}
							>
								{setUserTagsMutation.isPending ? "Saving..." : "Save Tags"}
							</Button>
						</div>
					)}

					{error && <p className="text-red-500 text-xs">{error}</p>}
				</DialogBody>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Main ClientsList
// ---------------------------------------------------------------------------

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export default function ClientsList({
	userType,
	clubShortName,
}: {
	userType: string;
	clubShortName: string;
}) {
	const utils = api.useUtils();
	const { toast } = useToast();
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
	const [facilityFilter, setFacilityFilter] = useState("");
	const [roleFilter, setRoleFilter] = useState("");
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [editingUserId, setEditingUserId] = useState<string | null>(null);
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
		new Set(),
	);
	const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
	const [bulkTagPopoverOpen, setBulkTagPopoverOpen] = useState(false);
	const [isManageTagsOpen, setIsManageTagsOpen] = useState(false);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	// ---------------------------------------------------------------------------
	// Tag filter -- URL-synced via ?tags=id1,id2
	// ---------------------------------------------------------------------------
	const searchParams = useSearchParams();

	const tagIdsFromUrl = useMemo(() => {
		const raw = searchParams.get("tags") ?? "";
		return raw ? raw.split(",").filter(Boolean) : [];
	}, [searchParams]);

	const setTagFilter = useCallback(
		(nextTagIds: string[]) => {
			syncUrl({
				page: "1",
				tags: nextTagIds.length > 0 ? nextTagIds.join(",") : undefined,
			});
		},
		[syncUrl],
	);

	function toggleTag(tagId: string) {
		const next = tagIdsFromUrl.includes(tagId)
			? tagIdsFromUrl.filter((id) => id !== tagId)
			: [...tagIdsFromUrl, tagId];
		setTagFilter(next);
	}

	// Fetch all club tags for the filter dropdown
	const { data: clubTags } = api.user.listClubTags.useQuery();

	const queryInput = {
		page,
		limit,
		search: search || undefined,
		facilityId: facilityFilter || undefined,
		role: (roleFilter as UserRole) || undefined,
		tagIds: tagIdsFromUrl.length > 0 ? tagIdsFromUrl : undefined,
	};

	const { data, isLoading } = api.user.listClubUsers.useQuery(queryInput, {
		staleTime: 30_000,
	});

	const { data: facilities } = api.calendar.getFacilities.useQuery();

	// Prefetch next page
	useEffect(() => {
		if (data && data.pagination.page < data.pagination.pageCount) {
			void utils.user.listClubUsers.prefetch(
				{ ...queryInput, page: page + 1 },
				{ staleTime: 30_000 },
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		data,
		page,
		limit,
		search,
		facilityFilter,
		roleFilter,
		tagIdsFromUrl,
		utils,
	]);

	const users = (data?.users ?? []) as ClubUser[];
	const pagination = data?.pagination;

	const [isExporting, setIsExporting] = useState(false);

	const handleExportCSV = useCallback(async () => {
		setIsExporting(true);
		try {
			const result = await utils.user.exportClubUsers.fetch({
				search: search || undefined,
				facilityId: facilityFilter || undefined,
				role: (roleFilter as UserRole) || undefined,
				tagIds: tagIdsFromUrl.length > 0 ? tagIdsFromUrl : undefined,
			});

			const rows = result.users.map((u) => [
				u.firstName ?? "",
				u.lastName ?? "",
				u.email ?? "",
			]);
			const csv = [
				["First Name", "Last Name", "Email"],
				...rows.map((r) =>
					r.map((v) => `"${v.replace(/"/g, '""')}"`).join(","),
				),
			].join("\n");

			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `clients_export_${new Date().toISOString().slice(0, 10)}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			toast("Failed to export clients", "error");
		} finally {
			setIsExporting(false);
		}
	}, [utils, search, facilityFilter, roleFilter, tagIdsFromUrl, toast]);

	// Clear selection when filters, page, or data change
	useEffect(() => {
		setSelectedUserIds(new Set());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [search, facilityFilter, roleFilter, tagIdsFromUrl, page, limit]);

	// Current page user IDs for "select all" logic
	const currentPageUserIds = useMemo(() => users.map((u) => u.userId), [users]);

	const allSelected =
		currentPageUserIds.length > 0 &&
		currentPageUserIds.every((id) => selectedUserIds.has(id));
	const someSelected =
		!allSelected && currentPageUserIds.some((id) => selectedUserIds.has(id));

	function toggleSelectAll() {
		if (allSelected) {
			setSelectedUserIds(new Set());
		} else {
			setSelectedUserIds(new Set(currentPageUserIds));
		}
	}

	function toggleSelectUser(userId: string) {
		setSelectedUserIds((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) {
				next.delete(userId);
			} else {
				next.add(userId);
			}
			return next;
		});
	}

	// Derive editingUser from fresh query data so it stays in sync after mutations
	const editingUser = editingUserId
		? (users.find((u) => u.userId === editingUserId) ?? null)
		: null;

	// Bulk add-tag mutation
	const bulkAddTagMutation = api.user.bulkAddTag.useMutation({
		onSuccess: (result) => {
			void utils.user.listClubUsers.invalidate();
			const parts: string[] = [];
			if (result.added > 0)
				parts.push(
					`Added to ${result.added} client${result.added === 1 ? "" : "s"}`,
				);
			if (result.skipped > 0)
				parts.push(`${result.skipped} already at tag limit`);
			toast(parts.join(", ") || "No changes made", "success");
			setSelectedUserIds(new Set());
			setBulkTagPopoverOpen(false);
		},
		onError: (err) => {
			toast(err.message, "error");
			setBulkTagPopoverOpen(false);
		},
	});

	return (
		<div className="p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<h1 className="font-semibold text-2xl text-[var(--foreground)]">
					Clients
				</h1>
				<Button onClick={() => setIsCreateOpen(true)}>
					<UserPlus size={16} className="mr-2" />
					Create Client
				</Button>
			</div>

			{/* Filters */}
			<div className="mb-4 flex flex-wrap items-center gap-3">
				<div className="relative w-full flex-1 sm:w-auto sm:min-w-[200px]">
					<Search
						size={16}
						className="-translate-y-1/2 absolute top-1/2 left-3 text-gray-400"
					/>
					<Input
						placeholder="Search by name or email..."
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						className="pl-9"
					/>
				</div>

				<Select
					value={facilityFilter}
					onChange={(e) => {
						setFacilityFilter(e.target.value);
						setPage(1);
					}}
					className="w-auto shrink-0"
				>
					<option value="">All Facilities</option>
					{facilities?.map((f) => (
						<option key={f.facilityId} value={f.facilityId}>
							{f.name}
						</option>
					))}
				</Select>

				<Select
					value={roleFilter}
					onChange={(e) => {
						setRoleFilter(e.target.value);
						setPage(1);
					}}
					className="w-auto shrink-0"
				>
					<option value="">All Roles</option>
					<option value="STUDENT">Student</option>
					<option value="COACH">Coach</option>
					<option value="FACILITY">Facility</option>
					<option value="CLUB_ADMIN">Club Admin</option>
					<option value="PLATFORM_ADMIN">Platform Admin</option>
				</Select>

				{/* Tags multi-select filter — deferred to client to avoid Radix hydration ID mismatch */}
				{mounted && (
					<Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
						<PopoverTrigger asChild>
							<Button
								variant="outline"
								role="combobox"
								aria-expanded={tagPopoverOpen}
								className="w-auto shrink-0 justify-between gap-1"
							>
								Tags
								{tagIdsFromUrl.length > 0 && (
									<span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--primary)] px-1.5 font-semibold text-[10px] text-white">
										{tagIdsFromUrl.length}
									</span>
								)}
								<ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[220px] p-0" align="start">
							<Command>
								<CommandInput placeholder="Search tags..." />
								<CommandList>
									<CommandEmpty>No tags found.</CommandEmpty>
									{tagIdsFromUrl.length > 0 && (
										<CommandGroup>
											<CommandItem
												value="__clear_all__"
												onSelect={() => setTagFilter([])}
											>
												<X className="mr-2 h-4 w-4" />
												<span>Clear</span>
											</CommandItem>
										</CommandGroup>
									)}
									<CommandGroup>
										{[...(clubTags ?? [])]
											.sort((a, b) => a.name.localeCompare(b.name))
											.map((tag) => {
												const isSelected = tagIdsFromUrl.includes(tag.tagId);
												return (
													<CommandItem
														key={tag.tagId}
														value={tag.name}
														onSelect={() => toggleTag(tag.tagId)}
													>
														<Check
															className={cn(
																"mr-2 h-4 w-4",
																isSelected ? "opacity-100" : "opacity-0",
															)}
														/>
														<span
															className="mr-2 inline-block h-3 w-3 shrink-0 rounded-full"
															style={{
																backgroundColor: tag.bgColor,
															}}
														/>
														<span className="truncate capitalize">
															{tag.name}
														</span>
													</CommandItem>
												);
											})}
									</CommandGroup>
								</CommandList>
							</Command>
						</PopoverContent>
					</Popover>
				)}

				{/* Manage Tags button — club admins+ only */}
				{isAnyAdmin({ userType }) && (
					<Button
						variant="outline"
						className="w-auto shrink-0 gap-1"
						onClick={() => setIsManageTagsOpen(true)}
					>
						<Settings2 size={14} />
						Manage Tags
					</Button>
				)}

				{/* Export CSV button — club admins+ only */}
				{isAnyAdmin({ userType }) && (
					<Button
						variant="outline"
						className="w-auto shrink-0 gap-1"
						onClick={() => void handleExportCSV()}
						disabled={isExporting}
					>
						<Download size={14} />
						{isExporting ? "Exporting..." : "Export CSV"}
					</Button>
				)}

				<Select
					value={limit}
					onChange={(e) => setLimit(Number(e.target.value))}
					className="w-auto shrink-0"
				>
					{PAGE_SIZE_OPTIONS.map((n) => (
						<option key={n} value={n}>
							{n} / page
						</option>
					))}
				</Select>
			</div>

			{/* Bulk action toolbar */}
			{selectedUserIds.size > 0 && (
				<div className="mb-4 flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-2.5">
					<span className="font-medium text-blue-900 text-sm">
						{selectedUserIds.size} client{selectedUserIds.size === 1 ? "" : "s"}{" "}
						selected
					</span>

					<Popover
						open={bulkTagPopoverOpen}
						onOpenChange={setBulkTagPopoverOpen}
					>
						<PopoverTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								className="gap-1.5 bg-white"
								disabled={bulkAddTagMutation.isPending}
							>
								<Tag size={14} />
								{bulkAddTagMutation.isPending ? "Applying..." : "Apply tag"}
								<ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[220px] p-0" align="start">
							<Command>
								<CommandInput placeholder="Search tags..." />
								<CommandList>
									<CommandEmpty>No tags found.</CommandEmpty>
									<CommandGroup>
										{[...(clubTags ?? [])]
											.sort((a, b) => a.name.localeCompare(b.name))
											.map((tag) => (
												<CommandItem
													key={tag.tagId}
													value={tag.name}
													onSelect={() => {
														bulkAddTagMutation.mutate({
															userIds: Array.from(selectedUserIds),
															tagId: tag.tagId,
														});
													}}
												>
													<span
														className="mr-2 inline-block h-3 w-3 shrink-0 rounded-full"
														style={{ backgroundColor: tag.bgColor }}
													/>
													<span className="truncate capitalize">
														{tag.name}
													</span>
												</CommandItem>
											))}
									</CommandGroup>
								</CommandList>
							</Command>
						</PopoverContent>
					</Popover>

					<Button
						variant="ghost"
						size="sm"
						className="ml-auto text-blue-700 hover:text-blue-900"
						onClick={() => setSelectedUserIds(new Set())}
					>
						<X size={14} className="mr-1" />
						Clear
					</Button>
				</div>
			)}

			{/* Table */}
			{isLoading ? (
				<div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-gray-200 border-b bg-gray-50">
								<th className="w-10 px-4 py-3">
									<div className="h-4 w-4 rounded bg-gray-200" />
								</th>
								<th className="px-4 py-3">
									<div className="h-4 w-16 rounded bg-gray-200" />
								</th>
								<th className="px-4 py-3">
									<div className="h-4 w-16 rounded bg-gray-200" />
								</th>
								<th className="px-4 py-3">
									<div className="h-4 w-24 rounded bg-gray-200" />
								</th>
								<th className="px-4 py-3">
									<div className="h-4 w-12 rounded bg-gray-200" />
								</th>
								<th className="px-4 py-3" />
							</tr>
						</thead>
						<tbody>
							{Array.from({ length: 5 }).map((_, i) => (
								<tr
									key={i}
									className="border-gray-100 border-b last:border-b-0"
								>
									<td className="w-10 px-4 py-3">
										<div className="h-4 w-4 animate-pulse rounded bg-gray-100" />
									</td>
									<td className="px-4 py-3">
										<div className="h-4 w-28 animate-pulse rounded bg-gray-100" />
									</td>
									<td className="px-4 py-3">
										<div className="h-4 w-36 animate-pulse rounded bg-gray-100" />
									</td>
									<td className="px-4 py-3">
										<div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
									</td>
									<td className="px-4 py-3">
										<div className="flex gap-1">
											<div className="h-5 w-14 animate-pulse rounded-full bg-gray-100" />
											<div className="h-5 w-14 animate-pulse rounded-full bg-gray-100" />
										</div>
									</td>
									<td className="px-4 py-3">
										<div className="h-4 w-6 animate-pulse rounded bg-gray-100" />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : users.length === 0 ? (
				<div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-[var(--muted-foreground)] text-sm">
					No clients found.
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-gray-200 border-b bg-gray-50">
								<th className="w-10 px-4 py-3">
									<input
										type="checkbox"
										checked={allSelected}
										ref={(el) => {
											if (el) el.indeterminate = someSelected;
										}}
										onChange={toggleSelectAll}
										aria-label="Select all clients on this page"
										className="h-4 w-4 rounded border-gray-300 accent-[var(--primary)]"
									/>
								</th>
								<th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">
									Name
								</th>
								<th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">
									Email
								</th>
								<th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">
									Facilities &amp; Roles
								</th>
								<th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">
									Tags
								</th>
								<th className="px-4 py-3 font-medium text-[var(--muted-foreground)]" />
							</tr>
						</thead>
						<tbody>
							{users.map((u) => (
								<tr
									key={u.userId}
									className="border-gray-100 border-b last:border-b-0 hover:bg-gray-50"
								>
									<td className="w-10 px-4 py-3">
										<input
											type="checkbox"
											checked={selectedUserIds.has(u.userId)}
											onChange={() => toggleSelectUser(u.userId)}
											aria-label={`Select ${u.firstName ?? ""} ${u.lastName ?? ""}`}
											className="h-4 w-4 rounded border-gray-300 accent-[var(--primary)]"
										/>
									</td>
									<td className="px-4 py-3 font-medium text-[var(--foreground)]">
										<Link
											href={`/clients/${u.userId}`}
											className="hover:text-[var(--primary)] hover:underline"
										>
											{u.firstName} {u.lastName}
										</Link>
									</td>
									<td className="px-4 py-3 text-[var(--muted-foreground)]">
										{u.email}
									</td>
									<td className="px-4 py-3">
										<div className="flex flex-wrap gap-1">
											{u.clubMemberships.map((m) => (
												<span
													key={m.facilityId}
													className="inline-flex items-center gap-1"
												>
													<span className="text-[var(--muted-foreground)] text-xs">
														{m.facility.name}:
													</span>
													<RoleBadge role={m.role} />
												</span>
											))}
										</div>
									</td>
									<td className="px-4 py-3">
										{u.userTags && u.userTags.length > 0 && (
											<div className="flex items-center gap-1">
												{u.userTags.slice(0, 2).map((ut) => (
													<span
														key={ut.tagId}
														style={{
															backgroundColor: ut.tag.bgColor,
															color: ut.tag.textColor,
														}}
														className="inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs capitalize"
													>
														{ut.tag.name}
													</span>
												))}
												{u.userTags.length > 2 && (
													<Popover>
														<PopoverTrigger asChild>
															<button
																type="button"
																className="inline-flex cursor-pointer items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600 text-xs hover:bg-gray-200"
															>
																+{u.userTags.length - 2} more
															</button>
														</PopoverTrigger>
														<PopoverContent
															align="start"
															className="w-auto max-w-xs p-3"
														>
															<div className="flex flex-wrap gap-1.5">
																{u.userTags.map((ut) => (
																	<span
																		key={ut.tagId}
																		style={{
																			backgroundColor: ut.tag.bgColor,
																			color: ut.tag.textColor,
																		}}
																		className="inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs capitalize"
																	>
																		{ut.tag.name}
																	</span>
																))}
															</div>
														</PopoverContent>
													</Popover>
												)}
											</div>
										)}
									</td>
									<td className="px-4 py-3">
										<div className="flex items-center gap-1">
											<Button
												variant="ghost"
												size="icon"
												onClick={() => setEditingUserId(u.userId)}
												aria-label={`Edit ${u.firstName ?? ""} ${u.lastName ?? ""}`}
												title="Edit"
											>
												<Pencil size={14} />
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

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

			{/* Modals */}
			<CreateUserModal
				open={isCreateOpen}
				onClose={() => setIsCreateOpen(false)}
				callerType={userType}
				toast={toast}
			/>
			<EditUserModal
				user={editingUser}
				onClose={() => setEditingUserId(null)}
				callerType={userType}
				toast={toast}
			/>
			<ManageTagsDialog
				open={isManageTagsOpen}
				onClose={() => setIsManageTagsOpen(false)}
			/>
		</div>
	);
}
