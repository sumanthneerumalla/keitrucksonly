"use client";

import { Search, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import { Input } from "~/app/_components/shared/Input";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import { api } from "~/trpc/react";

type SearchMember = {
	userId: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	profileImage: string | null;
};

interface AddStudentPopoverProps {
	eventId: string;
	facilityId: string | null;
	onSuccess: () => void;
}

export default function AddStudentPopover({
	eventId,
	facilityId,
	onSuccess,
}: AddStudentPopoverProps) {
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [searchInput, setSearchInput] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [selectedMember, setSelectedMember] = useState<SearchMember | null>(
		null,
	);

	// Debounce search input (300ms)
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(searchInput.trim());
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput]);

	// Reset state when popover closes
	useEffect(() => {
		if (!open) {
			setSearchInput("");
			setDebouncedQuery("");
			setSelectedMember(null);
		}
	}, [open]);

	const { data: searchData, isFetching: isSearching } =
		api.user.searchMembers.useQuery(
			{ query: debouncedQuery, facilityId: facilityId ?? "" },
			{ enabled: !!debouncedQuery && !!facilityId && open },
		);

	const members: SearchMember[] = searchData?.members ?? [];

	const closeAndReset = () => {
		setOpen(false);
	};

	const staffRegisterMutation = api.calendar.staffRegister.useMutation({
		onSuccess: () => {
			toast("Student registered", "success");
			onSuccess();
			closeAndReset();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const staffCheckinMutation = api.checkin.staffCheckin.useMutation({
		onSuccess: (result) => {
			if (result.alreadyCheckedIn) {
				toast("Already checked in", "info");
			} else {
				toast("Student checked in", "success");
			}
			onSuccess();
			closeAndReset();
		},
		onError: (err) => {
			toast(err.message, "error");
		},
	});

	const handleRegister = () => {
		if (!selectedMember) return;
		staffRegisterMutation.mutate({
			eventId,
			userId: selectedMember.userId,
		});
	};

	const handleCheckinNow = () => {
		if (!selectedMember || !facilityId) return;
		staffCheckinMutation.mutate({
			userId: selectedMember.userId,
			eventId,
			facilityId,
		});
	};

	const isPending =
		staffRegisterMutation.isPending || staffCheckinMutation.isPending;

	const selectedName = selectedMember
		? `${selectedMember.firstName ?? ""} ${selectedMember.lastName ?? ""}`.trim() ||
			selectedMember.email ||
			"Selected student"
		: "";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm">
					<UserPlus size={14} />
					Add student
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				{selectedMember ? (
					<div className="space-y-3 p-3">
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0">
								<p className="font-medium text-[var(--foreground)] text-sm">
									{selectedName}
								</p>
								{selectedMember.email && (
									<p className="truncate text-[var(--muted-foreground)] text-xs">
										{selectedMember.email}
									</p>
								)}
							</div>
							<button
								type="button"
								onClick={() => setSelectedMember(null)}
								className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
								aria-label="Change selection"
							>
								<X size={14} />
							</button>
						</div>
						<div className="flex flex-col gap-2">
							<Button size="sm" onClick={handleRegister} disabled={isPending}>
								{staffRegisterMutation.isPending ? "Registering…" : "Register"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={handleCheckinNow}
								disabled={isPending || !facilityId}
								title={
									!facilityId
										? "This event has no facility; walk-in check-in is unavailable."
										: undefined
								}
							>
								{staffCheckinMutation.isPending
									? "Checking in…"
									: "Check in now"}
							</Button>
							{!facilityId && (
								<p className="text-[var(--muted-foreground)] text-xs">
									No facility linked to this event — check-in is disabled.
								</p>
							)}
						</div>
					</div>
				) : (
					<div className="p-3">
						<div className="relative">
							<Search
								size={14}
								className="-translate-y-1/2 absolute top-1/2 left-3 text-[var(--muted-foreground)]"
							/>
							<Input
								autoFocus
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								placeholder="Search by name or email"
								className="h-9 pl-9 text-sm"
							/>
						</div>
						<div className="mt-2 max-h-64 overflow-y-auto">
							{!debouncedQuery ? (
								<p className="p-3 text-[var(--muted-foreground)] text-xs">
									Type a name or email to search.
								</p>
							) : isSearching ? (
								<p className="p-3 text-[var(--muted-foreground)] text-xs">
									Searching…
								</p>
							) : members.length === 0 ? (
								<p className="p-3 text-[var(--muted-foreground)] text-xs">
									No members match "{debouncedQuery}".
								</p>
							) : (
								<ul className="flex flex-col">
									{members.map((m) => {
										const displayName =
											`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() ||
											m.email ||
											"Unnamed";
										return (
											<li key={m.userId}>
												<button
													type="button"
													onClick={() => setSelectedMember(m)}
													className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--accent)]"
												>
													<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-medium text-[var(--primary)] text-xs">
														{m.profileImage ? (
															// eslint-disable-next-line @next/next/no-img-element
															<img
																src={m.profileImage}
																alt=""
																className="h-7 w-7 rounded-full object-cover"
															/>
														) : (
															(m.firstName?.[0] ?? "?").toUpperCase()
														)}
													</div>
													<div className="min-w-0 flex-1">
														<p className="truncate text-[var(--foreground)] text-sm">
															{displayName}
														</p>
														{m.email && (
															<p className="truncate text-[var(--muted-foreground)] text-xs">
																{m.email}
															</p>
														)}
													</div>
												</button>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
