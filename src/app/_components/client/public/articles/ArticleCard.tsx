import Link from "next/link";
import type { ArticleCard as ArticleCardType } from "~/lib/article";

interface ArticleCardProps {
	article: ArticleCardType;
	/**
	 * URL prefix for article + tag links. Defaults to "/articles" (platform).
	 * Pass "/<clubShortName>/articles" to render a club-scoped card whose
	 * Links route through the per-club surface (Phase 15 Step 4).
	 */
	urlBase?: string;
}

// Formats a Date as e.g. "May 27, 2026". Plain Intl — avoids pulling dayjs
// into a server component that's already cheap to render.
function formatDate(d: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(d);
}

/**
 * Server-safe presentational card used on the articles index, tag archive,
 * author archive, and the "related articles" rail on the article page.
 *
 * No client interactivity — keeps the page fully static / streamable and
 * means the parent doesn't need to push a client-component boundary.
 */
export function ArticleCard({
	article,
	urlBase = "/articles",
}: ArticleCardProps) {
	return (
		<article className="group hover:-translate-y-0.5 flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] transition-all duration-200 hover:border-[var(--line-2)] hover:shadow-[0_6px_24px_-8px_rgba(20,19,14,0.1)]">
			{article.coverImageUrl ? (
				<Link
					href={`${urlBase}/${article.slug}`}
					className="relative block aspect-[16/9] overflow-hidden bg-[var(--paper-2)]"
				>
					{/* Plain <img> — coverImageUrl is /api/content-image/<id> which Next
					 * Image would need to be configured for as a remote pattern, and
					 * Next/Image already adds runtime overhead we don't need for the
					 * stream-from-DB image route. */}
					<img
						src={article.coverImageUrl}
						alt={article.title}
						loading="lazy"
						className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
					/>
				</Link>
			) : null}

			<div className="flex flex-1 flex-col gap-3 p-6">
				{article.tags.length > 0 ? (
					<div className="flex flex-wrap gap-1.5">
						{article.tags.slice(0, 3).map((tag) => (
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

				<h3 className="font-display font-semibold text-[20px] text-[var(--ink)] leading-snug tracking-[-0.01em]">
					<Link
						href={`${urlBase}/${article.slug}`}
						className="hover:text-[var(--brand)]"
					>
						{article.title}
					</Link>
				</h3>

				{article.excerpt ? (
					<p className="line-clamp-3 text-[14.5px] text-[var(--ink-2)] leading-relaxed">
						{article.excerpt}
					</p>
				) : null}

				<div className="mt-auto flex items-center justify-between gap-3 pt-3 text-[12.5px] text-[var(--ink-3)]">
					<span className="truncate">{article.author.name}</span>
					<span className="flex shrink-0 items-center gap-2">
						<time dateTime={article.publishedAt.toISOString()}>
							{formatDate(article.publishedAt)}
						</time>
						<span aria-hidden="true">·</span>
						<span>{article.readingTimeMinutes} min</span>
					</span>
				</div>
			</div>
		</article>
	);
}
