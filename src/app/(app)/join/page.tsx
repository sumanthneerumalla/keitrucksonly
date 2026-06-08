"use client";

import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowLeft, MapPin, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "~/app/_components/shared/ErrorBanner";
import { api } from "~/trpc/react";

// Minimum characters before we fire the typeahead query
const MIN_QUERY_LEN = 4;

type SelectedClub = { clubShortName: string; clubName?: string };

function JoinPageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();

	// Two-step flow: pick a club (search) → pick a facility within it.
	const [selectedClub, setSelectedClub] = useState<SelectedClub | null>(null);

	// Pre-select a club when arriving from a club landing page (?clubShortName=),
	// jumping straight to the facility picker.
	const preselectApplied = useRef(false);
	useEffect(() => {
		if (preselectApplied.current) return;
		const fromUrl = searchParams.get("clubShortName");
		if (fromUrl) {
			preselectApplied.current = true;
			setSelectedClub({ clubShortName: fromUrl.trim().toLowerCase() });
		}
	}, [searchParams]);

	const joinClub = api.user.joinClub.useMutation({
		onSuccess: (data) => {
			// First-time joiners continue onboarding at /profile; existing users
			// adding another club go back to the dashboard.
			router.push(data.switched ? "/profile" : "/dashboard");
			router.refresh();
		},
	});

	if (selectedClub) {
		return (
			<FacilityStep
				club={selectedClub}
				onBack={() => setSelectedClub(null)}
				onJoin={(facilityId) =>
					joinClub.mutate({
						clubShortName: selectedClub.clubShortName,
						facilityId,
					})
				}
				isJoining={joinClub.isPending}
				joiningFacilityId={joinClub.variables?.facilityId}
				joinError={joinClub.isError ? joinClub.error.message : null}
			/>
		);
	}

	return <ClubSearchStep onSelect={setSelectedClub} />;
}

function ClubSearchStep({
	onSelect,
}: {
	onSelect: (club: SelectedClub) => void;
}) {
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Debounce the query so we don't fire on every keystroke
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			setDebouncedQuery(query.trim());
		}, 300);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [query]);

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
					Search by club name or short ID. Results appear after {MIN_QUERY_LEN}{" "}
					characters.
				</p>
			</div>

			{/* Search input */}
			<div className="relative mb-6">
				<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-4 w-4 text-gray-400" />
				<input
					type="text"
					autoFocus
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
				<div className="glass-panel divide-y divide-gray-100 overflow-hidden rounded-lg">
					{results.map((club) => (
						<button
							key={club.clubShortName}
							type="button"
							onClick={() =>
								onSelect({
									clubShortName: club.clubShortName,
									clubName: club.clubName,
								})
							}
							className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-gray-50"
						>
							<div className="min-w-0">
								<p className="truncate font-medium text-gray-900 text-sm">
									{club.clubName}
								</p>
								<p className="truncate text-gray-500 text-xs">
									{club.clubShortName}
								</p>
							</div>
							<span className="shrink-0 font-medium text-[var(--primary)] text-xs">
								Select →
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function FacilityStep({
	club,
	onBack,
	onJoin,
	isJoining,
	joiningFacilityId,
	joinError,
}: {
	club: SelectedClub;
	onBack: () => void;
	onJoin: (facilityId: string) => void;
	isJoining: boolean;
	joiningFacilityId: string | undefined;
	joinError: string | null;
}) {
	const {
		data: facilities,
		isLoading,
		error,
	} = api.user.listClubFacilities.useQuery({
		clubShortName: club.clubShortName,
	});

	return (
		<div className="mx-auto max-w-xl px-4 py-16">
			<button
				type="button"
				onClick={onBack}
				className="mb-6 inline-flex items-center gap-1 text-gray-500 text-sm transition-colors hover:text-gray-700"
			>
				<ArrowLeft className="h-4 w-4" /> Back to search
			</button>

			<div className="mb-8 text-center">
				<h1 className="font-bold text-3xl text-gray-900">
					Choose your location
				</h1>
				<p className="mt-2 text-gray-500 text-sm">
					{club.clubName ?? club.clubShortName}
				</p>
			</div>

			{isLoading && (
				<p className="text-center text-gray-400 text-sm">Loading locations…</p>
			)}

			{error && <ErrorBanner message={error.message} />}

			{!isLoading && facilities && facilities.length === 0 && (
				<p className="text-center text-gray-500 text-sm">
					This club has no locations yet. Please try another organization.
				</p>
			)}

			{facilities && facilities.length > 0 && (
				<div className="glass-panel divide-y divide-gray-100 overflow-hidden rounded-lg">
					{facilities.map((facility) => {
						const isPending =
							isJoining && joiningFacilityId === facility.facilityId;
						const location = [facility.city, facility.state]
							.filter(Boolean)
							.join(", ");
						return (
							<div
								key={facility.facilityId}
								className="flex items-center justify-between gap-4 px-4 py-3"
							>
								<div className="flex min-w-0 items-center gap-3">
									<MapPin className="h-4 w-4 shrink-0 text-gray-400" />
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
									onClick={() => onJoin(facility.facilityId)}
									className="shrink-0 rounded-lg bg-[var(--primary)] px-4 py-1.5 font-medium text-white text-xs transition-colors hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
								>
									{isPending ? "Joining…" : "Join"}
								</button>
							</div>
						);
					})}
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
