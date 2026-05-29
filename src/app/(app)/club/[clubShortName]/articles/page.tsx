import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleCard } from "~/app/_components/client/public/articles/ArticleCard";
import type { ArticleCard as ArticleCardType } from "~/lib/article";
import { SITE_URL } from "~/lib/marketing";
import { db } from "~/server/db";
import { api } from "~/trpc/server";

// ISR — same 60s rebuild window as the platform article index.
export const revalidate = 60;

interface ClubArticlesIndexPageProps {
	params: Promise<{ clubShortName: string }>;
}

type TagChip = { name: string; slug: string; count: number };

async function loadIndexData(clubShortName: string): Promise<{
	articles: ArticleCardType[];
	tags: TagChip[];
}> {
	try {
		const [articles, tags] = await Promise.all([
			api.articles.listPublished({ clubShortName, limit: 12 }),
			api.articles.listTags({ clubShortName }),
		]);
		return { articles: articles.items, tags };
	} catch {
		return { articles: [], tags: [] };
	}
}

// Fetch club display name + existence check. Returns null on missing club so
// the page can route to notFound().
async function fetchClub(
	clubShortName: string,
): Promise<{ clubShortName: string; clubName: string } | null> {
	return db.club.findUnique({
		where: { clubShortName },
		select: { clubShortName: true, clubName: true },
	});
}

export async function generateMetadata({
	params,
}: ClubArticlesIndexPageProps): Promise<Metadata> {
	const { clubShortName } = await params;
	const club = await fetchClub(clubShortName);
	if (!club) {
		return {
			title: "Articles not found",
			description: "This club's articles could not be found.",
		};
	}
	const title = `${club.clubName} Articles`;
	const description = `Articles from ${club.clubName} — news, updates, and stories from the club.`;
	const url = `${SITE_URL}/${clubShortName}/articles`;
	return {
		title,
		description,
		alternates: { canonical: url },
		openGraph: {
			title,
			description,
			url,
			type: "website",
			siteName: club.clubName,
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}

export default async function ClubArticlesIndexPage({
	params,
}: ClubArticlesIndexPageProps) {
	const { clubShortName } = await params;
	const club = await fetchClub(clubShortName);
	if (!club) notFound();

	const { articles, tags } = await loadIndexData(clubShortName);
	const urlBase = `/${clubShortName}/articles`;

	return (
		<div className="marketing-page">
			<section className="pt-8 pb-8 md:pt-12">
				<div className="container mx-auto px-4">
					<div className="eyebrow">
						<span className="eyebrow-dot">●</span>
						&nbsp;&nbsp;ARTICLES
					</div>
					<h1 className="mt-3.5 max-w-[900px]">From {club.clubName}</h1>
					<p className="lead mt-5 max-w-[720px]">
						News, updates, and stories from {club.clubName}.
					</p>

					{tags.length > 0 ? (
						<div className="mt-9 flex flex-wrap gap-2">
							{tags.map((tag) => (
								<Link
									key={tag.slug}
									href={`${urlBase}/tag/${tag.slug}`}
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
								Check back soon, or subscribe via{" "}
								<Link
									href={`${urlBase}/rss.xml`}
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
								<ArticleCard
									key={article.id}
									article={article}
									urlBase={urlBase}
								/>
							))}
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
