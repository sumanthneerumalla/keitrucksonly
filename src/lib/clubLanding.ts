export const CLUB_LANDING_SHORTNAMES = [
	"cba",
	"squashdublin",
	"patricksquash",
	"featherballer",
	"badmintontutorials",
	"aharu",
] as const;

export function normalizePathname(pathname: string): string {
	return pathname.endsWith("/") && pathname !== "/"
		? pathname.slice(0, -1)
		: pathname;
}

export function pathnameToTopLevelSegment(pathname: string): string {
	const normalized = normalizePathname(pathname);
	return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

// True iff pathname is a bare club short URL — exactly /<short> or /<short>/.
// Used as an allowlist check that does NOT consider any deeper paths
// (/<short>/dashboard is NOT a bare landing).
export function isClubLandingShortUrlPathname(pathname: string): boolean {
	const topLevel = pathnameToTopLevelSegment(pathname);
	return CLUB_LANDING_SHORTNAMES.includes(
		topLevel as (typeof CLUB_LANDING_SHORTNAMES)[number],
	);
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

	if (
		!CLUB_LANDING_SHORTNAMES.includes(
			short as (typeof CLUB_LANDING_SHORTNAMES)[number],
		)
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

	// Any other deeper path (e.g. /<short>/dashboard) is NOT a club short URL.
	return null;
}
