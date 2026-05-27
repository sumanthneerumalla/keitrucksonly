"use client";

import { UserButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SidebarTrigger } from "~/app/_components/shared/ui/sidebar";

const PAGE_TITLES: Record<string, string> = {
	"/home": "Home",
	"/dashboard": "Dashboard",
	"/calendar": "Calendar",
	"/products": "Products",
	"/profile": "Profile",
	"/coaches": "Browse Coaches",
	"/video-collections": "My Collections",
	"/video-collections/create": "Create New",
	"/admin/collections": "All Collections",
	"/clients": "Clients",
	"/admin/facilities": "Facilities",
	"/database": "Database",
};

function resolvePageTitle(pathname: string): string {
	if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]!;
	if (pathname.startsWith("/video-collections/")) return "Video Collection";
	if (pathname.startsWith("/coaches/")) return "Coach Profile";
	if (pathname.startsWith("/clients/")) return "Client";
	if (pathname.startsWith("/admin/")) return "Admin";
	return "Facility Presence";
}

interface MobileAuthedHeaderProps {
	user: { userType: string; clubShortName: string } | null | undefined;
	isLoading: boolean;
}

// TODO(mobile): Use `user` for role-based mobile header (e.g. coach vs student badges, admin indicator)
export default function MobileAuthedHeader({
	user: _user,
	isLoading: _isLoading,
}: MobileAuthedHeaderProps) {
	const pathname = usePathname();
	const pageTitle = resolvePageTitle(pathname);

	// Clerk's <UserButton /> SSRs a placeholder then swaps to the real button
	// once clerk.js loads client-side; if that load wins the race against
	// hydration, the server/client HTML diverges. Defer it to client mount
	// (same pattern as NavBar) so the first render matches on both sides.
	// A same-size placeholder reserves the slot to avoid layout shift.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	return (
		<div className="flex h-14 items-center justify-between border-gray-200 border-b bg-white px-4 md:hidden">
			{/* Hamburger — toggles SidebarProvider openMobile, which opens the Sidebar Sheet */}
			<SidebarTrigger />

			{/* Page title */}
			<span className="font-semibold text-gray-800 text-sm">{pageTitle}</span>

			{/* User menu — client-only to avoid Clerk hydration mismatch */}
			{mounted ? (
				<UserButton />
			) : (
				<div className="h-7 w-7" aria-hidden="true" />
			)}
		</div>
	);
}
