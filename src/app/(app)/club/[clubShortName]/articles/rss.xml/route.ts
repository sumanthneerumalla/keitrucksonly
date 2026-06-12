import type { ArticleCard } from "~/lib/article";
import { getClubPublicUrl } from "~/lib/clubPublicUrl";
import { db } from "~/server/db";
import { api } from "~/trpc/server";

// Cache the per-club feed for 5 minutes; 10-minute SWR. Mirrors the platform
// RSS cadence — clubs publish infrequently, so most reader fetches will hit
// the edge cache.
export const revalidate = 300;

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function escapeCdata(s: string): string {
	return s.replace(/]]>/g, "]]]]><![CDATA[>");
}

function toRfc2822(d: Date): string {
	return d.toUTCString().replace(/GMT$/, "+0000");
}

async function loadArticles(clubShortName: string): Promise<ArticleCard[]> {
	try {
		const res = await api.articles.listPublished({ clubShortName, limit: 20 });
		return res.items;
	} catch {
		return [];
	}
}

function buildItem(
	article: ArticleCard,
	club: { clubShortName: string; canonicalDomain: string | null },
): string {
	const url = getClubPublicUrl(club, `/articles/${article.slug}`);
	const descSource = article.excerpt ?? article.title;
	const truncated =
		descSource.length > 300 ? `${descSource.slice(0, 297)}...` : descSource;

	return [
		"    <item>",
		`      <title>${escapeXml(article.title)}</title>`,
		`      <link>${url}</link>`,
		`      <guid isPermaLink="true">${url}</guid>`,
		`      <pubDate>${toRfc2822(article.publishedAt)}</pubDate>`,
		`      <description><![CDATA[${escapeCdata(truncated)}]]></description>`,
		`      <author>noreply@facilitypresence.com (${escapeXml(article.author.name)})</author>`,
		"    </item>",
	].join("\n");
}

interface RouteParams {
	params: Promise<{ clubShortName: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
	const { clubShortName } = await params;

	const club = await db.club.findUnique({
		where: { clubShortName },
		select: { clubShortName: true, clubName: true, canonicalDomain: true },
	});
	if (!club) {
		return new Response("Not found", { status: 404 });
	}

	const articles = await loadArticles(clubShortName);
	const lastBuildDate = toRfc2822(articles[0]?.publishedAt ?? new Date());
	const channelLink = getClubPublicUrl(club, "/articles");
	const selfHref = getClubPublicUrl(club, "/articles/rss.xml");

	const channelMeta = [
		`    <title>${escapeXml(club.clubName)} Articles</title>`,
		`    <link>${channelLink}</link>`,
		`    <description>${escapeXml(`Articles from ${club.clubName} — news, updates, and stories from the club.`)}</description>`,
		"    <language>en-us</language>",
		`    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
		`    <atom:link href="${selfHref}" rel="self" type="application/rss+xml" />`,
	].join("\n");

	const items = articles.map((a) => buildItem(a, club)).join("\n");

	const xml = [
		'<?xml version="1.0" encoding="UTF-8" ?>',
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
		"  <channel>",
		channelMeta,
		items,
		"  </channel>",
		"</rss>",
	].join("\n");

	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
		},
	});
}
