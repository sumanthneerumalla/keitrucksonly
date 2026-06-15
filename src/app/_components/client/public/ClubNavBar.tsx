"use client";

import {
	SignInButton,
	SignUpButton,
	SignedIn,
	SignedOut,
	UserButton,
} from "@clerk/nextjs";
import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
	NavigationMenu,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
} from "~/app/_components/shared/navigation-menu";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "~/app/_components/shared/ui/sheet";
import { CONTENT_IMAGE_URL } from "~/lib/article";
import { buildJoinUrl } from "~/lib/onboardingUrl";
import { api } from "~/trpc/react";

interface ClubNavBarProps {
	clubShortName: string;
}

export function ClubNavBar({ clubShortName }: ClubNavBarProps) {
	// Club pages pre-target their club in the /join funnel after auth.
	const redirectUrl = buildJoinUrl({ clubShortName });
	const [mounted, setMounted] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	useEffect(() => setMounted(true), []);

	const { data } = api.clubs.getPublicBranding.useQuery(
		{ clubShortName },
		{ staleTime: 1000 * 60 * 5 },
	);

	const base = `/club/${clubShortName}`;
	const brandLabel = data?.club.clubName ?? clubShortName;
	const logoImageId = data?.club.logoImageId ?? null;

	const navLinks = [
		{ href: `${base}/calendar`, label: "Calendar" },
		{ href: `${base}/articles`, label: "Articles" },
		{ href: `${base}/announcements`, label: "Announcements" },
		{ href: `${base}#about`, label: "About" },
	];

	const brand = logoImageId ? (
		// biome-ignore lint/performance/noImgElement: arbitrary remote ContentImage via /api/content-image — Next/Image not applicable
		<img
			src={CONTENT_IMAGE_URL(logoImageId)}
			alt={brandLabel}
			className="h-9 w-auto object-contain"
		/>
	) : (
		<span className="font-bold text-[var(--primary)] text-xl">
			{brandLabel}
		</span>
	);

	return (
		<header className="sticky top-0 right-0 left-0 z-40 border-[var(--line)]/60 border-b bg-[var(--paper)]/80 backdrop-blur-lg">
			<div className="container mx-auto px-4">
				<div className="flex h-16 items-center justify-between">
					{/* Logo / club name */}
					<Link href={base} className="flex items-center space-x-2">
						{brand}
					</Link>

					{/* Mobile hamburger */}
					{mounted && (
						<div className="flex items-center gap-2 md:hidden">
							<button
								type="button"
								className="flex h-9 w-9 items-center justify-center rounded-md text-gray-700"
								onClick={() => setMobileOpen(true)}
								aria-label="Open navigation"
							>
								<Menu size={22} />
							</button>
						</div>
					)}

					{/* Desktop Navigation */}
					<nav className="hidden items-center space-x-4 md:flex">
						<NavigationMenu>
							<NavigationMenuList>
								{navLinks.map((link) => (
									<NavigationMenuItem key={link.href}>
										<NavigationMenuLink asChild>
											<Link href={link.href} className="nav-link px-3 py-2">
												{link.label}
											</Link>
										</NavigationMenuLink>
									</NavigationMenuItem>
								))}
							</NavigationMenuList>
						</NavigationMenu>
					</nav>

					{/* Mobile Sheet drawer */}
					{mounted && (
						<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
							<SheetContent
								side="left"
								className="flex w-full max-w-xs flex-col bg-white p-0"
							>
								<SheetHeader className="border-b px-4 py-3 text-left">
									<SheetTitle asChild>
										<Link
											href={base}
											className="flex items-center space-x-2"
											onClick={() => setMobileOpen(false)}
										>
											{brand}
										</Link>
									</SheetTitle>
								</SheetHeader>

								<nav className="flex flex-col gap-1 p-4">
									{navLinks.map((link) => (
										<SheetClose asChild key={link.href}>
											<Link href={link.href} className="nav-link block py-2">
												{link.label}
											</Link>
										</SheetClose>
									))}
								</nav>

								<div className="mt-auto border-t p-4">
									<SignedOut>
										<div className="flex flex-col gap-2">
											<div className="nav-button">
												<SignInButton
													{...(redirectUrl && {
														forceRedirectUrl: redirectUrl,
														signUpForceRedirectUrl: redirectUrl,
													})}
												/>
											</div>
											<div className="nav-button">
												<SignUpButton
													{...(redirectUrl && {
														forceRedirectUrl: redirectUrl,
														signInForceRedirectUrl: redirectUrl,
													})}
												/>
											</div>
										</div>
									</SignedOut>
									<SignedIn>
										<div className="flex items-center justify-between">
											<SheetClose asChild>
												<Link href="/home" className="nav-link">
													Home
												</Link>
											</SheetClose>
											<UserButton />
										</div>
									</SignedIn>
								</div>
							</SheetContent>
						</Sheet>
					)}

					{/* Authentication — desktop only, deferred to client mount to prevent hydration mismatch */}
					<div className="hidden items-center space-x-2 md:flex">
						{mounted && (
							<>
								<SignedOut>
									<div className="nav-button text-sm">
										<SignInButton
											{...(redirectUrl && {
												forceRedirectUrl: redirectUrl,
												signUpForceRedirectUrl: redirectUrl,
											})}
										/>
									</div>
									<div className="nav-button text-sm">
										<SignUpButton
											{...(redirectUrl && {
												forceRedirectUrl: redirectUrl,
												signInForceRedirectUrl: redirectUrl,
											})}
										/>
									</div>
								</SignedOut>
								<SignedIn>
									<div className="nav-button">
										<UserButton />
									</div>
								</SignedIn>
							</>
						)}
					</div>
				</div>
			</div>
		</header>
	);
}

export default ClubNavBar;
