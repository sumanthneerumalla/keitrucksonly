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
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface NavBarProps {
	/** Optional club short name for redirect after auth */
	clubShortName?: string;
}

export function NavBar({ clubShortName }: NavBarProps) {
	// Build redirect URL with joinClub param if clubShortName is provided
	const redirectUrl = clubShortName
		? `/profile?joinClub=${encodeURIComponent(clubShortName)}`
		: undefined;
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

	// On authed app pages (not public), MobileAuthedHeader provides the hamburger.
	// NavBar hamburger only needed on public pages (/, /resources/*, /club/*, /events/*).
	// /rentals is public for unauthenticated visitors; authenticated users get the authed layout.
	const isPublicPage =
		pathname === "/" ||
		pathname.startsWith("/resources") ||
		pathname.startsWith("/club/") ||
		pathname.startsWith("/events/") ||
		(pathname.startsWith("/rentals") && !isSignedIn);
	const showMobileHamburger = !isSignedIn || isPublicPage;

	return (
		<header
			className={cn(
				"fixed top-0 right-0 left-0 z-40 transition-all duration-300",
				mounted && isScrolled
					? "bg-white/80 shadow-sm backdrop-blur-lg"
					: "bg-white/50 backdrop-blur-sm",
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

					{/* Hamburger — mobile only on public pages (authed app pages use MobileAuthedHeader) */}
					{mounted && showMobileHamburger && (
						<button
							className="flex items-center justify-center rounded-md p-2 text-gray-700 md:hidden"
							onClick={() => setMobileOpen(true)}
							aria-label="Open navigation"
						>
							<Menu size={22} />
						</button>
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

									{/* How It Works dropdown */}
									<NavigationMenuItem>
										<NavigationMenuTrigger>How It Works</NavigationMenuTrigger>
										<NavigationMenuContent>
											<ul className="w-48 p-2">
												<li>
													<NavigationMenuLink asChild>
														<Link
															href="/#how-it-works"
															className="dropdown-item block"
														>
															How It Works
														</Link>
													</NavigationMenuLink>
												</li>
											</ul>
										</NavigationMenuContent>
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
												<Link
													href="/features"
													className="nav-link block py-2"
												>
													Features
												</Link>
											</SheetClose>
											<SheetClose asChild>
												<Link
													href="/#how-it-works"
													className="nav-link block py-2"
												>
													How It Works
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
					<div className="hidden items-center space-x-4 md:flex">
						{mounted && (
							<>
								<SignedOut>
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
