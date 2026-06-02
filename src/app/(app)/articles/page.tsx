import type { Metadata } from "next";
import Link from "next/link";
import { ArticleCard } from "~/app/_components/client/public/articles/ArticleCard";
import type { ArticleCard as ArticleCardType } from "~/lib/article";
import { SITE_URL } from "~/lib/marketing";
import { api } from "~/trpc/server";

// ISR — rebuild at most every 60 seconds. Editorial cadence is slow; this is
// the cheapest way to keep new articles visible without a full re-deploy.
export const revalidate = 60;

const PAGE_TITLE = "Articles | Facility Presence";
const PAGE_DESCRIPTION =
	"Articles on running a racquet-sports facility — operations, member experience, growth.";
const PAGE_HEADING = "From the team";
const PAGE_LEDE =
	"Notes on building, running, and growing racquet-sports facilities — pulled straight from the operators we work with every day.";

export const metadata: Metadata = {
	title: PAGE_TITLE,
	description: PAGE_DESCRIPTION,
	alternates: { canonical: `${SITE_URL}/articles` },
	openGraph: {
		title: PAGE_TITLE,
		description: PAGE_DESCRIPTION,
		url: `${SITE_URL}/articles`,
		type: "website",
		siteName: "Facility Presence",
	},
	twitter: {
		card: "summary_large_image",
		title: PAGE_TITLE,
		description: PAGE_DESCRIPTION,
	},
};

type TagChip = { name: string; slug: string; count: number };

// Wrap the DB-touching calls so a transient Prisma/cache failure during
// build or ISR regeneration falls back to a renderable empty state instead
// of crashing the route. The router is expected to succeed in steady state.
async function loadIndexData(): Promise<{
	articles: ArticleCardType[];
	tags: TagChip[];
}> {
	try {
		const [articles, tags] = await Promise.all([
			api.articles.listPublished({ limit: 12 }),
			api.articles.listTags(),
		]);
		return { articles: articles.items, tags };
	} catch {
		return { articles: [], tags: [] };
	}
}

export default async function ArticlesIndexPage() {
	const { articles, tags } = await loadIndexData();

	return (
		<div className="marketing-page">
			<section className="pt-8 pb-8 md:pt-12">
				<div className="container mx-auto px-4">
					<div className="eyebrow">
						<span className="eyebrow-dot">●</span>
						&nbsp;&nbsp;ARTICLES
					</div>
					<h1 className="mt-3.5 max-w-[900px]">{PAGE_HEADING}</h1>
					<p className="lead mt-5 max-w-[720px]">{PAGE_LEDE}</p>

					{tags.length > 0 ? (
						<div className="mt-9 flex flex-wrap gap-2">
							{tags.map((tag) => (
								<Link
									key={tag.slug}
									href={`/articles/tag/${tag.slug}`}
									className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-3.5 py-1.5 text-[13px] text-[var(--ink-2)] transition-colors hover:border-[var(--line-2)] hover:text-[var(--ink)]"
								>
									{tag.name}
									<span className="ml-1.5 font-mono text-[11px] text-[var(--ink-3)]">
										{tag.count}
									</span>
								</Link>
							))}
						</div>
					) : null}
				</div>
			</section>

			<section className="pb-20 md:pb-[120px]">
				<div className="container mx-auto px-4">
					{articles.length === 0 ? (
						<div className="rounded-2xl border border-[var(--line)] border-dashed bg-[var(--paper)] p-12 text-center">
							<h2 className="font-display font-semibold text-[24px] text-[var(--ink)]">
								Nothing published yet
							</h2>
							<p className="mx-auto mt-3 max-w-[460px] text-[var(--ink-2)]">
								We're working on it. Check back soon, or subscribe via{" "}
								<Link
									href="/articles/rss.xml"
									className="text-[var(--brand)] underline hover:no-underline"
								>
									RSS
								</Link>
								.
							</p>
						</div>
					) : (
						<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
							{articles.map((article) => (
								<ArticleCard key={article.id} article={article} />
							))}
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
