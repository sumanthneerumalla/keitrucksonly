"use client";

import { RegistrationStatus } from "@prisma/client";
import {
	CalendarDays,
	Check,
	Clock,
	MapPin,
	Search,
	UserCheck,
	Users,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import MemberPackagesCard from "~/app/(app)/admin/checkin/MemberPackagesCard";
import { Button } from "~/app/_components/shared/Button";
import { FacilitySelector } from "~/app/_components/shared/FacilitySelector";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import { isFacilityOrAbove } from "~/lib/utils";
import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(date: Date | string) {
	return new Date(date).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function timeAgo(date: Date | string) {
	const diff = Date.now() - new Date(date).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	return `${hrs}h ${mins % 60}m ago`;
}

// ---------------------------------------------------------------------------
// Types inferred from API
// ---------------------------------------------------------------------------

type SearchMember = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	profileImage: string | null;
};

type CheckinCardMember = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	profileImage: string | null;
	memberSince: Date | string;
	tags: { tagId: string; name: string; bgColor: string | null; textColor: string | null }[];
};

type TodayRegistration = {
	registrationId: string;
	status: RegistrationStatus;
	event: {
		eventId: string;
		title: string;
		start: Date | string;
		end: Date | string;
		eventType: string;
		maxParticipants: number | null;
		currentRegistrations: number;
		resourceTitle: string | null;
	};
};

type NearbyEvent = {
	eventId: string;
	title: string;
	start: Date | string;
	end: Date | string;
	eventType: string;
	maxParticipants: number | null;
	currentRegistrations: number;
	resourceTitle: string | null;
};

type RecentCheckin = {
	attendanceId: string;
	checkedInAt: Date | string;
	source: string;
	member: {
		userId: string;
		firstName: string | null;
		lastName: string | null;
		profileImage: string | null;
	};
	event: { eventId: string; title: string } | null;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminCheckinClient() {
	const { toast } = useToast();
	const utils = api.useUtils();

	// Search state
	const [searchInput, setSearchInput] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
	const [showDropdown, setShowDropdown] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);

	// Barcode scan detection
	const keystrokeTimestamps = useRef<number[]>([]);

	// Walk-in confirmation
	const [walkinConfirm, setWalkinConfirm] = useState<{
		eventId: string;
		eventTitle: string;
		memberName: string;
		isFull: boolean;
		currentRegistrations: number;
		maxParticipants: number | null;
	} | null>(null);

	// Queries
	const { data: user, isLoading: isUserLoading } =
		api.user.getOrCreateProfile.useQuery();

	const { data: facilityMemberships } =
		api.user.getFacilityMemberships.useQuery(undefined, {
			enabled: !!user,
		});

	const [selectedFacilityId, setSelectedFacilityId] = useState<string>("");

	// Initialize selected facility from user's active facility
	useEffect(() => {
		if (!selectedFacilityId && user?.activeFacilityId) {
			setSelectedFacilityId(user.activeFacilityId);
		}
	}, [user?.activeFacilityId, selectedFacilityId]);

	const facilityId = selectedFacilityId;

	const facilities = (facilityMemberships ?? []).map((m) => ({
		facilityId: m.facilityId,
		facilityName: m.facilityName ?? m.facilityId,
	}));

	const isFacilityOrAdmin = user ? isFacilityOrAbove(user) : false;

	// Search members (only query when we have 1+ chars)
	const { data: searchData } = api.checkin.searchMembers.useQuery(
		{ query: debouncedQuery, facilityId },
		{ enabled: !!debouncedQuery && !!facilityId },
	);

	// Member detail card
	const { data: cardData, isLoading: isCardLoading } =
		api.checkin.getMemberCheckinCard.useQuery(
			{ userId: selectedUserId!, facilityId },
			{ enabled: !!selectedUserId && !!facilityId },
		);

	// Recent check-ins (poll every 3s)
	const { data: recentData } = api.checkin.getRecentCheckins.useQuery(
		{ facilityId },
		{ enabled: !!facilityId, refetchInterval: 3000 },
	);

	// Staff check-in mutation
	const staffCheckinMutation = api.checkin.staffCheckin.useMutation({
		onSuccess: (result) => {
			if (result.alreadyCheckedIn) {
				toast("Already checked in", "info");
			} else if (result.flow === "general") {
				toast("General check-in recorded", "success");
			} else if (result.flow === "walkin") {
				toast("Walk-in check-in recorded", "success");
			} else {
				toast("Checked in successfully", "success");
			}
			void utils.checkin.getMemberCheckinCard.invalidate();
			void utils.checkin.getRecentCheckins.invalidate();
			void utils.packages.getMemberPackages.invalidate({ userId: selectedUserId! });
		},
		onError: (err) => toast(err.message, "error"),
	});

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(searchInput.trim());
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput]);

	// Show dropdown when search results arrive
	useEffect(() => {
		if (searchData?.members && searchData.members.length > 0 && debouncedQuery) {
			setShowDropdown(true);
		}
	}, [searchData, debouncedQuery]);

	// Close dropdown on outside click
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(e.target as Node) &&
				searchRef.current &&
				!searchRef.current.contains(e.target as Node)
			) {
				setShowDropdown(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Auto-focus search on load
	useEffect(() => {
		searchRef.current?.focus();
	}, [isFacilityOrAdmin]);

	// Barcode scan detection: if 10+ chars arrive within 100ms, treat as scan
	const handleSearchKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Escape") {
				setShowDropdown(false);
				return;
			}
			const now = Date.now();
			keystrokeTimestamps.current.push(now);
			// Keep only last 10 timestamps
			if (keystrokeTimestamps.current.length > 10) {
				keystrokeTimestamps.current = keystrokeTimestamps.current.slice(-10);
			}
			const stamps = keystrokeTimestamps.current;
			if (stamps.length >= 10) {
				const elapsed = stamps[stamps.length - 1]! - stamps[0]!;
				if (elapsed < 100) {
					// Barcode scan detected — force immediate search
					setTimeout(() => {
						const val = (e.target as HTMLInputElement).value.trim();
						if (val) {
							setDebouncedQuery(val);
						}
					}, 50);
				}
			}
		},
		[],
	);

	const selectMember = useCallback((userId: string) => {
		setSelectedUserId(userId);
		setShowDropdown(false);
		setSearchInput("");
		setDebouncedQuery("");
	}, []);

	const handleStaffCheckin = useCallback(
		(eventId?: string) => {
			if (!selectedUserId || !facilityId) return;
			staffCheckinMutation.mutate({
				userId: selectedUserId,
				facilityId,
				eventId,
			});
		},
		[selectedUserId, facilityId, staffCheckinMutation],
	);

	const handleWalkinCheckin = useCallback(
		(event: NearbyEvent, memberName: string) => {
			const isFull =
				event.maxParticipants !== null &&
				event.currentRegistrations >= event.maxParticipants;
			setWalkinConfirm({
				eventId: event.eventId,
				eventTitle: event.title,
				memberName,
				isFull,
				currentRegistrations: event.currentRegistrations,
				maxParticipants: event.maxParticipants,
			});
		},
		[],
	);

	const confirmWalkin = useCallback(() => {
		if (!walkinConfirm) return;
		handleStaffCheckin(walkinConfirm.eventId);
		setWalkinConfirm(null);
	}, [walkinConfirm, handleStaffCheckin]);

	// ---------------------------------------------------------------------------
	// Access / loading guards
	// ---------------------------------------------------------------------------

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
						Only facility managers and admins can access check-in.
					</p>
				</div>
			</div>
		);
	}

	if (!facilityId) {
		return (
			<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
				<div className="text-center">
					<h2 className="font-semibold text-[var(--foreground)] text-xl">
						No Facility Selected
					</h2>
					<p className="mt-2 text-[var(--muted-foreground)] text-sm">
						Please select a facility first.
					</p>
				</div>
			</div>
		);
	}

	const members = searchData?.members ?? [];
	const recentCheckins: RecentCheckin[] = (recentData?.checkins as RecentCheckin[]) ?? [];
	const member: CheckinCardMember | undefined = cardData?.member as CheckinCardMember | undefined;
	const todayRegistrations: TodayRegistration[] =
		(cardData?.todayRegistrations as TodayRegistration[]) ?? [];
	const nearbyEvents: NearbyEvent[] =
		(cardData?.nearbyEvents as NearbyEvent[]) ?? [];

	const memberFullName = member
		? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || member.email || ""
		: "";

	return (
		<div className="h-[calc(100vh-5rem)] overflow-auto p-4 md:p-6">

			{/* Walk-in confirmation dialog */}
			{walkinConfirm && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
						<h3 className="font-semibold text-[var(--foreground)] text-lg">
							Confirm Walk-in Check-in
						</h3>
						<p className="mt-2 text-[var(--muted-foreground)] text-sm">
							Check <strong>{walkinConfirm.memberName}</strong> into{" "}
							<strong>{walkinConfirm.eventTitle}</strong>? They are not
							registered for this event.
						</p>
						{walkinConfirm.isFull && (
							<p className="mt-2 rounded bg-orange-50 px-3 py-2 text-orange-700 text-sm">
								⚠ This event is full ({walkinConfirm.currentRegistrations}/{walkinConfirm.maxParticipants}). Proceed anyway?
							</p>
						)}
						<div className="mt-4 flex justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setWalkinConfirm(null)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								onClick={confirmWalkin}
								disabled={staffCheckinMutation.isPending}
							>
								{staffCheckinMutation.isPending ? "Checking in..." : "Confirm"}
							</Button>
						</div>
					</div>
				</div>
			)}

			{/* Header */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="font-bold text-2xl text-[var(--foreground)]">
						Check-in
					</h1>
					<p className="mt-1 text-[var(--muted-foreground)] text-sm">
						Search or scan members to check them into events
					</p>
				</div>
				<FacilitySelector
					facilities={facilities}
					selectedFacilityId={facilityId || null}
					onSelect={setSelectedFacilityId}
				/>
			</div>

			{/* Search bar */}
			<div className="relative mb-6">
				<div className="relative">
					<Search
						size={18}
						className="absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted-foreground)]"
					/>
					<Input
						ref={searchRef}
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						onKeyDown={handleSearchKeyDown}
						onFocus={() => {
							if (members.length > 0 && debouncedQuery) setShowDropdown(true);
						}}
						placeholder="Search by name or scan barcode..."
						className="pl-10"
					/>
					{searchInput && (
						<button
							type="button"
							onClick={() => {
								setSearchInput("");
								setDebouncedQuery("");
								setShowDropdown(false);
								searchRef.current?.focus();
							}}
							className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
						>
							<X size={16} />
						</button>
					)}
				</div>

				{/* Search dropdown */}
				{showDropdown && members.length > 0 && (
					<div
						ref={dropdownRef}
						className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
					>
						{members.map((m: SearchMember) => (
							<button
								key={m.userId}
								type="button"
								onClick={() => selectMember(m.userId)}
								className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--accent)]"
							>
								<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--foreground)] text-sm font-medium">
									{m.profileImage ? (
										<img
											src={m.profileImage}
											alt=""
											className="h-8 w-8 rounded-full object-cover"
										/>
									) : (
										<>
											{(m.firstName?.[0] ?? "").toUpperCase()}
											{(m.lastName?.[0] ?? "").toUpperCase()}
										</>
									)}
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm text-[var(--foreground)]">
										{m.firstName} {m.lastName}
									</p>
									<p className="truncate text-xs text-[var(--muted-foreground)]">
										{m.email}
									</p>
								</div>
							</button>
						))}
					</div>
				)}

				{showDropdown && debouncedQuery && members.length === 0 && (
					<div
						ref={dropdownRef}
						className="absolute z-40 mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg"
					>
						<p className="text-center text-sm text-[var(--muted-foreground)]">
							No members found
						</p>
					</div>
				)}
			</div>

			{/* Two-panel layout */}
			<div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
				{/* Left panel: Recent Check-ins */}
				<div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
					<div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
						<Clock size={16} className="text-[var(--muted-foreground)]" />
						<h2 className="font-semibold text-sm text-[var(--foreground)]">
							Recent Check-ins
						</h2>
						<span className="ml-auto text-xs text-[var(--muted-foreground)]">
							{recentCheckins.length} today
						</span>
					</div>
					<div className="max-h-[calc(100vh-20rem)] overflow-auto">
						{recentCheckins.length === 0 ? (
							<div className="flex h-32 items-center justify-center">
								<p className="text-sm text-[var(--muted-foreground)]">
									No check-ins today yet
								</p>
							</div>
						) : (
							recentCheckins.map((ci) => (
								<button
									key={ci.attendanceId}
									type="button"
									onClick={() => selectMember(ci.member.userId)}
									className={`flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--accent)] ${
										selectedUserId === ci.member.userId
											? "bg-[var(--accent)]"
											: ""
									}`}
								>
									<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--foreground)] text-xs font-medium">
										{ci.member.profileImage ? (
											<img
												src={ci.member.profileImage}
												alt=""
												className="h-8 w-8 rounded-full object-cover"
											/>
										) : (
											<>
												{(ci.member.firstName?.[0] ?? "").toUpperCase()}
												{(ci.member.lastName?.[0] ?? "").toUpperCase()}
											</>
										)}
									</div>
									<div className="min-w-0 flex-1">
										<p className="truncate font-medium text-sm text-[var(--foreground)]">
											{ci.member.firstName} {ci.member.lastName}
										</p>
										<p className="truncate text-xs text-[var(--muted-foreground)]">
											{ci.event ? ci.event.title : "General check-in"}
										</p>
									</div>
									<span className="shrink-0 text-xs text-[var(--muted-foreground)]">
										{timeAgo(ci.checkedInAt)}
									</span>
								</button>
							))
						)}
					</div>
				</div>

				{/* Right panel: Member Detail Card */}
				<div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
					{!selectedUserId ? (
						<div className="flex h-64 items-center justify-center">
							<div className="text-center">
								<UserCheck
									size={40}
									className="mx-auto text-[var(--muted-foreground)]"
								/>
								<p className="mt-3 text-sm text-[var(--muted-foreground)]">
									Search and select a member to check them in
								</p>
							</div>
						</div>
					) : isCardLoading ? (
						<div className="animate-pulse space-y-4 p-6">
							<div className="flex items-center gap-4">
								<div className="h-12 w-12 rounded-full bg-gray-200" />
								<div className="space-y-2">
									<div className="h-5 w-40 rounded bg-gray-200" />
									<div className="h-3 w-24 rounded bg-gray-200" />
								</div>
							</div>
							<div className="h-20 rounded bg-gray-200" />
							<div className="h-20 rounded bg-gray-200" />
						</div>
					) : member ? (
						<div className="divide-y divide-[var(--border)]">
							{/* Member header */}
							<div className="flex items-start gap-4 p-4">
								<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--foreground)] text-lg font-semibold">
									{member.profileImage ? (
										<img
											src={member.profileImage}
											alt=""
											className="h-12 w-12 rounded-full object-cover"
										/>
									) : (
										<>
											{(member.firstName?.[0] ?? "").toUpperCase()}
											{(member.lastName?.[0] ?? "").toUpperCase()}
										</>
									)}
								</div>
								<div className="min-w-0 flex-1">
									<h3 className="font-semibold text-lg text-[var(--foreground)]">
										{memberFullName}
									</h3>
									<p className="text-sm text-[var(--muted-foreground)]">
										{member.email}
									</p>
									<p className="text-xs text-[var(--muted-foreground)]">
										Member since{" "}
										{new Date(member.memberSince).toLocaleDateString()}
									</p>
									{member.tags.length > 0 && (
										<div className="mt-2 flex flex-wrap gap-1">
											{member.tags.map((tag) => (
												<span
													key={tag.tagId}
													className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
													style={{
														backgroundColor:
															tag.bgColor ?? "var(--accent)",
														color:
															tag.textColor ?? "var(--foreground)",
													}}
												>
													{tag.name}
												</span>
											))}
										</div>
									)}
								</div>
								<button
									type="button"
									onClick={() => setSelectedUserId(null)}
									className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
								>
									<X size={18} />
								</button>
							</div>

							{/* Today's Events */}
							<div className="p-4">
								<h4 className="mb-3 flex items-center gap-2 font-semibold text-sm text-[var(--foreground)]">
									<CalendarDays size={14} />
									Today&apos;s Events
								</h4>
								{todayRegistrations.length === 0 ? (
									<p className="text-sm text-[var(--muted-foreground)]">
										No events registered for today
									</p>
								) : (
									<div className="space-y-2">
										{todayRegistrations.map((reg) => {
											const isFull =
												reg.event.maxParticipants !== null &&
												reg.event.currentRegistrations >=
													reg.event.maxParticipants;
											const isCheckedIn =
												reg.status === RegistrationStatus.CHECKED_IN;

											return (
												<div
													key={reg.registrationId}
													className="flex items-center gap-3 rounded-md border border-[var(--border)] p-3"
												>
													<div className="min-w-0 flex-1">
														<p className="font-medium text-sm text-[var(--foreground)]">
															{reg.event.title}
														</p>
														<div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
															<span className="flex items-center gap-1">
																<Clock size={12} />
																{formatTime(reg.event.start)} -{" "}
																{formatTime(reg.event.end)}
															</span>
															{reg.event.resourceTitle && (
																<span className="flex items-center gap-1">
																	<MapPin size={12} />
																	{reg.event.resourceTitle}
																</span>
															)}
															<span className="flex items-center gap-1">
																<Users size={12} />
																{reg.event.currentRegistrations}
																{reg.event.maxParticipants !== null
																	? `/${reg.event.maxParticipants}`
																	: ""}
															</span>
														</div>
													</div>
													{isCheckedIn ? (
														<span className="flex items-center gap-1 text-green-600 text-xs font-medium">
															<Check size={16} />
															Checked in
														</span>
													) : (
														<Button
															size="sm"
															onClick={() =>
																handleStaffCheckin(reg.event.eventId)
															}
															disabled={
																staffCheckinMutation.isPending
															}
														>
															<UserCheck size={14} />
															Check in
														</Button>
													)}
												</div>
											);
										})}
									</div>
								)}
							</div>

							{/* Nearby Events */}
							{nearbyEvents.length > 0 && (
								<div className="p-4">
									<h4 className="mb-3 flex items-center gap-2 font-semibold text-sm text-[var(--foreground)]">
										<MapPin size={14} />
										Nearby Events (not registered)
									</h4>
									<div className="space-y-2">
										{nearbyEvents.map((evt) => {
											const isFull =
												evt.maxParticipants !== null &&
												evt.currentRegistrations >=
													evt.maxParticipants;
											const spotsLeft =
												evt.maxParticipants !== null
													? evt.maxParticipants -
														evt.currentRegistrations
													: null;

											return (
												<div
													key={evt.eventId}
													className="flex items-center gap-3 rounded-md border border-[var(--border)] p-3"
												>
													<div className="min-w-0 flex-1">
														<p className="font-medium text-sm text-[var(--foreground)]">
															{evt.title}
														</p>
														<div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
															<span className="flex items-center gap-1">
																<Clock size={12} />
																{formatTime(evt.start)} -{" "}
																{formatTime(evt.end)}
															</span>
															{evt.resourceTitle && (
																<span className="flex items-center gap-1">
																	<MapPin size={12} />
																	{evt.resourceTitle}
																</span>
															)}
															{isFull ? (
																<span className="font-medium text-orange-600">
																	(Full -{" "}
																	{evt.currentRegistrations}/
																	{evt.maxParticipants})
																</span>
															) : spotsLeft !== null ? (
																<span>
																	{spotsLeft} spot
																	{spotsLeft !== 1 ? "s" : ""}{" "}
																	left
																</span>
															) : null}
														</div>
													</div>
													<Button
														size="sm"
														variant="outline"
														onClick={() =>
															handleWalkinCheckin(
																evt,
																memberFullName,
															)
														}
														disabled={
															staffCheckinMutation.isPending
														}
													>
														<UserCheck size={14} />
														Check in (walk-in)
													</Button>
												</div>
											);
										})}
									</div>
								</div>
							)}

							{/* Member Packages */}
							{member && (
								<div className="p-4">
									<MemberPackagesCard
										userId={member.userId}
										memberName={memberFullName}
									/>
								</div>
							)}

							{/* General Check-in */}
							<div className="p-4">
								<Button
									variant="outline"
									className="w-full"
									onClick={() => handleStaffCheckin()}
									disabled={staffCheckinMutation.isPending}
								>
									<UserCheck size={16} />
									General facility check-in
								</Button>
							</div>
						</div>
					) : (
						<div className="flex h-32 items-center justify-center">
							<p className="text-sm text-[var(--muted-foreground)]">
								Member not found
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

