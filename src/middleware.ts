import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClubShortnameFromShortUrlPathname } from "~/lib/clubLanding";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
	// Raw path of the incoming request, e.g. "/cba" or "/cba/" or "/dashboard".
	const { pathname } = req.nextUrl;

	// Protect admin routes at the middleware level so unauthenticated visitors
	// receive a 302 redirect to the Clerk sign-in page *before* any RSC
	// rendering happens.  This avoids a React hooks-ordering error in the
	// Next.js Router that occurs when the server component calls redirect()
	// inside the RSC stream for unauthenticated users.
	if (isAdminRoute(req)) {
		await auth.protect();
	}

	// Convert "/cba" (or "/cba/") to a club shortname ("cba") if it matches a known club short URL.
	const clubShortname = getClubShortnameFromShortUrlPathname(pathname);

	// If this request matches a known club short URL, rewrite it to the internal
	// dynamic club landing route. Rewrites keep the browser URL as-is (still /cba),
	// but serve the content from /club/<clubShortname>.
	if (clubShortname) {
		const url = req.nextUrl.clone();
		url.pathname = `/club/${clubShortname}`;
		return NextResponse.rewrite(url);
	}

	// Otherwise, let the request continue normally.
	return NextResponse.next();
});

export const config = {
	matcher: [
		// Skip Next.js internals and all static files, unless found in search params
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
	],
};
