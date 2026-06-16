"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { buildJoinUrl } from "~/lib/onboardingUrl";
import { api } from "~/trpc/react";

/**
 * Phase 16 — the "Join Our Club" hero CTA. Rendered client-side so the
 * landing page itself stays statically cached (ISR): the cached HTML always
 * includes the Join button (correct for logged-out prospects + crawlers), and
 * this component hides it after hydration ONLY when the signed-in viewer is
 * already a member of this club.
 */
export function JoinClubButton({
	clubShortName,
	className,
}: {
	clubShortName: string;
	className?: string;
}) {
	const { isSignedIn } = useAuth();
	const { data } = api.clubs.amIMember.useQuery(
		{ clubShortName },
		{ enabled: !!isSignedIn, staleTime: 1000 * 60 * 5, retry: false },
	);

	// Hide only once we've confirmed membership; default to showing Join.
	if (data?.isMember) return null;

	return (
		<Link href={buildJoinUrl({ clubShortName })} className={className}>
			Join Our Club
		</Link>
	);
}
