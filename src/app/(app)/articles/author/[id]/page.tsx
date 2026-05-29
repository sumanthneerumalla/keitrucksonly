import type { Metadata } from "next";
import Link from "next/link";
import { ArticleCard } from "~/app/_components/client/public/articles/ArticleCard";
import type { ArticleCard as ArticleCardType } from "~/lib/article";
import { SITE_URL } from "~/lib/marketing";
import { api } from "~/trpc/server";

export const revalidate = 60;

interface AuthorPageProps {
	params: Promise<{ id: string }>;
}

async function fetchAuthorArticles(
	authorId: string,
): Promise<ArticleCardType[]> {
	try {
		const res = await api.articles.listByAuthor({ authorId, limit: 24 });
		return res.items;
	} catch {
		return [];
	}
}

// We don't have a dedicated user-profile procedure available in this scope,
// so the author display name + avatar is derived from the first article's
// embedded author block (ArticleCard.author). That gives us a name on every
// page that actually has content; the empty-state page falls back to
// generic copy.
function deriveAuthorMeta(articles: ArticleCardType[]): {
	name: string;
	avatarUrl: string | null;
} {
	const first = articles[0];
	if (first) return first.author;
	return { name: "Author", avatarUrl: null };
}

export async function generateMetadata({
	params,
}: AuthorPageProps): Promise<Metadata> {
	const { id } = await params;
	const articles = await fetchAuthorArticles(id);
	const author = deriveAuthorMeta(articles);
	const title =
		articles.length === 0
			? "Author archive | Facility Presence"
			: `Articles by ${author.name} | Facility Presence`;
	const description =
		articles.length === 0
			? "Author archive on the Facility Presence site."
			: `Articles written by ${author.name} on the Facility Presence site.`;
	const url = `${SITE_URL}/articles/author/${id}`;
	return {
		title,
		description,
		alternates: { canonical: url },
		openGraph: {
			title,
			description,
			url,
			type: "profile",
			siteName: "Facility Presence",
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}

export default async function AuthorArchivePage({ params }: AuthorPageProps) {
	const { id } = await params;
	const articles = await fetchAuthorArticles(id);
	const author = deriveAuthorMeta(articles);

	return (
		<div className="marketing-page">
			<section className="pt-8 pb-8 md:pt-12">
				<div className="container mx-auto px-4">
					<div className="eyebrow">
						<Link href="/articles" className="hover:text-[var(--ink-2)]">
							<span className="eyebrow-dot">●</span>
							&nbsp;&nbsp;ARTICLES / AUTHOR
						</Link>
					</div>

					<div className="mt-6 flex items-center gap-4">
						{author.avatarUrl ? (
							<img
								src={author.avatarUrl}
								alt={author.name}
								className="h-16 w-16 rounded-full object-cover"
							/>
						) : (
							<span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--paper-2)] font-medium text-[24px] text-[var(--ink-2)]">
								{author.name.charAt(0)}
							</span>
						)}
						<div>
							<h1 className="!text-[40px] md:!text-[52px]">{author.name}</h1>
						</div>
					</div>

					<p className="lead mt-5 max-w-[720px]">
						{articles.length === 0
							? "No articles published yet."
							: `Every article ${author.name} has written for Facility Presence, newest first.`}
					</p>
				</div>
			</section>

			<section className="pb-20 md:pb-[120px]">
				<div className="container mx-auto px-4">
					{articles.length === 0 ? (
						<div className="rounded-2xl border border-[var(--line)] border-dashed bg-[var(--paper)] p-12 text-center">
							<h2 className="font-display font-semibold text-[24px] text-[var(--ink)]">
								No articles yet
							</h2>
							<p className="mx-auto mt-3 max-w-[460px] text-[var(--ink-2)]">
								Check back later, or{" "}
								<Link
									href="/articles"
									className="text-[var(--brand)] underline hover:no-underline"
								>
									browse all articles
								</Link>
								.
							</p>
						</div>
					) : (
						<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
							{articles.map((p) => (
								<ArticleCard key={p.id} article={p} />
							))}
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
