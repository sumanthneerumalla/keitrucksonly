"use client";

import { Package, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import SellPackageModal from "~/app/(app)/admin/checkin/SellPackageModal";
import AddStudentPopover from "~/app/(app)/events/[eventId]/AddStudentPopover";
import { Button } from "~/app/_components/shared/Button";
import { api } from "~/trpc/react";

/**
 * Staff roster of confirmed registrations for an event. Self-contained: fetches
 * `calendar.getEventRegistrations` and owns the sell-package modal. Render it only
 * for staff (facility/admin/coach). `canManage` (facility/admin) gates add-student,
 * sell-package, and the link to the member's client page; coaches see it read-only.
 */
export default function EventRoster({
	eventId,
	facilityId,
	maxParticipants,
	canManage,
}: {
	eventId: string;
	facilityId: string | null;
	maxParticipants: number | null;
	canManage: boolean;
}) {
	const utils = api.useUtils();
	const { data: rosterData } = api.calendar.getEventRegistrations.useQuery({
		eventId,
	});
	const [sellPackageTarget, setSellPackageTarget] = useState<{
		userId: string;
		memberName: string;
	} | null>(null);

	return (
		<div className="glass-card space-y-3 rounded-lg p-5">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Users size={16} className="text-[var(--muted-foreground)]" />
					<h3 className="font-medium text-[var(--foreground)] text-sm">
						Registered ({rosterData?.registrations.length ?? 0}
						{maxParticipants !== null ? ` / ${maxParticipants}` : ""})
					</h3>
				</div>
				{canManage && (
					<AddStudentPopover
						eventId={eventId}
						facilityId={facilityId}
						onSuccess={() => {
							void utils.calendar.getEventRegistrations.invalidate({ eventId });
							void utils.calendar.getPublicEventById.invalidate({ eventId });
						}}
					/>
				)}
			</div>
			{!rosterData ? (
				<p className="text-[var(--muted-foreground)] text-xs">Loading…</p>
			) : rosterData.registrations.length === 0 ? (
				<p className="text-[var(--muted-foreground)] text-xs">
					No confirmed registrations yet.
				</p>
			) : (
				<ul className="space-y-1.5">
					{rosterData.registrations.map((r) => {
						const displayName = `${r.firstName ?? ""} ${
							r.lastName ?? r.lastInitial ?? ""
						}`.trim();
						const nameContent = (
							<>
								<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-medium text-[var(--primary)] text-xs">
									{r.firstName?.[0] ?? "?"}
								</div>
								<span>
									{r.firstName} {r.lastName ?? r.lastInitial}
								</span>
							</>
						);
						return (
							<li
								key={r.registrationId}
								className="flex items-center justify-between gap-2 text-[var(--foreground)] text-sm"
							>
								{canManage ? (
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
								{canManage && (
									<Button
										variant="ghost"
										size="icon"
										title="Sell package"
										aria-label={`Sell package to ${displayName}`}
										className="h-8 w-8 shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
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
