import DOMPurify from "isomorphic-dompurify";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleCard } from "~/app/_components/client/public/articles/ArticleCard";
import type {
	ArticleCard as ArticleCardType,
	ArticleDetail,
} from "~/lib/article";
import { getClubPublicUrl } from "~/lib/clubPublicUrl";
import { SITE_URL } from "~/lib/marketing";
import { db } from "~/server/db";
import { api } from "~/trpc/server";

// ISR — same 60s rebuild window as the platform article detail.
export const revalidate = 60;

// Build-safe: render on demand, no static params at build time.
export async function generateStaticParams() {
	return [];
}

interface ClubArticlePageProps {
	params: Promise<{ clubShortName: string; slug: string }>;
}

async function fetchClub(clubShortName: string): Promise<{
	clubShortName: string;
	clubName: string;
	canonicalDomain: string | null;
} | null> {
	return db.club.findUnique({
		where: { clubShortName },
		select: { clubShortName: true, clubName: true, canonicalDomain: true },
	});
}

async function fetchArticle(
	slug: string,
	clubShortName: string,
): Promise<ArticleDetail | null> {
	try {
		return await api.articles.getBySlug({ slug, clubShortName });
	} catch (err) {
		const message =
			err && typeof err === "object" && "message" in err
				? String((err as { message: unknown }).message)
				: "";
		if (
			(err as { code?: string } | null)?.code === "NOT_FOUND" ||
			/not.?found/i.test(message)
		) {
			return null;
		}
		throw err;
	}
}

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function formatLongDate(d: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(d);
}

function buildDescription(article: ArticleDetail): string {
	if (article.metaDescription) return article.metaDescription;
	if (article.excerpt) return article.excerpt;
	const stripped = stripHtml(article.bodyHtml);
	return stripped.length > 160 ? `${stripped.slice(0, 157).trim()}…` : stripped;
}

export async function generateMetadata({
	params,
}: ClubArticlePageProps): Promise<Metadata> {
	const { clubShortName, slug } = await params;
	const [club, article] = await Promise.all([
		fetchClub(clubShortName),
		fetchArticle(slug, clubShortName),
	]);

	if (!club || !article) {
		return {
			title: "Article not found",
			description: "This article could not be found.",
		};
	}

	const title = article.metaTitle || article.title;
	const description = buildDescription(article);
	const url = getClubPublicUrl(club, `/articles/${article.slug}`);
	const absoluteCover = article.coverImageUrl
		? `${SITE_URL}${article.coverImageUrl}`
		: null;

	return {
		title: `${title} | ${club.clubName}`,
		description,
		alternates: { canonical: url },
		openGraph: {
			title,
			description,
			type: "article",
			url,
			siteName: club.clubName,
			publishedTime: article.publishedAt.toISOString(),
			authors: [article.author.name],
			images: absoluteCover
				? [
						{
							url: absoluteCover,
							alt: article.coverImageAlt ?? article.title,
						},
					]
				: [],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images: absoluteCover ? [absoluteCover] : [],
		},
	};
}

// Related articles within the same club + primary tag.
async function fetchRelated(
	article: ArticleDetail,
	clubShortName: string,
): Promise<ArticleCardType[]> {
	const primaryTag = article.tags[0]?.slug;
	if (!primaryTag) return [];
	try {
		const res = await api.articles.listPublished({
			clubShortName,
			limit: 4,
			tagSlug: primaryTag,
		});
		return res.items.filter((p) => p.id !== article.id).slice(0, 3);
	} catch {
		return [];
	}
}

// "Read next" — first article older than this one within the same club.
// Mirrors the platform detail page's single forward-cursor strategy.
async function fetchNextArticle(
	article: ArticleDetail,
	clubShortName: string,
): Promise<ArticleCardType | null> {
	try {
		const res = await api.articles.listPublished({
			clubShortName,
			limit: 1,
			cursor: article.id,
		});
		return res.items[0] ?? null;
	} catch {
		return null;
	}
}

export default async function ClubArticlePage({
	params,
}: ClubArticlePageProps) {
	const { clubShortName, slug } = await params;
	const club = await fetchClub(clubShortName);
	if (!club) notFound();
	const article = await fetchArticle(slug, clubShortName);
	if (!article) notFound();

	const [related, nextArticle] = await Promise.all([
		fetchRelated(article, clubShortName),
		fetchNextArticle(article, clubShortName),
	]);

	// NOTE: Default DOMPurify allowlist. For Phase 15b (MindStudio-style CTAs),
	// extend with ADD_ATTR: ["data-cta", "data-cta-id", "data-cta-variant"]
	// and ADD_TAGS as needed for any new HTML primitives the CTA TipTap node emits.
	// See designFiles/roadmap/phase15-articles-and-announcements.md §"CTA support".
	const safeHtml = DOMPurify.sanitize(article.bodyHtml);
	const canonical = getClubPublicUrl(club, `/articles/${article.slug}`);
	const absoluteCover = article.coverImageUrl
		? `${SITE_URL}${article.coverImageUrl}`
		: null;
	const description = buildDescription(article);
	const urlBase = `/${clubShortName}/articles`;

	// schema.org BlogPosting — publisher is the CLUB, not Facility Presence.
	// Logo URL falls back to the platform favicon until clubs have their own
	// logos in the schema (no Club.logoUrl field today).
	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		headline: article.title,
		description,
		datePublished: article.publishedAt.toISOString(),
		author: {
			"@type": "Person",
			name: article.author.name,
		},
		publisher: {
			"@type": "Organization",
			name: club.clubName,
			logo: {
				"@type": "ImageObject",
				url: `${SITE_URL}/favicon.ico`,
			},
		},
		mainEntityOfPage: {
			"@type": "WebPage",
			"@id": canonical,
		},
		...(absoluteCover ? { image: [absoluteCover] } : {}),
	};

	return (
		<div className="marketing-page">
			<script
				type="application/ld+json"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify of static structured-data object — no user input
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>

			<article>
				{/* Hero */}
				<header className="pt-8 pb-10 md:pt-12">
					<div className="container mx-auto px-4">
						<div className="mx-auto max-w-[820px]">
							<div className="eyebrow mb-4">
								<Link href={urlBase} className="hover:text-[var(--ink-2)]">
									<span className="eyebrow-dot">●</span>
									&nbsp;&nbsp;ARTICLES
								</Link>
							</div>
							<h1 className="max-w-[820px]">{article.title}</h1>
							{article.excerpt ? (
								<p className="lead mt-5 max-w-[760px]">{article.excerpt}</p>
							) : null}

							<div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3 text-[14px] text-[var(--ink-3)]">
								<div className="flex items-center gap-2.5 text-[var(--ink-2)]">
									{article.author.avatarUrl ? (
										<img
											src={article.author.avatarUrl}
											alt={article.author.name}
											className="h-8 w-8 rounded-full object-cover"
										/>
									) : (
										<span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--paper-2)] font-medium text-[12px] text-[var(--ink-2)]">
											{article.author.name.charAt(0)}
										</span>
									)}
									<span className="font-medium">{article.author.name}</span>
								</div>
								<span aria-hidden="true">·</span>
								<time dateTime={article.publishedAt.toISOString()}>
									{formatLongDate(article.publishedAt)}
								</time>
								<span aria-hidden="true">·</span>
								<span>{article.readingTimeMinutes} min read</span>
							</div>

							{article.tags.length > 0 ? (
								<div className="mt-5 flex flex-wrap gap-1.5">
									{article.tags.map((tag) => (
										<Link
											key={tag.slug}
											href={`${urlBase}/tag/${tag.slug}`}
											className="rounded-full border border-[var(--line)] bg-[var(--paper-2)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.06em] hover:border-[var(--line-2)] hover:text-[var(--ink-2)]"
										>
											{tag.name}
										</Link>
									))}
								</div>
							) : null}
						</div>
					</div>
				</header>

				{absoluteCover ? (
					<div className="container mx-auto px-4">
						<div className="mx-auto max-w-[1040px]">
							<div className="overflow-hidden rounded-[20px] border border-[var(--line)] bg-[var(--paper-2)]">
								<img
									src={article.coverImageUrl ?? undefined}
									alt={article.coverImageAlt ?? article.title}
									className="aspect-[16/9] w-full object-cover"
								/>
							</div>
						</div>
					</div>
				) : null}

				{/* Body */}
				<div className="pt-12 pb-16 md:pt-16 md:pb-20">
					<div className="container mx-auto px-4">
						<div
							className="prose prose-lg mx-auto max-w-[760px] prose-img:rounded-xl prose-blockquote:border-l-[var(--brand)] prose-headings:font-display prose-a:text-[var(--brand)] prose-blockquote:text-[var(--ink-2)] prose-code:text-[var(--ink)] prose-headings:text-[var(--ink)] prose-p:text-[var(--ink-2)] prose-strong:text-[var(--ink)] prose-a:no-underline hover:prose-a:underline"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via isomorphic-dompurify before render
							dangerouslySetInnerHTML={{ __html: safeHtml }}
						/>
					</div>
				</div>

				{/* Author block */}
				<section className="border-[var(--line)] border-t bg-[var(--paper-2)] py-14">
					<div className="container mx-auto px-4">
						<div className="mx-auto flex max-w-[760px] flex-col gap-5 sm:flex-row sm:items-start">
							{article.author.avatarUrl ? (
								<img
									src={article.author.avatarUrl}
									alt={article.author.name}
									className="h-16 w-16 shrink-0 rounded-full object-cover"
								/>
							) : (
								<span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--paper)] font-medium text-[24px] text-[var(--ink-2)]">
									{article.author.name.charAt(0)}
								</span>
							)}
							<div className="flex-1">
								<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
									Written by
								</div>
								<div className="mt-1 inline-block font-display font-semibold text-[20px] text-[var(--ink)]">
									{article.author.name}
								</div>
								{article.author.bio ? (
									<p className="mt-2 text-[15px] text-[var(--ink-2)] leading-relaxed">
										{article.author.bio}
									</p>
								) : null}
							</div>
						</div>
					</div>
				</section>

				{/* Next article */}
				{nextArticle ? (
					<section className="py-14">
						<div className="container mx-auto px-4">
							<div className="mx-auto max-w-[760px]">
								<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
									Read next
								</div>
								<Link
									href={`${urlBase}/${nextArticle.slug}`}
									className="group hover:-translate-y-0.5 mt-3 block rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 transition-all hover:border-[var(--line-2)] hover:shadow-[0_6px_24px_-8px_rgba(20,19,14,0.1)]"
								>
									<h3 className="font-display font-semibold text-[22px] text-[var(--ink)] leading-snug tracking-[-0.01em] group-hover:text-[var(--brand)]">
										{nextArticle.title}
									</h3>
									{nextArticle.excerpt ? (
										<p className="mt-2 line-clamp-2 text-[14.5px] text-[var(--ink-2)]">
											{nextArticle.excerpt}
										</p>
									) : null}
									<div className="mt-3 inline-flex items-center gap-1.5 font-medium text-[13px] text-[var(--brand)]">
										Continue reading
										<span aria-hidden="true">→</span>
									</div>
								</Link>
							</div>
						</div>
					</section>
				) : null}

				{/* Related articles */}
				{related.length > 0 ? (
					<section className="border-[var(--line)] border-t bg-[var(--paper)] py-16">
						<div className="container mx-auto px-4">
							<div className="mb-8 flex items-end justify-between gap-4">
								<div>
									<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
										Related
									</div>
									<h2 className="mt-2 font-display font-semibold text-[28px] text-[var(--ink)]">
										More on {article.tags[0]?.name ?? "articles"}
									</h2>
								</div>
								<Link
									href={urlBase}
									className="hidden text-[14px] text-[var(--ink-2)] hover:text-[var(--brand)] sm:inline"
								>
									All articles →
								</Link>
							</div>
							<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
								{related.map((p) => (
									<ArticleCard key={p.id} article={p} urlBase={urlBase} />
								))}
							</div>
						</div>
					</section>
				) : null}
			</article>
		</div>
	);
}
