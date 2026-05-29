import DOMPurify from "isomorphic-dompurify";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleCard } from "~/app/_components/client/public/articles/ArticleCard";
import type {
	ArticleCard as ArticleCardType,
	ArticleDetail,
} from "~/lib/article";
import { SITE_URL } from "~/lib/marketing";
import { api } from "~/trpc/server";

// ISR — same 60s rebuild window as the index. Pages render on-demand the
// first time they're requested and stay cached until the next revalidation.
export const revalidate = 60;

// Build-safe: do not statically generate any slugs at build time. Pages get
// generated on first request and cached. Keeps the build from depending on
// DB availability.
export async function generateStaticParams() {
	return [];
}

interface ArticlePageProps {
	params: Promise<{ slug: string }>;
}

// Pull article by slug, swallowing NOT_FOUND so we can render a 404 ourselves.
// Any other error rethrows so Next.js error boundary handles it.
async function fetchArticle(slug: string): Promise<ArticleDetail | null> {
	try {
		return await api.articles.getBySlug({ slug });
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

// Compose the description used in <meta description>, OG, and Twitter. Falls
// back through metaDescription → excerpt → first 160 chars of stripped body.
function buildDescription(article: ArticleDetail): string {
	if (article.metaDescription) return article.metaDescription;
	if (article.excerpt) return article.excerpt;
	const stripped = stripHtml(article.bodyHtml);
	return stripped.length > 160 ? `${stripped.slice(0, 157).trim()}…` : stripped;
}

export async function generateMetadata({
	params,
}: ArticlePageProps): Promise<Metadata> {
	const { slug } = await params;
	const article = await fetchArticle(slug);

	if (!article) {
		return {
			title: "Article not found | Facility Presence",
			description: "This article could not be found.",
		};
	}

	const title = article.metaTitle || article.title;
	const description = buildDescription(article);
	const url = `${SITE_URL}/articles/${article.slug}`;
	const absoluteCover = article.coverImageUrl
		? `${SITE_URL}${article.coverImageUrl}`
		: null;

	return {
		title: `${title} | Facility Presence`,
		description,
		alternates: { canonical: url },
		openGraph: {
			title,
			description,
			type: "article",
			url,
			siteName: "Facility Presence",
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

// Related articles: pull up to 4 with the same primary tag, drop self, take 3.
// We over-fetch by 1 in case the current article is in the first window.
async function fetchRelated(
	article: ArticleDetail,
): Promise<ArticleCardType[]> {
	const primaryTag = article.tags[0]?.slug;
	if (!primaryTag) return [];
	try {
		const res = await api.articles.listPublished({
			limit: 4,
			tagSlug: primaryTag,
		});
		return res.items.filter((p) => p.id !== article.id).slice(0, 3);
	} catch {
		return [];
	}
}

// Next (older) article: pass current article.id as cursor; listPublished orders
// by [publishedAt desc, id desc] with `skip: 1`, so the first row back is the
// next-older published article. Returns null at the end of the list.
//
// Previous (newer) article is intentionally NOT implemented: the public router
// only exposes a single forward-paginated cursor and a reverse query would
// require either a new procedure or fetching the full list. The brief
// allows skipping when it's not easy — we surface a "next" arrow only.
async function fetchNextArticle(
	article: ArticleDetail,
): Promise<ArticleCardType | null> {
	try {
		const res = await api.articles.listPublished({
			limit: 1,
			cursor: article.id,
		});
		return res.items[0] ?? null;
	} catch {
		return null;
	}
}

export default async function ArticlePage({ params }: ArticlePageProps) {
	const { slug } = await params;
	const article = await fetchArticle(slug);
	if (!article) notFound();

	const [related, nextArticle] = await Promise.all([
		fetchRelated(article),
		fetchNextArticle(article),
	]);

	// NOTE: Default DOMPurify allowlist. For Phase 15b (MindStudio-style CTAs),
	// extend with ADD_ATTR: ["data-cta", "data-cta-id", "data-cta-variant"]
	// and ADD_TAGS as needed for any new HTML primitives the CTA TipTap node emits.
	// See designFiles/roadmap/phase15-articles-and-announcements.md §"CTA support".
	const safeHtml = DOMPurify.sanitize(article.bodyHtml);
	const canonical = `${SITE_URL}/articles/${article.slug}`;
	const absoluteCover = article.coverImageUrl
		? `${SITE_URL}${article.coverImageUrl}`
		: null;
	const description = buildDescription(article);

	// schema.org BlogPosting — embedded inline. ArticleDetail doesn't carry
	// dateModified (no `updatedAt` on the shape), so we omit it; Google
	// treats datePublished as the lastmod when dateModified is absent.
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
			name: "Facility Presence",
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
								<Link href="/articles" className="hover:text-[var(--ink-2)]">
									<span className="eyebrow-dot">●</span>
									&nbsp;&nbsp;ARTICLES
								</Link>
							</div>
							<h1 className="max-w-[820px]">{article.title}</h1>
							{article.excerpt ? (
								<p className="lead mt-5 max-w-[760px]">{article.excerpt}</p>
							) : null}

							<div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3 text-[14px] text-[var(--ink-3)]">
								<Link
									href={`/articles/author/${article.author.userId}`}
									className="flex items-center gap-2.5 text-[var(--ink-2)] hover:text-[var(--ink)]"
								>
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
								</Link>
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
											href={`/articles/tag/${tag.slug}`}
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
								{/* Server-rendered <img>: the cover URL is /api/content-image/<id>
								 * (DB-backed route), not part of a remote-patterns config for
								 * next/image, so we render directly. */}
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
								<Link
									href={`/articles/author/${article.author.userId}`}
									className="mt-1 inline-block font-display font-semibold text-[20px] text-[var(--ink)] hover:text-[var(--brand)]"
								>
									{article.author.name}
								</Link>
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
									href={`/articles/${nextArticle.slug}`}
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
									href="/articles"
									className="hidden text-[14px] text-[var(--ink-2)] hover:text-[var(--brand)] sm:inline"
								>
									All articles →
								</Link>
							</div>
							<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
								{related.map((p) => (
									<ArticleCard key={p.id} article={p} />
								))}
							</div>
						</div>
					</section>
				) : null}
			</article>
		</div>
	);
}
