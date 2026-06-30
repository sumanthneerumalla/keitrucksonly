import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { env } from "~/env";
import { matchClubShortUrlPathname } from "~/lib/clubLanding";
import { CSP_REPORT_PATH, buildCsp } from "~/lib/csp";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

/** Per-request base64 nonce for the CSP (Edge-runtime safe — no Buffer). */
function generateNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

export default clerkMiddleware(async (auth, req) => {
	// Raw path of the incoming request, e.g. "/cba" or "/cba/articles/hello".
	const { pathname } = req.nextUrl;

	// TEMP telemetry probe (removed once the Zen rollout is validated). Auth-
	// independent: a plain `curl -H "x-zen-probe: 1"` reports which runtime the
	// middleware runs in and whether its outbound fetch — the exact operation that
	// fails under Zen in the edge sandbox on hosted-dev — succeeds.
	if (req.headers.get("x-zen-probe")) {
		const runtime =
			typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !==
			"undefined"
				? "edge"
				: (process.env.NEXT_RUNTIME ?? "node?");
		const t = Date.now();
		let fetchResult: string;
		try {
			const r = await fetch(
				"https://driven-dodo-7.clerk.accounts.dev/.well-known/jwks.json",
			);
			fetchResult = `OK ${r.status}`;
		} catch (e) {
			const err = e as Error & { cause?: { code?: string; message?: string } };
			fetchResult = `FAIL ${err.message} ${
				err.cause?.code ?? err.cause?.message ?? ""
			}`;
		}
		return NextResponse.json({ runtime, fetchResult, ms: Date.now() - t });
	}

	// --- Content Security Policy (staged rollout, see src/lib/csp.ts) --------
	const cspMode = env.CSP_MODE;
	const nonce = generateNonce();
	const csp = cspMode === "off" ? null : buildCsp(nonce);

	// Forward the nonce + policy to the app on the REQUEST headers so Next.js
	// stamps the same nonce onto its own inline hydration scripts. Next.js reads
	// the nonce from a request header literally named `content-security-policy`,
	// so we always use that name internally regardless of report-only/enforce.
	const requestHeaders = new Headers(req.headers);
	if (csp) {
		requestHeaders.set("x-nonce", nonce);
		requestHeaders.set("content-security-policy", csp);
	}

	// Attach the public-facing CSP header in the configured mode. In
	// report-only the browser logs violations but blocks nothing; in enforce it
	// blocks. Same nonce in both, so flipping the env var needs no other change.
	const withCsp = <T extends NextResponse>(res: T): T => {
		if (csp) {
			res.headers.set(
				cspMode === "enforce"
					? "content-security-policy"
					: "content-security-policy-report-only",
				csp,
			);
			// Declares the named endpoint that the CSP `report-to csp-endpoint`
			// directive delivers to (modern Reporting API). `report-uri` needs no
			// such declaration — it points at the path directly.
			res.headers.set(
				"reporting-endpoints",
				`csp-endpoint="${CSP_REPORT_PATH}"`,
			);
		}
		return res;
	};

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
		return withCsp(
			NextResponse.rewrite(url, { request: { headers: requestHeaders } }),
		);
	}

	// Otherwise, let the request continue normally.
	return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
});

export const config = {
	// Run middleware in the Node.js runtime (stable in Next 15.5) so Aikido Zen's
	// undici instrumentation applies to Clerk's handshake fetch instead of breaking
	// the edge-runtime sandbox fetch.
	runtime: "nodejs",
	matcher: [
		// Skip Next.js internals and all static files, unless found in search params
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
	],
};
