"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { UpcomingEventsCard } from "~/app/(app)/home/UpcomingEventsCard";
import { api } from "~/trpc/react";

/**
 * Public club landing widget: a facility switcher + the upcoming-events list.
 *
 * The selected facility lives in the `?facility=<facilityId>` query param so a
 * filtered view is shareable/bookmarkable (no extra routing, no slug column).
 * The switcher only appears for clubs with 2+ active facilities; single-facility
 * clubs just see all of their upcoming events.
 */
function ClubUpcomingEventsInner({ clubShortName }: { clubShortName: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const { data: facilities } = api.calendar.getPublicFacilities.useQuery({
		clubShortName,
	});

	const facilityParam = searchParams.get("facility");
	// Only honor a facility id that actually belongs to this club; anything else
	// (stale link, deleted facility) falls back to the "All locations" view.
	const selectedFacilityId = facilities?.some(
		(f) => f.facilityId === facilityParam,
	)
		? facilityParam
		: null;

	const setFacility = (facilityId: string | null) => {
		const params = new URLSearchParams(searchParams.toString());
		if (facilityId) params.set("facility", facilityId);
		else params.delete("facility");
		const qs = params.toString();
		// Shallow-ish update — no scroll jump, just swaps the filtered data.
		router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
	};

	const showSwitcher = (facilities?.length ?? 0) > 1;

	return (
		<div className="mx-auto w-full max-w-2xl px-6 pt-2 pb-4">
			{showSwitcher && facilities && (
				<div className="mb-3 flex flex-wrap gap-2">
					<FacilityPill
						label="All locations"
						active={selectedFacilityId === null}
						onClick={() => setFacility(null)}
					/>
					{facilities.map((f) => (
						<FacilityPill
							key={f.facilityId}
							label={f.facilityName}
							active={selectedFacilityId === f.facilityId}
							onClick={() => setFacility(f.facilityId)}
						/>
					))}
				</div>
			)}

			<UpcomingEventsCard
				clubShortName={clubShortName}
				facilityId={selectedFacilityId ?? undefined}
			/>
		</div>
	);
}

function FacilityPill({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`rounded-full border px-3 py-1.5 font-medium text-sm transition-colors ${
				active
					? "border-[var(--primary)] bg-[var(--primary)] text-white"
					: "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
			}`}
		>
			{label}
		</button>
	);
}

export function ClubUpcomingEvents({
	clubShortName,
}: {
	clubShortName: string;
}) {
	// useSearchParams requires a Suspense boundary for static rendering.
	return (
		<Suspense>
			<ClubUpcomingEventsInner clubShortName={clubShortName} />
		</Suspense>
	);
}
