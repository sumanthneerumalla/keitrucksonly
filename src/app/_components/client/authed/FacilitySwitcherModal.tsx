"use client";

import { Building2, Check } from "lucide-react";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/app/_components/shared/dialog";
import { api } from "~/trpc/react";

interface FacilitySwitcherModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export default function FacilitySwitcherModal({
	open,
	onOpenChange,
}: FacilitySwitcherModalProps) {
	const utils = api.useUtils();

	// Use the global 30s staleTime — if nothing has changed since the last open
	// (no invalidation), the cache is reused and the modal opens instantly with
	// no server hit. When a club switch elsewhere calls utils.invalidate(),
	// TanStack marks this query stale, and the next time the modal opens the
	// observer transitions from disabled → enabled with stale data → refetch.
	// The `!isFetching && ...` guard below ensures we never render the briefly-
	// stale cached data during that refetch — the skeleton shows instead.
	const { data: memberships, isFetching } =
		api.user.getFacilityMemberships.useQuery(undefined, { enabled: open });

	const switchFacility = api.user.switchFacility.useMutation({
		onSuccess: () => {
			void utils.user.getOrCreateProfile.invalidate();
			void utils.user.getFacilityMemberships.invalidate();
			void utils.calendar.getEvents.invalidate();
			onOpenChange(false);
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>Switch Facility</DialogTitle>
					<DialogDescription>
						Select a facility to view its calendar and resources.
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-1">
					{isFetching && (
						<div className="animate-pulse space-y-2">
							<div className="h-10 rounded bg-gray-100" />
							<div className="h-10 rounded bg-gray-100" />
						</div>
					)}

					{!isFetching && memberships?.map((m) => (
						<button
							key={m.facilityId}
							onClick={() => {
								if (!m.isActive) {
									switchFacility.mutate({ facilityId: m.facilityId });
								}
							}}
							disabled={switchFacility.isPending}
							className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
								m.isActive
									? "bg-[var(--accent)] font-medium text-[var(--foreground)]"
									: "text-gray-700 hover:bg-[var(--accent)]"
							}`}
						>
							<Building2
								size={16}
								className="shrink-0 text-[var(--muted-foreground)]"
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium">{m.facilityName}</p>
								{m.location && (
									<p className="truncate text-[var(--muted-foreground)] text-xs">
										{m.location}
									</p>
								)}
								<p className="text-[var(--muted-foreground)] text-xs">
									{m.role.charAt(0) + m.role.slice(1).toLowerCase()}
								</p>
							</div>
							{m.isActive && (
								<Check size={16} className="shrink-0 text-[var(--primary)]" />
							)}
						</button>
					))}

					{!isFetching && memberships?.length === 0 && (
						<p className="py-4 text-center text-[var(--muted-foreground)] text-sm">
							No facilities available.
						</p>
					)}

					{switchFacility.error && (
						<p className="text-red-500 text-xs">
							{switchFacility.error.message}
						</p>
					)}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
