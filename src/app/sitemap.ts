import { AnnouncementStatus, ArticleStatus, EventType } from "@prisma/client";
import type { MetadataRoute } from "next";
import { getClubBaseUrl, getClubPublicUrl } from "~/lib/clubPublicUrl";
import { SITE_URL } from "~/lib/marketing";
import { db } from "~/server/db";
import { api } from "~/trpc/server";

// Re-generate at most every 5 minutes. Articles and tags add slowly; this keeps
// the cost of a sitemap fetch by a crawler near zero.
export const revalidate = 300;

// Static marketing routes that always exist.
const STATIC_ROUTES: MetadataRoute.Sitemap = [
	{
		url: `${SITE_URL}/`,
		lastModified: new Date(),
		changeFrequency: "weekly",
		priority: 1.0,
	},
	{
		url: `${SITE_URL}/features`,
		lastModified: new Date(),
		changeFrequency: "monthly",
		priority: 0.8,
	},
	{
		url: `${SITE_URL}/pricing`,
		lastModified: new Date(),
		changeFrequency: "monthly",
		priority: 0.8,
	},
	{
		url: `${SITE_URL}/articles`,
		lastModified: new Date(),
		changeFrequency: "daily",
		priority: 0.9,
	},
];

// Iterate the cursor pagination to pick up every published platform article.
// The router caps `limit` at 50; for a marketing site this is a tiny number of
// roundtrips. The page guard prevents an unbounded loop if the cursor ever
// fails to advance.
async function fetchAllPlatformArticles(): Promise<
	Array<{ slug: string; publishedAt: Date }>
> {
	const out: Array<{ slug: string; publishedAt: Date }> = [];
	let cursor: string | undefined;
	let pageCount = 0;
	const MAX_PAGES = 100; // 100 * 50 = 5000 articles ceiling
	while (pageCount < MAX_PAGES) {
		const res: {
			items: Array<{ slug: string; publishedAt: Date }>;
			nextCursor?: string;
		} = await api.articles.listPublished({ limit: 50, cursor });
		for (const p of res.items) {
			out.push({ slug: p.slug, publishedAt: p.publishedAt });
		}
		if (!res.nextCursor) break;
		cursor = res.nextCursor;
		pageCount += 1;
	}
	return out;
}

// Phase 16 Step 1 — one landing-page entry per club. The landing page is the
// highest-value local-SEO URL we have, so every club is listed regardless of
// whether it has published content yet.
async function fetchClubLandingEntries(): Promise<MetadataRoute.Sitemap> {
	const clubs = await db.club.findMany({
		select: { clubShortName: true, canonicalDomain: true, updatedAt: true },
	});
	return clubs.map((club) => ({
		url: getClubBaseUrl(club),
		lastModified: club.updatedAt,
		changeFrequency: "daily",
		priority: 0.8,
	}));
}

// For each club with ≥1 published article, return the rows needed to emit
// per-club sitemap entries: the club itself, every published article, and
// every tag that has ≥1 published article in that club.
//
// One round-trip per club, but the universe of clubs is tiny (single digits
// today; tens at most for the foreseeable future). The published-article
// filter is a where-clause on `articles`, so clubs without articles are
// dropped at the DB.
async function fetchClubArticleEntries(): Promise<MetadataRoute.Sitemap> {
	const now = new Date();
	const clubs = await db.club.findMany({
		select: {
			clubShortName: true,
			canonicalDomain: true,
			articles: {
				where: {
					status: ArticleStatus.PUBLISHED,
					publishedAt: { lte: now },
				},
				select: {
					slug: true,
					publishedAt: true,
					tags: {
						select: { tag: { select: { slug: true } } },
					},
				},
			},
		},
	});

	const entries: MetadataRoute.Sitemap = [];
	for (const club of clubs) {
		if (club.articles.length === 0) continue;
		const clubBase = getClubPublicUrl(club, "/articles");

		// Index page for the club.
		entries.push({
			url: clubBase,
			lastModified: now,
			changeFrequency: "weekly",
			priority: 0.5,
		});

		// One entry per published article.
		const tagSlugs = new Set<string>();
		for (const article of club.articles) {
			entries.push({
				url: `${clubBase}/${article.slug}`,
				// publishedAt is non-null on PUBLISHED rows (filter above).
				lastModified: article.publishedAt ?? now,
				changeFrequency: "monthly",
				priority: 0.4,
			});
			for (const t of article.tags) {
				tagSlugs.add(t.tag.slug);
			}
		}

		// One entry per tag that has ≥1 published article in this club.
		// (Built from the article rows so we don't need a second query.)
		for (const tagSlug of tagSlugs) {
			entries.push({
				url: `${clubBase}/tag/${tagSlug}`,
				lastModified: now,
				changeFrequency: "monthly",
				priority: 0.3,
			});
		}
	}
	return entries;
}

// Phase 15 Step 6 — One announcements-feed URL per club that has ≥1 PUBLISHED
// announcement. No per-announcement URLs (announcements are a single
// scrollable feed). lastModified = most-recent publishedAt for that club.
async function fetchClubAnnouncementEntries(): Promise<MetadataRoute.Sitemap> {
	const now = new Date();
	const clubs = await db.club.findMany({
		select: {
			clubShortName: true,
			canonicalDomain: true,
			announcements: {
				where: {
					status: AnnouncementStatus.PUBLISHED,
					publishedAt: { lte: now },
				},
				select: { publishedAt: true },
				// Most-recent publishedAt is enough to set lastModified.
				orderBy: { publishedAt: "desc" },
				take: 1,
			},
		},
	});

	const entries: MetadataRoute.Sitemap = [];
	for (const club of clubs) {
		if (club.announcements.length === 0) continue;
		const lastPublished = club.announcements[0]?.publishedAt ?? now;
		entries.push({
			url: getClubPublicUrl(club, "/announcements"),
			lastModified: lastPublished,
			changeFrequency: "weekly",
			priority: 0.4,
		});
	}
	return entries;
}

// One sitemap entry per PUBLIC, non-deleted, non-BLOCK event whose `end` is
// still in the future. Capped at 500 (ordered by start asc) so the sitemap
// stays bounded even for high-volume clubs.
async function fetchEventEntries(): Promise<MetadataRoute.Sitemap> {
	const now = new Date();
	const events = await db.calendarEvent.findMany({
		where: {
			isPublic: true,
			isDeleted: false,
			eventType: { not: EventType.BLOCK },
			end: { gt: now },
		},
		select: { eventId: true, updatedAt: true },
		orderBy: { start: "asc" },
		take: 500,
	});
	return events.map((event) => ({
		url: `${SITE_URL}/events/${event.eventId}`,
		lastModified: event.updatedAt,
		changeFrequency: "daily",
		priority: 0.6,
	}));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	try {
		// F27: each fetch is independently guarded so one transient failure
		// doesn't wipe out the dynamic sections from the other three. The outer
		// try/catch below remains the catastrophic-failure fallback (e.g. if
		// even building the static routes throws).
		const [
			landingEntries,
			articleEntries,
			tagEntries,
			clubEntries,
			announcementEntries,
			eventEntries,
		] = await Promise.all([
			(async (): Promise<MetadataRoute.Sitemap> => {
				try {
					return await fetchClubLandingEntries();
				} catch {
					return [];
				}
			})(),
			(async (): Promise<MetadataRoute.Sitemap> => {
				try {
					const articles = await fetchAllPlatformArticles();
					return articles.map((p) => ({
						url: `${SITE_URL}/articles/${p.slug}`,
						lastModified: p.publishedAt,
						changeFrequency: "monthly",
						priority: 0.7,
					}));
				} catch {
					return [];
				}
			})(),
			(async (): Promise<MetadataRoute.Sitemap> => {
				try {
					const tags = await api.articles.listTags();
					return tags.map((t) => ({
						url: `${SITE_URL}/articles/tag/${t.slug}`,
						lastModified: new Date(),
						changeFrequency: "weekly",
						priority: 0.5,
					}));
				} catch {
					return [];
				}
			})(),
			(async (): Promise<MetadataRoute.Sitemap> => {
				try {
					return await fetchClubArticleEntries();
				} catch {
					return [];
				}
			})(),
			(async (): Promise<MetadataRoute.Sitemap> => {
				try {
					return await fetchClubAnnouncementEntries();
				} catch {
					return [];
				}
			})(),
			(async (): Promise<MetadataRoute.Sitemap> => {
				try {
					return await fetchEventEntries();
				} catch {
					return [];
				}
			})(),
		]);

		return [
			...STATIC_ROUTES,
			...landingEntries,
			...articleEntries,
			...tagEntries,
			...clubEntries,
			...announcementEntries,
			...eventEntries,
		];
	} catch {
		// Build-safe: if Prisma is unreachable during a build, ship the static
		// routes instead of failing the entire sitemap generation.
		return STATIC_ROUTES;
	}
}
