"use client";

import { MoreVertical, Package, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import SellPackageModal from "~/app/(app)/admin/checkin/SellPackageModal";
import AddStudentPopover from "~/app/(app)/events/[eventId]/AddStudentPopover";
import { Button } from "~/app/_components/shared/Button";
import { useToast } from "~/app/_components/shared/Toast";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/app/_components/shared/ui/popover";
import { api } from "~/trpc/react";

/** Per-status pill styling + display. Terminal = a final outcome (no-show / cancelled). */
const STATUS_META: Record<
	string,
	{ label: string; cls: string; terminal: boolean; rank: number }
> = {
	REGISTERED: {
		label: "Registered",
		cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
		terminal: false,
		rank: 0,
	},
	CHECKED_IN: {
		label: "Checked in",
		cls: "bg-green-100 text-green-700",
		terminal: false,
		rank: 1,
	},
	NO_SHOW: {
		label: "No-show",
		cls: "bg-red-100 text-red-700",
		terminal: true,
		rank: 2,
	},
	LATE_CANCEL: {
		label: "Cancelled",
		cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
		terminal: true,
		rank: 3,
	},
	EARLY_CANCEL: {
		label: "Cancelled",
		cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
		terminal: true,
		rank: 3,
	},
};

/**
 * Staff roster for an event. Self-contained: fetches `getEventRegistrations` and
 * owns the sell-package modal. Render only for staff.
 * - `canManage` (facility/admin): add student, sell package, link to client,
 *   mark no-show / cancel, see greyed-out inactive (no-show/cancelled) rows.
 * - `canCheckIn` (facility/admin, or a coach on their own event): check members in.
 * Terminal rows are read-only (the registration backend has no undo — credit-aware
 * reinstate is a follow-up).
 */
export default function EventRoster({
	eventId,
	facilityId,
	maxParticipants,
	canManage,
	canCheckIn,
}: {
	eventId: string;
	facilityId: string | null;
	maxParticipants: number | null;
	canManage: boolean;
	canCheckIn: boolean;
}) {
	const { toast } = useToast();
	const utils = api.useUtils();
	const { data: rosterData } = api.calendar.getEventRegistrations.useQuery({
		eventId,
		includeInactive: canManage,
	});
	const [sellPackageTarget, setSellPackageTarget] = useState<{
		userId: string;
		memberName: string;
	} | null>(null);
	const [bulkPending, setBulkPending] = useState(false);

	const updateStatus = api.calendar.updateRegistrationStatus.useMutation({
		onSuccess: () => {
			void utils.calendar.getEventRegistrations.invalidate({ eventId });
			void utils.calendar.getPublicEventById.invalidate({ eventId });
		},
		onError: (e) => toast(e.message, "error"),
	});

	const rows = [...(rosterData?.registrations ?? [])].sort(
		(a, b) =>
			(STATUS_META[a.status]?.rank ?? 9) - (STATUS_META[b.status]?.rank ?? 9),
	);
	const activeCount = rows.filter(
		(r) => r.status === "REGISTERED" || r.status === "CHECKED_IN",
	).length;
	const checkedInCount = rows.filter((r) => r.status === "CHECKED_IN").length;
	const registeredRows = rows.filter((r) => r.status === "REGISTERED");

	const checkInAll = async () => {
		setBulkPending(true);
		try {
			for (const r of registeredRows) {
				await updateStatus.mutateAsync({
					registrationId: r.registrationId,
					action: "CHECK_IN",
				});
			}
		} finally {
			setBulkPending(false);
		}
	};

	return (
		<div className="glass-card space-y-3 rounded-lg p-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Users size={16} className="text-[var(--muted-foreground)]" />
					<h3 className="font-medium text-[var(--foreground)] text-sm">
						Registered ({activeCount}
						{maxParticipants !== null ? ` / ${maxParticipants}` : ""})
					</h3>
					{activeCount > 0 && (
						<span className="text-[var(--muted-foreground)] text-xs">
							· {checkedInCount}/{activeCount} checked in
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{canCheckIn && registeredRows.length > 0 && (
						<Button
							variant="outline"
							size="sm"
							disabled={bulkPending}
							onClick={checkInAll}
						>
							{bulkPending ? "Checking in…" : "Check in all"}
						</Button>
					)}
					{canManage && (
						<AddStudentPopover
							eventId={eventId}
							facilityId={facilityId}
							onSuccess={() => {
								void utils.calendar.getEventRegistrations.invalidate({
									eventId,
								});
								void utils.calendar.getPublicEventById.invalidate({ eventId });
							}}
						/>
					)}
				</div>
			</div>

			{!rosterData ? (
				<p className="text-[var(--muted-foreground)] text-xs">Loading…</p>
			) : rows.length === 0 ? (
				<p className="text-[var(--muted-foreground)] text-xs">
					No registrations yet.
				</p>
			) : (
				<ul className="space-y-1.5">
					{rows.map((r) => {
						const meta = STATUS_META[r.status] ?? {
							label: r.status,
							cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
							terminal: false,
							rank: 9,
						};
						const displayName = `${r.firstName ?? ""} ${
							r.lastName ?? r.lastInitial ?? ""
						}`.trim();
						const nameContent = (
							<>
								<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-medium text-[var(--primary)] text-xs">
									{r.firstName?.[0] ?? "?"}
								</div>
								<span className={meta.terminal ? "line-through" : ""}>
									{r.firstName} {r.lastName ?? r.lastInitial}
								</span>
							</>
						);
						return (
							<li
								key={r.registrationId}
								className={`flex items-center justify-between gap-2 text-sm ${
									meta.terminal
										? "text-[var(--muted-foreground)]"
										: "text-[var(--foreground)]"
								}`}
							>
								{canManage && !meta.terminal ? (
									<Link
										href={`/clients/${r.userId}`}
										className="flex min-w-0 flex-1 items-center gap-2.5 transition-colors hover:text-[var(--primary)] hover:underline"
									>
										{nameContent}
									</Link>
								) : (
									<div className="flex min-w-0 flex-1 items-center gap-2.5">
										{nameContent}
									</div>
								)}

								<div className="flex shrink-0 items-center gap-1.5">
									<span
										className={`rounded-full px-2 py-0.5 font-medium text-[11px] ${meta.cls}`}
									>
										{meta.label}
									</span>

									{r.status === "REGISTERED" && canCheckIn && (
										<Button
											size="sm"
											disabled={updateStatus.isPending}
											onClick={() =>
												updateStatus.mutate({
													registrationId: r.registrationId,
													action: "CHECK_IN",
												})
											}
										>
											Check in
										</Button>
									)}

									{r.status === "REGISTERED" && canManage && (
										<Popover>
											<PopoverTrigger asChild>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 text-[var(--muted-foreground)]"
													aria-label={`More actions for ${displayName}`}
												>
													<MoreVertical size={14} />
												</Button>
											</PopoverTrigger>
											<PopoverContent className="w-44 p-1" align="end">
												<button
													type="button"
													className="block w-full rounded px-2 py-1.5 text-left text-[var(--foreground)] text-sm hover:bg-[var(--muted)]"
													onClick={() =>
														updateStatus.mutate({
															registrationId: r.registrationId,
															action: "NO_SHOW",
														})
													}
												>
													Mark no-show
												</button>
												<button
													type="button"
													className="block w-full rounded px-2 py-1.5 text-left text-red-600 text-sm hover:bg-red-50"
													onClick={() =>
														updateStatus.mutate({
															registrationId: r.registrationId,
															action: "CANCEL",
														})
													}
												>
													Cancel registration
												</button>
											</PopoverContent>
										</Popover>
									)}

									{canManage && !meta.terminal && (
										<Button
											variant="ghost"
											size="icon"
											title="Sell package"
											aria-label={`Sell package to ${displayName}`}
											className="h-8 w-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
											onClick={() =>
												setSellPackageTarget({
													userId: r.userId,
													memberName: displayName,
												})
											}
										>
											<Package size={14} />
										</Button>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			)}
			{sellPackageTarget && (
				<SellPackageModal
					userId={sellPackageTarget.userId}
					memberName={sellPackageTarget.memberName}
					onClose={() => setSellPackageTarget(null)}
				/>
			)}
		</div>
	);
}
