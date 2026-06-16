"use client";

import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/nextjs";
import { Loader2, MapPin, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "~/app/_components/hooks/use-debounced-value";
import { useReturnTo } from "~/app/_components/hooks/use-return-to";
import { ErrorBanner } from "~/app/_components/shared/ErrorBanner";
import {
	type JoinIntent,
	readJoinIntent,
	safeInternalPath,
} from "~/lib/onboardingUrl";
import { api } from "~/trpc/react";

// Minimum characters before we fire the typeahead query
const MIN_QUERY_LEN = 4;

function JoinPageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();

	const clubParamUrl =
		searchParams.get("clubShortName")?.trim().toLowerCase() || null;
	const facilityParamUrl = searchParams.get("facilityId")?.trim() || null;
	const returnToUrl = useReturnTo();

	// A club page hands us its club/facility/next via the sessionStorage stash
	// (Clerk strips the query string from forceRedirectUrl, so a URL deep link
	// can't be relied on). Read it ONCE on mount. `undefined` = not yet read.
	const [intent, setIntent] = useState<JoinIntent | null | undefined>(
		undefined,
	);
	useEffect(() => {
		setIntent(readJoinIntent());
	}, []);

	// Effective prefill values prefer the URL, then fall back to the stash.
	const prefillClub =
		clubParamUrl ?? intent?.clubShortName?.trim().toLowerCase() ?? null;
	const prefillFacility =
		facilityParamUrl ?? intent?.facilityId?.trim() ?? null;
	const returnTo = returnToUrl ?? safeInternalPath(intent?.next);

	const joinClub = api.user.joinClub.useMutation({
		onSuccess: (data) => {
			// First-ever join → finish onboarding at /profile (carry `next` so it
			// forwards there once the profile is complete). Otherwise honor `next`.
			if (data.switched) {
				router.push(
					returnTo
						? `/profile?next=${encodeURIComponent(returnTo)}`
						: "/profile",
				);
			} else {
				router.push(returnTo ?? "/home");
			}
			router.refresh();
		},
	});

	// Membership decides everything: a returning member is forwarded on (never
	// stranded on the search), a membership-less user gets the prefilled search.
	const { data: memberships } = api.user.getClubMemberships.useQuery();
	const forwardedRef = useRef(false);
	useEffect(() => {
		if (forwardedRef.current) return;
		if (intent === undefined || memberships === undefined) return;
		if (memberships.length > 0) {
			forwardedRef.current = true;
			router.replace(returnTo ?? "/home");
		}
	}, [intent, memberships, returnTo, router.replace]);

	// Wait until the stash + membership are resolved (and while a member is being
	// forwarded) so we never flash the search step.
	if (
		intent === undefined ||
		memberships === undefined ||
		memberships.length > 0
	) {
		return <LoadingScreen />;
	}

	return (
		<ClubSearchStep
			initialQuery={prefillClub ?? ""}
			highlightFacilityId={prefillFacility}
			onJoin={(clubShortName, facilityId) =>
				joinClub.mutate({ clubShortName, facilityId })
			}
			isJoining={joinClub.isPending}
			joiningFacilityId={joinClub.variables?.facilityId}
			joinError={joinClub.isError ? joinClub.error.message : null}
		/>
	);
}

function LoadingScreen() {
	return (
		<div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
			<Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
			<p className="mt-4 text-gray-500 text-sm">Loading…</p>
		</div>
	);
}

function ClubSearchStep({
	initialQuery,
	highlightFacilityId,
	onJoin,
	isJoining,
	joiningFacilityId,
	joinError,
}: {
	initialQuery: string;
	highlightFacilityId: string | null;
	onJoin: (clubShortName: string, facilityId: string) => void;
	isJoining: boolean;
	joiningFacilityId: string | undefined;
	joinError: string | null;
}) {
	// Prefilled from the originating club page; the user still picks a facility.
	const [query, setQuery] = useState(initialQuery);
	const debouncedQuery = useDebouncedValue(query.trim(), 300);

	const isSearchReady = debouncedQuery.length >= MIN_QUERY_LEN;

	const {
		data: results,
		isFetching,
		error,
	} = api.user.searchClubs.useQuery(
		{ query: debouncedQuery },
		{ enabled: isSearchReady },
	);

	return (
		<div className="mx-auto max-w-xl px-4 py-16">
			<div className="mb-8 text-center">
				<h1 className="font-bold text-3xl text-gray-900">
					Find your organization
				</h1>
				<p className="mt-2 text-gray-500 text-sm">
					Search by club name or short ID, then pick your location. Results
					appear after {MIN_QUERY_LEN} characters.
				</p>
			</div>

			{/* Search input */}
			<div className="relative mb-6">
				<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-4 w-4 text-gray-400" />
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="e.g. Badminton Ontario or badminton-ontario"
					className="w-full rounded-lg border border-gray-300 py-3 pr-4 pl-10 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
				/>
			</div>

			{/* Status / results */}
			{!isSearchReady && query.length > 0 && (
				<p className="text-center text-gray-400 text-sm">
					Keep typing… ({MIN_QUERY_LEN - query.trim().length} more character
					{MIN_QUERY_LEN - query.trim().length === 1 ? "" : "s"})
				</p>
			)}

			{isSearchReady && isFetching && (
				<p className="text-center text-gray-400 text-sm">Searching…</p>
			)}

			{isSearchReady && error && <ErrorBanner message={error.message} />}

			{isSearchReady && !isFetching && results && results.length === 0 && (
				<p className="text-center text-gray-500 text-sm">
					No clubs found for &ldquo;{debouncedQuery}&rdquo;.
				</p>
			)}

			{isSearchReady && results && results.length > 0 && (
				<div className="space-y-4">
					{results.map((club) => (
						<div
							key={club.clubShortName}
							className="glass-panel overflow-hidden rounded-lg"
						>
							<div className="border-gray-100 border-b px-4 py-3">
								<p className="truncate font-medium text-gray-900 text-sm">
									{club.clubName}
								</p>
								<p className="truncate text-gray-500 text-xs">
									{club.clubShortName}
								</p>
							</div>

							{club.facilities.length === 0 ? (
								<p className="px-4 py-3 text-gray-400 text-xs">
									No locations yet.
								</p>
							) : (
								<div className="divide-y divide-gray-100">
									{club.facilities.map((facility) => {
										const isPending =
											isJoining && joiningFacilityId === facility.facilityId;
										const isHighlighted =
											facility.facilityId === highlightFacilityId;
										const location = [facility.city, facility.state]
											.filter(Boolean)
											.join(", ");
										return (
											<div
												key={facility.facilityId}
												className={`flex items-center justify-between gap-4 px-4 py-3 ${
													isHighlighted ? "bg-[var(--primary)]/5" : ""
												}`}
											>
												<div className="flex min-w-0 items-center gap-3">
													<MapPin
														className={`h-4 w-4 shrink-0 ${
															isHighlighted
																? "text-[var(--primary)]"
																: "text-gray-400"
														}`}
													/>
													<div className="min-w-0">
														<p className="truncate font-medium text-gray-900 text-sm">
															{facility.name}
														</p>
														{location && (
															<p className="truncate text-gray-500 text-xs">
																{location}
															</p>
														)}
													</div>
												</div>
												<button
													type="button"
													disabled={isJoining}
													onClick={() =>
														onJoin(club.clubShortName, facility.facilityId)
													}
													className="shrink-0 rounded-lg bg-[var(--primary)] px-4 py-1.5 font-medium text-white text-xs transition-colors hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
												>
													{isPending ? "Joining…" : "Join"}
												</button>
											</div>
										);
									})}
								</div>
							)}
						</div>
					))}
				</div>
			)}

			{joinError && <ErrorBanner message={joinError} className="mt-4" />}
		</div>
	);
}

export default function JoinPage() {
	return (
		<>
			<SignedOut>
				<RedirectToSignIn />
			</SignedOut>
			<SignedIn>
				<Suspense
					fallback={
						<div className="py-16 text-center text-gray-500">Loading…</div>
					}
				>
					<JoinPageContent />
				</Suspense>
			</SignedIn>
		</>
	);
}
