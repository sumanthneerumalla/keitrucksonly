import { AnnouncementStatus, ArticleStatus } from "@prisma/client";
import type { MetadataRoute } from "next";
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
		const clubBase = `${SITE_URL}/${club.clubShortName}/articles`;

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
			url: `${SITE_URL}/${club.clubShortName}/announcements`,
			lastModified: lastPublished,
			changeFrequency: "weekly",
			priority: 0.4,
		});
	}
	return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	try {
		const [articles, tags, clubEntries, announcementEntries] =
			await Promise.all([
				fetchAllPlatformArticles(),
				api.articles.listTags(),
				fetchClubArticleEntries(),
				fetchClubAnnouncementEntries(),
			]);

		const articleEntries: MetadataRoute.Sitemap = articles.map((p) => ({
			url: `${SITE_URL}/articles/${p.slug}`,
			lastModified: p.publishedAt,
			changeFrequency: "monthly",
			priority: 0.7,
		}));

		const tagEntries: MetadataRoute.Sitemap = tags.map((t) => ({
			url: `${SITE_URL}/articles/tag/${t.slug}`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.5,
		}));

		return [
			...STATIC_ROUTES,
			...articleEntries,
			...tagEntries,
			...clubEntries,
			...announcementEntries,
		];
	} catch {
		// Build-safe: if Prisma is unreachable during a build, ship the static
		// routes instead of failing the entire sitemap generation.
		return STATIC_ROUTES;
	}
}
