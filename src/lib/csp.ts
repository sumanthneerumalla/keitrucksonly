/**
 * Content Security Policy — staged, "medium" enforcement.
 * Built per-request with a nonce in `src/middleware.ts` (the App Router emits
 * inline hydration scripts, so a static blanket header won't work).
 *
 * STAGED ROLLOUT (controlled by env `CSP_MODE`, see src/env.js)
 *   report-only → header is `Content-Security-Policy-Report-Only`. Browsers
 *                 evaluate the policy and log violations to the console but
 *                 BLOCK NOTHING. Default — safe to deploy to prod immediately.
 *                 Use it to confirm Clerk login, Stripe checkout and the video
 *                 embeds don't trip the policy on the real site.
 *   enforce     → header is `Content-Security-Policy` (blocking). Flip to this
 *                 once Report-Only is clean; this is what clears the finding.
 *   off         → no header (escape hatch).
 *
 * "MEDIUM" ENFORCEMENT LEVEL
 *   scripts → per-request nonce + 'strict-dynamic' (CSP3 browsers trust only
 *             nonced scripts and whatever those load). 'unsafe-inline' and
 *             `https:` are listed as a CSP2 legacy fallback that strict-dynamic
 *             -aware browsers ignore, so modern browsers still get the strict
 *             behavior while old ones degrade instead of breaking.
 *   styles  → 'unsafe-inline' allowed. Tailwind + Next inject inline styles;
 *             noncing styles is impractical and low value (style injection is a
 *             far weaker attack vector than script injection). This is the main
 *             reason this is "medium" and not "strict".
 *   3rd-party origins explicitly allowlisted: Clerk (auth + Turnstile), Stripe
 *             (Embedded Checkout), YouTube / Vimeo (video embeds).
 *
 * If you add a new third-party script, image host, embed or API, add its origin
 * to the relevant directive below — Report-Only mode will surface it first.
 */

// Same-origin collector that stores violations (src/app/api/csp-report). Used by
// both the `report-uri` directive and the middleware's `Reporting-Endpoints` header.
export const CSP_REPORT_PATH = "/api/csp-report";

// Clerk: a *production* instance serves its Frontend API + clerk.js bundle from
// a CUSTOM domain encoded in the pk_live key — here `clerk.shuttlementor.com`
// (decode the suffix of NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to confirm / update).
// Dev instances use *.clerk.accounts.dev. Assets/images come from *.clerk.com,
// and bot-protection runs Cloudflare Turnstile on challenges.cloudflare.com.
// NOTE: if the Clerk Frontend API domain is ever migrated to facilitypresence,
// add `https://clerk.facilitypresence.com` here too.
const CLERK = [
	"https://clerk.shuttlementor.com",
	"https://*.clerk.accounts.dev",
	"https://*.clerk.com",
	"https://challenges.cloudflare.com",
].join(" ");

// Stripe Embedded Checkout: js.stripe.com (script + frame), api.stripe.com
// (XHR), and *.stripe.com (hooks/3DS frames, images).
const STRIPE =
	"https://js.stripe.com https://api.stripe.com https://*.stripe.com";

// Video embeds rendered as <iframe> (YouTubeEmbed.tsx, video collections).
const VIDEO =
	"https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com";

/**
 * Build the CSP header value for a single request.
 * @param nonce base64 nonce, unique per request, also stamped onto Next.js'
 *   own inline scripts (the middleware forwards it via the request headers).
 */
export function buildCsp(nonce: string): string {
	return [
		"default-src 'self'",
		// 'strict-dynamic' + nonce is the real policy for modern browsers; the
		// trailing fallbacks are ignored by them and only catch CSP2 browsers.
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline' ${STRIPE} ${CLERK}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' blob: data: https:",
		"font-src 'self' data:",
		`connect-src 'self' ${CLERK} ${STRIPE}`,
		`frame-src 'self' ${STRIPE} ${VIDEO} ${CLERK}`,
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		// 'self' (not 'none') so we don't break any same-origin iframe usage;
		// blocks third-party clickjacking. Report-Only will reveal cross-origin
		// embeds (e.g. a future GBR stitch) if they need to be added.
		"frame-ancestors 'self'",
		"upgrade-insecure-requests",
		// Ship violations to our own collector (src/app/api/csp-report). `report-uri`
		// is deprecated but still the most widely honored; `report-to` is the modern
		// Reporting-API path and pairs with the `Reporting-Endpoints` response header
		// the middleware sets. Both name the same endpoint for max browser coverage.
		`report-uri ${CSP_REPORT_PATH}`,
		"report-to csp-endpoint",
	].join("; ");
}
