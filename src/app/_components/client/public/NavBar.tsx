"use client";

import {
	SignInButton,
	SignUpButton,
	SignedIn,
	SignedOut,
	UserButton,
	useAuth,
} from "@clerk/nextjs";
import { BookOpen, Home, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStashJoinIntent } from "~/app/_components/hooks/use-stash-join-intent";
import AnimatedLogo from "~/app/_components/shared/AnimatedLogo";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from "~/app/_components/shared/navigation-menu";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "~/app/_components/shared/ui/sheet";
import { matchClubShortUrlPathname } from "~/lib/clubLanding";
import { CALENDLY_URL } from "~/lib/marketing";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface NavBarProps {
	/** Optional club short name for redirect after auth */
	clubShortName?: string;
}

export function NavBar({ clubShortName }: NavBarProps) {
	// On a club page, hand its club to the sign-in funnel (logged-out only) so a
	// new user lands on /join with that club pre-searched. Every sign-in/up button
	// just points at /join, which forwards returning members and onboards new ones.
	useStashJoinIntent({ clubShortName });
	const redirectUrl = "/join";
	const [isScrolled, setIsScrolled] = useState(false);
	const [mounted, setMounted] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	useEffect(() => setMounted(true), []);
	const router = useRouter();
	const pathname = usePathname();

	// Automatically create user profile in database after sign-in
	const { isSignedIn, isLoaded } = useAuth();
	const { data: user } = api.user.getOrCreateProfile.useQuery(undefined, {
		enabled: isLoaded && isSignedIn === true, // Only query when auth is loaded AND user is signed in
		staleTime: 1000 * 60 * 5, // Cache for 5 minutes
		retry: false, // Don't retry if user is not authenticated
	});

	// Redirect to home page after login
	useEffect(() => {
		if (isLoaded && isSignedIn && user) {
			// Check if we're on the landing page
			const publicPaths = ["/"];
			const currentPath = window.location.pathname;
			if (publicPaths.includes(currentPath)) {
				router.push("/home");
			}
		}
	}, [isLoaded, isSignedIn, user, router]);

	// Scroll handler for header blur/shadow
	useEffect(() => {
		const handleScroll = () => setIsScrolled(window.scrollY > 10);
		window.addEventListener("scroll", handleScroll);
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	const showPublicNav = !isLoaded || pathname === "/" || !isSignedIn;

	// Short URLs (e.g. /pioneer-badminton) are rewritten to /club/<short> by the
	// middleware, but usePathname() reports the browser path — so match the
	// short-URL shape here too (the same matcher the middleware uses) to keep the
	// public/marketing chrome consistent with the canonical /club/* path.
	const isClubPage =
		pathname.startsWith("/club/") ||
		matchClubShortUrlPathname(pathname) !== null;
	// On authed app pages (not public), MobileAuthedHeader provides the hamburger.
	// NavBar hamburger only needed on public pages (/, /resources/*, /club/*, /events/*).
	// /rentals is public for unauthenticated visitors; authenticated users get the authed layout.
	const isPublicPage =
		pathname === "/" ||
		pathname.startsWith("/resources") ||
		isClubPage ||
		pathname.startsWith("/events/") ||
		(pathname.startsWith("/rentals") && !isSignedIn);
	const showMobileHamburger = !isSignedIn || isPublicPage;

	// Marketing pages render on the warm-paper background; the NavBar should
	// blend with it rather than sit as a white slab. Authed app pages keep the
	// existing white-blur chrome.
	const isMarketingPage =
		pathname === "/" ||
		pathname === "/features" ||
		pathname === "/pricing" ||
		isClubPage;

	return (
		<header
			className={cn(
				"sticky top-0 right-0 left-0 z-40 backdrop-blur-lg transition-all duration-300",
				isMarketingPage
					? mounted && isScrolled
						? "border-[var(--line)]/60 border-b bg-[var(--paper)]/80"
						: "bg-[var(--paper)]/55"
					: mounted && isScrolled
						? "bg-white/80 shadow-sm"
						: "bg-white/50",
			)}
		>
			<div className="container mx-auto px-4">
				<div className="flex h-16 items-center justify-between">
					{/* Logo Section */}
					<Link href="/" className="flex items-center space-x-2">
						<AnimatedLogo size="sm" />
						<span className="font-bold text-[var(--primary)] text-xl">
							Facility Presence
						</span>
					</Link>

					{/* Mobile right-side: persistent demo CTA + hamburger */}
					{mounted && showMobileHamburger && (
						<div className="flex items-center gap-2 md:hidden">
							<SignedOut>
								<a
									href={CALENDLY_URL}
									target="_blank"
									rel="noopener noreferrer"
									className="btn btn-primary btn-sm text-xs"
								>
									Book a demo
								</a>
							</SignedOut>
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
						{showPublicNav && mounted && (
							<NavigationMenu>
								<NavigationMenuList>
									{/* Features link */}
									<NavigationMenuItem>
										<NavigationMenuLink asChild>
											<Link href="/features" className="nav-link px-3 py-2">
												Features
											</Link>
										</NavigationMenuLink>
									</NavigationMenuItem>

									{/* Pricing link */}
									<NavigationMenuItem>
										<NavigationMenuLink asChild>
											<Link href="/pricing" className="nav-link px-3 py-2">
												Pricing
											</Link>
										</NavigationMenuLink>
									</NavigationMenuItem>

									{/* How It Works link */}
									<NavigationMenuItem>
										<NavigationMenuLink asChild>
											<Link
												href="/#how-it-works"
												className="nav-link px-3 py-2"
											>
												How it works
											</Link>
										</NavigationMenuLink>
									</NavigationMenuItem>

									{/* Resources dropdown */}
									<NavigationMenuItem>
										<NavigationMenuTrigger>
											<BookOpen size={16} className="mr-1" />
											Resources
										</NavigationMenuTrigger>
										<NavigationMenuContent>
											<ul className="w-48 p-2">
												<li>
													<NavigationMenuLink asChild>
														<Link
															href="/resources/getting-started"
															className="dropdown-item block"
														>
															Getting Started
														</Link>
													</NavigationMenuLink>
												</li>
											</ul>
										</NavigationMenuContent>
									</NavigationMenuItem>
								</NavigationMenuList>
							</NavigationMenu>
						)}

						{/* Authenticated navigation — deferred to client mount to prevent hydration mismatch */}
						{mounted && (
							<SignedIn>
								<Link href="/home" className="nav-link flex items-center">
									<Home size={16} className="mr-1" />
									Home
								</Link>
							</SignedIn>
						)}
					</nav>

					{/* Mobile Sheet drawer — only on public pages */}
					{mounted && showMobileHamburger && (
						<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
							<SheetContent
								side="left"
								className="flex w-full max-w-xs flex-col bg-white p-0"
							>
								<SheetHeader className="border-b px-4 py-3 text-left">
									<SheetTitle asChild>
										<Link
											href="/"
											className="flex items-center space-x-2"
											onClick={() => setMobileOpen(false)}
										>
											<AnimatedLogo size="sm" />
											<span className="font-bold text-[var(--primary)] text-lg">
												Facility Presence
											</span>
										</Link>
									</SheetTitle>
								</SheetHeader>

								<nav className="flex flex-col gap-1 p-4">
									{showPublicNav && (
										<>
											<SheetClose asChild>
												<Link href="/features" className="nav-link block py-2">
													Features
												</Link>
											</SheetClose>
											<SheetClose asChild>
												<Link href="/pricing" className="nav-link block py-2">
													Pricing
												</Link>
											</SheetClose>
											<SheetClose asChild>
												<Link
													href="/#how-it-works"
													className="nav-link block py-2"
												>
													How it works
												</Link>
											</SheetClose>
											<SheetClose asChild>
												<Link
													href="/resources/getting-started"
													className="nav-link block py-2"
												>
													<BookOpen size={16} className="mr-2 inline" />
													Resources
												</Link>
											</SheetClose>
										</>
									)}
									<SignedIn>
										<SheetClose asChild>
											<Link href="/home" className="nav-link block py-2">
												<Home size={16} className="mr-2 inline" />
												Home
											</Link>
										</SheetClose>
									</SignedIn>
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
												<Link href="/profile" className="nav-link">
													My Profile
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
									<a
										href={CALENDLY_URL}
										target="_blank"
										rel="noopener noreferrer"
										className="btn btn-primary btn-sm"
									>
										Book a demo
										<span className="arrow">→</span>
									</a>
								</SignedOut>
								<SignedIn>
									<Link href="/profile" className="nav-link">
										My Profile
									</Link>
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

export default NavBar;
