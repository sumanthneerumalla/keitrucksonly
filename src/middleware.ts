import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { matchClubShortUrlPathname } from "~/lib/clubLanding";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
	// Raw path of the incoming request, e.g. "/cba" or "/cba/articles/hello".
	const { pathname } = req.nextUrl;

	// Protect admin routes at the middleware level so unauthenticated visitors
	// receive a 302 redirect to the Clerk sign-in page *before* any RSC
	// rendering happens.  This avoids a React hooks-ordering error in the
	// Next.js Router that occurs when the server component calls redirect()
	// inside the RSC stream for unauthenticated users.
	if (isAdminRoute(req)) {
		await auth.protect();
	}

	// Phase 15 Step 4: match the full short-URL pattern set (bare landing +
	// /articles surfaces). All URL-shape knowledge lives in clubLanding.ts; the
	// middleware just unpacks the result and rewrites.
	const match = matchClubShortUrlPathname(pathname);
	if (match) {
		const url = req.nextUrl.clone();
		url.pathname = match.rewritePath;
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
