import { SITE_URL } from "~/lib/marketing";

/**
 * Phase 16 D2 — single source of truth for a club's public base URL.
 *
 * `canonicalDomain` (Club column) is a full origin like
 * "https://cba.facilitypresence.com" or a customer-owned domain. NULL/empty =
 * the default platform path URL `https://facilitypresence.com/<short>`.
 *
 * EVERY public URL for a club (canonical tags, sitemap entries, JSON-LD ids,
 * OG urls, RSS links) must be built through these helpers so that flipping
 * `canonicalDomain` moves every SEO surface atomically. Never hardcode
 * `${SITE_URL}/${clubShortName}` in page code.
 */
export interface ClubUrlSource {
	clubShortName: string;
	canonicalDomain?: string | null;
}

export function getClubBaseUrl(club: ClubUrlSource): string {
	const domain = club.canonicalDomain?.trim().replace(/\/+$/, "");
	return domain ? domain : `${SITE_URL}/${club.clubShortName}`;
}

/** Build a public URL under the club's base, e.g. getClubPublicUrl(club, "/articles"). */
export function getClubPublicUrl(club: ClubUrlSource, path = ""): string {
	if (!path) return getClubBaseUrl(club);
	const suffix = path.startsWith("/") ? path : `/${path}`;
	return `${getClubBaseUrl(club)}${suffix}`;
}
