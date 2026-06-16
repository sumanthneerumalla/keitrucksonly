/**
 * Top-level URL segments that belong to the app itself and must NEVER be
 * treated as a club short URL.
 *
 * Club short URLs are matched OPTIMISTICALLY: any first segment that is NOT in
 * this set and matches `SHORTNAME_PATTERN` + a known short-URL shape is
 * rewritten to `/club/<short>/...`. The target page's
 * `db.club.findUnique → notFound()` is the single source of truth for whether
 * the club actually exists — so onboarding a new customer is a pure DB insert
 * with NO code change here.
 *
 * This set only needs to grow when a NEW top-level app route is added (which is
 * itself a code change). `clubLanding.test.ts` asserts it stays in sync with
 * the `src/app/(app)` route directory so a new route can't silently get
 * shadowed by the optimistic rewrite.
 */
export const RESERVED_TOP_LEVEL_SEGMENTS: ReadonlySet<string> = new Set([
	// src/app/(app)/* route segments (route group → these are top-level URLs)
	"account",
	"admin",
	"articles",
	"calendar",
	"checkin",
	"checkout",
	"clients",
	"club",
	"coaches",
	"dashboard",
	"database",
	"email-groups",
	"events",
	"features",
	"home",
	"invoices",
	"join",
	"pricing",
	"products",
	"profile",
	"rentals",
	"resources",
	"shop",
	"video-collections",
	// root routes (src/app/*)
	"privacy",
	"terms",
	// (embed) route group
	"embed",
	// Clerk hosted auth — no route dir, but middleware still runs for these
	"sign-in",
	"sign-up",
	// infra (already excluded by the middleware matcher; listed defensively)
	"api",
	"trpc",
	"_next",
]);

// A club short URL's first segment must look like a slug: lowercase
// alphanumerics with optional internal hyphens. This rejects dotted asset/feed
// paths (e.g. robots.txt, sitemap.xml), uppercase, and other non-club shapes
// without having to enumerate every special file.
const SHORTNAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function normalizePathname(pathname: string): string {
	return pathname.endsWith("/") && pathname !== "/"
		? pathname.slice(0, -1)
		: pathname;
}

// Result of a short-URL match: the club we matched and the internal path the
// middleware should rewrite to. Returning both keeps the middleware dumb —
// all URL-shape knowledge lives in this module.
export interface ClubShortUrlMatch {
	shortname: string;
	rewritePath: string;
}

/**
 * Determine whether `pathname` is a club short URL that should be rewritten
 * to its internal `/club/<short>/...` path, and if so, return the match info.
 *
 * Matched patterns (Phase 15 Step 4 — articles surfaces added,
 *                   Phase 15 Step 6 — announcements feed added):
 *   /<short>                                  → /club/<short>
 *   /<short>/                                 → /club/<short>
 *   /<short>/articles                         → /club/<short>/articles
 *   /<short>/articles/                        → /club/<short>/articles
 *   /<short>/articles/<slug>                  → /club/<short>/articles/<slug>
 *   /<short>/articles/tag/<tagSlug>           → /club/<short>/articles/tag/<tagSlug>
 *   /<short>/articles/rss.xml                 → /club/<short>/articles/rss.xml
 *   /<short>/announcements                    → /club/<short>/announcements
 *   /<short>/announcements/                   → /club/<short>/announcements
 *
 * NOTE: announcements are a single scrollable feed — there is NO
 * /<short>/announcements/<id> per-item URL.
 *
 * IMPORTANT: a deeper path that doesn't match one of the above patterns
 * (e.g. /<short>/dashboard, /<short>/profile, /<short>/articles/foo/bar) is
 * NOT a club short URL and returns null. Those are either authed app routes
 * (/<short> happens to share a prefix only by coincidence) or simply 404s —
 * either way, the middleware must NOT rewrite them.
 */
export function matchClubShortUrlPathname(
	pathname: string,
): ClubShortUrlMatch | null {
	const normalized = normalizePathname(pathname);
	if (!normalized.startsWith("/")) return null;
	const segments = normalized.slice(1).split("/");
	const [short, ...rest] = segments;
	if (!short) return null;

	// Denylist + slug-shape guard. A reserved app route or a non-slug segment is
	// never a club short URL. Everything else is optimistically rewritten and
	// validated against the DB by the target /club/<short> page.
	if (
		RESERVED_TOP_LEVEL_SEGMENTS.has(short) ||
		!SHORTNAME_PATTERN.test(short)
	) {
		return null;
	}

	// Bare landing.
	if (rest.length === 0) {
		return { shortname: short, rewritePath: `/club/${short}` };
	}

	// /<short>/articles ...
	if (rest[0] === "articles") {
		// /<short>/articles
		if (rest.length === 1) {
			return {
				shortname: short,
				rewritePath: `/club/${short}/articles`,
			};
		}
		// /<short>/articles/rss.xml
		if (rest.length === 2 && rest[1] === "rss.xml") {
			return {
				shortname: short,
				rewritePath: `/club/${short}/articles/rss.xml`,
			};
		}
		// /<short>/articles/tag/<tagSlug>
		if (rest.length === 3 && rest[1] === "tag" && rest[2]) {
			return {
				shortname: short,
				rewritePath: `/club/${short}/articles/tag/${rest[2]}`,
			};
		}
		// /<short>/articles/<slug> — single trailing segment, NOT empty,
		// NOT one of the reserved sub-routes above.
		if (rest.length === 2 && rest[1] && rest[1] !== "tag") {
			return {
				shortname: short,
				rewritePath: `/club/${short}/articles/${rest[1]}`,
			};
		}
		// Anything else under /<short>/articles/... is not a recognized public
		// surface — let it fall through (likely 404).
		return null;
	}

	// /<short>/announcements (Phase 15 Step 6) — single scrollable feed only,
	// no per-announcement detail URL.
	if (rest[0] === "announcements" && rest.length === 1) {
		return {
			shortname: short,
			rewritePath: `/club/${short}/announcements`,
		};
	}

	// /<short>/calendar (Phase 16) — the public club calendar (the "Book a
	// Court" / "View Calendar" destination). Query params (view/mode/
	// orientation) ride along via the preserved nextUrl search string.
	if (rest[0] === "calendar" && rest.length === 1) {
		return {
			shortname: short,
			rewritePath: `/club/${short}/calendar`,
		};
	}

	// /<short>/events/<eventId> (Phase 16 Step 5) — club-chromed public event
	// page. Single trailing id only; no index (the events live on the landing
	// page + calendar).
	if (rest[0] === "events" && rest.length === 2 && rest[1]) {
		return {
			shortname: short,
			rewritePath: `/club/${short}/events/${rest[1]}`,
		};
	}

	// Any other deeper path (e.g. /<short>/dashboard) is NOT a club short URL.
	return null;
}
