import { auth } from "@clerk/nextjs/server";
import type { User } from "@prisma/client";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { isOnboardedUser, isPlatformAdmin } from "~/lib/utils";
import { db } from "~/server/db";

export async function getOnboardedUserOrRedirect({
	unauthenticatedRedirectTo = "/",
	incompleteProfileRedirectTo = "/profile",
	clubRequiredRedirectTo = "/join",
}: {
	unauthenticatedRedirectTo?: string;
	incompleteProfileRedirectTo?: string;
	clubRequiredRedirectTo?: string;
} = {}): Promise<User> {
	const session = await auth();

	if (!session?.userId) {
		redirect(unauthenticatedRedirectTo);
	}

	const user = await db.user.findUnique({
		where: { clerkUserId: session.userId },
	});

	if (!user) {
		redirect(incompleteProfileRedirectTo);
	}

	// Club gate — runs BEFORE the profile check (club/facility first, then profile).
	// The signal for "hasn't picked an organization yet" is having zero UserClub
	// rows: a brand-new user is created with a placeholder club but no memberships
	// and is sent to /join to find their club + facility. Platform admins operate
	// on the placeholder club and are exempt.
	if (!isPlatformAdmin(user)) {
		const membershipCount = await db.userClub.count({
			where: { userId: user.userId },
		});
		if (membershipCount === 0) {
			redirect(clubRequiredRedirectTo);
		}
	}

	if (!isOnboardedUser(user)) {
		redirect(incompleteProfileRedirectTo);
	}

	return user;
}

export async function OnboardedGuard({
	children,
	unauthenticatedRedirectTo = "/",
	incompleteProfileRedirectTo = "/profile",
	clubRequiredRedirectTo = "/join",
}: {
	children: ReactNode;
	unauthenticatedRedirectTo?: string;
	incompleteProfileRedirectTo?: string;
	clubRequiredRedirectTo?: string;
}) {
	await getOnboardedUserOrRedirect({
		unauthenticatedRedirectTo,
		incompleteProfileRedirectTo,
		clubRequiredRedirectTo,
	});

	return <>{children}</>;
}
