"use client";

import { useAuth } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { stashJoinIntent } from "~/lib/onboardingUrl";

/**
 * Club-belonging pages call this to "hand" their club/facility to the sign-in
 * funnel. For logged-out viewers it stashes {clubShortName, facilityId, next:
 * this page} in sessionStorage, so ANY sign-in button (the global nav button
 * included) lands the new user on /join with the club pre-searched and the
 * facility pre-highlighted — then back to this page once onboarded.
 *
 * Safe to leave stale: /join only PRE-FILLS the search (the user still picks),
 * so a last-viewed club just shows an editable prefilled search, never an
 * unwanted auto-join.
 */
export function useStashJoinIntent(ctx: {
	clubShortName?: string | null;
	facilityId?: string | null;
	/** Return-to path; defaults to the current pathname. Pass an explicit value
	 * when the query string matters (e.g. /rentals?club=&facility=). */
	next?: string;
}): void {
	const { isSignedIn } = useAuth();
	const pathname = usePathname();
	const { clubShortName, facilityId, next } = ctx;
	useEffect(() => {
		if (isSignedIn !== false) return; // only logged-out viewers
		if (!clubShortName) return;
		stashJoinIntent({
			clubShortName,
			facilityId: facilityId ?? null,
			next: next ?? pathname,
		});
	}, [isSignedIn, clubShortName, facilityId, next, pathname]);
}
