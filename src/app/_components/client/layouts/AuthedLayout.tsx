"use client";

import { useAuth } from "@clerk/nextjs";
import { UserType } from "@prisma/client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import MobileAuthedHeader from "~/app/_components/client/authed/MobileAuthedHeader";
import SideNavigation from "~/app/_components/client/authed/SideNavigation";
import { NavBar } from "~/app/_components/client/public/NavBar";
import { Strip } from "~/app/_components/client/public/Strip";
import { SidebarProvider } from "~/app/_components/shared/ui/sidebar";
import { matchClubShortUrlPathname } from "~/lib/clubLanding";
import { api } from "~/trpc/react";

// User types that get the sidebar on event detail pages so they can navigate
// to other admin areas while reviewing an event. Students and unauthenticated
// visitors still see the public-style page (no sidebar) — events are often
// surfaced via shareable links and shouldn't feel like an admin chrome to them.
const EVENT_PAGE_SIDEBAR_TYPES: UserType[] = [
	UserType.COACH,
	UserType.FACILITY,
	UserType.CLUB_ADMIN,
	UserType.PLATFORM_ADMIN,
];

interface AuthedLayoutProps {
	children: ReactNode;
	// Server-fetched user (userType + clubShortName) used as the first-paint
	// fallback so the sidebar/public chrome decision is correct before the
	// client tRPC query resolves — eliminates the post-hydration flicker.
	initialUser: { userType: UserType; clubShortName: string } | null;
}

export default function AuthedLayout({
	children,
	initialUser,
}: AuthedLayoutProps) {
	const pathname = usePathname();
	const { isSignedIn, isLoaded } = useAuth();
	const { data: queryUser, isLoading } = api.user.getOrCreateProfile.useQuery(
		undefined,
		{
			enabled: isLoaded && isSignedIn,
			staleTime: 1000 * 60 * 5,
			retry: false,
		},
	);
	// Prefer the live query (reflects client-side mutations like club switches);
	// fall back to the server-provided user for the very first render so chrome
	// decisions don't flicker. Both expose userType + clubShortName, which is all
	// the layout and SideNavigation need.
	const user = queryUser ?? initialUser ?? undefined;
	// Only show the sidebar's loading skeleton when we have no user at all.
	// With a server-provided initialUser the nav can render immediately.
	const sidebarLoading = isLoading && !user;

	// Decide page chrome (public/no-sidebar vs. authed/sidebar).
	//
	// Club pages are reachable via the canonical /club/<short>/... path AND via a
	// short URL (e.g. /pioneer-badminton) that the middleware rewrites to
	// /club/<short>. That rewrite is server-side and invisible to usePathname(),
	// which still reports the browser path — so matching only "/club/" here would
	// let the authed sidebar render over the public club page. We reuse
	// matchClubShortUrlPathname (the same pure matcher the middleware uses) so the
	// two can never drift.
	//
	// Note: /rentals is public for unauthenticated visitors (no sidebar) but
	// authenticated users see the sidebar so they can navigate elsewhere after booking.
	// /events/* has the same dual treatment: public-style for students and
	// unauthenticated visitors (the page is shareable), sidebar for admin-like
	// roles (COACH, FACILITY, CLUB_ADMIN, PLATFORM_ADMIN) who manage events.
	const clubShortMatch = matchClubShortUrlPathname(pathname);
	const isClubPage = pathname.startsWith("/club/") || clubShortMatch !== null;
	const isRentalsPage = pathname.startsWith("/rentals");
	const isEventsPage = pathname.startsWith("/events/");
	const eventSidebarUser =
		!!user && EVENT_PAGE_SIDEBAR_TYPES.includes(user.userType);
	const isPublicPage =
		pathname === "/" ||
		pathname === "/features" ||
		pathname === "/pricing" ||
		pathname.startsWith("/resources") ||
		isClubPage ||
		(isEventsPage && !eventSidebarUser) ||
		(isRentalsPage && !isSignedIn);

	// Extract clubShortName from pathname for club landing pages.
	// This is passed to NavBar so its SignIn/SignUp buttons can include
	// forceRedirectUrl="/profile?joinClub={clubShortName}" for automatic
	// club assignment after Clerk authentication.
	//
	// Note: This extraction duplicates logic in /club/[clubShortName]/page.tsx
	// because Next.js layouts cannot pass props to page children directly.
	// The layout handles NavBar, while the page handles Hero/CTA components.
	let clubShortName: string | undefined;
	if (pathname.startsWith("/club/")) {
		// /club/[clubShortName] or /club/[clubShortName]/... format
		const match = pathname.match(/^\/club\/([^/]+)/);
		clubShortName = match?.[1];
	} else {
		// Short URL form (e.g. /pioneer-badminton) — reuse the matcher result.
		clubShortName = clubShortMatch?.shortname;
	}

	// Marketing pages render the announcement strip above the NavBar so it lives
	// in document flow (not behind a fixed header). NavBar uses sticky positioning
	// so it pins after the user scrolls past the strip.
	const isMarketingPage =
		pathname === "/" ||
		pathname === "/features" ||
		pathname === "/pricing" ||
		isClubPage;

	return (
		<>
			{isMarketingPage ? <Strip /> : null}
			<NavBar clubShortName={clubShortName} />
			{isPublicPage ? (
				// On public pages, just show content without sidebar
				<div className="min-h-screen">{children}</div>
			) : (
				// On authenticated pages, show sidebar layout
				<SidebarProvider>
					<div className="flex min-h-screen w-full">
						{/* Sidebar — renders as sticky panel on desktop, Sheet on mobile */}
						<div className="sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 md:flex">
							<SideNavigation
								user={user}
								isLoading={sidebarLoading}
								collapsible="none"
							/>
						</div>
						{/* Mobile-only sidebar (Sheet) — always in DOM for SidebarTrigger to work */}
						<div className="md:hidden">
							<SideNavigation user={user} isLoading={sidebarLoading} />
						</div>

						{/* Main Content — gate on Clerk loaded to prevent mutations before auth is ready */}
						<div className="min-w-0 flex-1">
							{/* Mobile header with hamburger — hidden on desktop */}
							<MobileAuthedHeader user={user} isLoading={isLoading} />
							{!isLoaded ? (
								<div className="flex h-[calc(100vh-5rem)] items-center justify-center">
									<p className="text-[var(--muted-foreground)] text-sm">
										Loading...
									</p>
								</div>
							) : (
								children
							)}
						</div>
					</div>
				</SidebarProvider>
			)}
		</>
	);
}
