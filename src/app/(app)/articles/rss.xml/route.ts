import type { ArticleCard } from "~/lib/article";
import { SITE_URL } from "~/lib/marketing";
import { api } from "~/trpc/server";

// Cache the feed for 5 minutes at the edge with a 10-minute SWR window. Most
// readers fetch infrequently — no need to regenerate per request.
export const revalidate = 300;

// Escape the five XML predefined entities. Used for fields that aren't wrapped
// in CDATA (title, author). Order matters: ampersand must be replaced first.
function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

// Close any premature `]]>` inside the payload by splitting it so the parent
// CDATA block isn't terminated early. The pattern `]]]]><![CDATA[>` reads as
// `]]` followed by a fresh CDATA section continuing with `>` — a common idiom.
function escapeCdata(s: string): string {
	return s.replace(/]]>/g, "]]]]><![CDATA[>");
}

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// RFC 2822 / RSS pubDate format, e.g. "Tue, 27 May 2026 14:35:00 +0000".
// Node's `toUTCString()` returns the same shape with " GMT" instead of
// "+0000"; we swap it so feed validators that look for the numeric offset
// accept the value.
function toRfc2822(d: Date): string {
	return d.toUTCString().replace(/GMT$/, "+0000");
}

async function loadArticles(): Promise<ArticleCard[]> {
	try {
		const res = await api.articles.listPublished({ limit: 20 });
		return res.items;
	} catch {
		return [];
	}
}

function buildItem(article: ArticleCard): string {
	const url = `${SITE_URL}/articles/${article.slug}`;
	const descSource =
		article.excerpt ??
		(() => {
			// Excerpt is the preferred summary; this branch only runs for articles
			// authored without one. Body isn't on ArticleCard, so we fall back to
			// the title — keeps the feed valid without a second DB roundtrip.
			return article.title;
		})();
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

export async function GET() {
	const articles = await loadArticles();
	// lastBuildDate: most recent publishedAt, or now() if no articles.
	const lastBuildDate = toRfc2822(articles[0]?.publishedAt ?? new Date());

	const channelMeta = [
		"    <title>Facility Presence Articles</title>",
		`    <link>${SITE_URL}/articles</link>`,
		"    <description>Articles on running a racquet-sports facility — operations, member experience, growth.</description>",
		"    <language>en-us</language>",
		`    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
		`    <atom:link href="${SITE_URL}/articles/rss.xml" rel="self" type="application/rss+xml" />`,
	].join("\n");

	const items = articles.map(buildItem).join("\n");

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
