import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleCard } from "~/app/_components/client/public/articles/ArticleCard";
import type { ArticleCard as ArticleCardType } from "~/lib/article";
import { SITE_URL } from "~/lib/marketing";
import { api } from "~/trpc/server";

export const revalidate = 60;

interface TagPageProps {
	params: Promise<{ slug: string }>;
}

// Resolve the tag display name; null on NOT_FOUND so we can route to 404.
async function fetchTag(
	slug: string,
): Promise<{ name: string; slug: string } | null> {
	try {
		return await api.articles.getTagBySlug({ slug });
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

async function fetchArticles(tagSlug: string): Promise<ArticleCardType[]> {
	try {
		const res = await api.articles.listPublished({ limit: 24, tagSlug });
		return res.items;
	} catch {
		return [];
	}
}

export async function generateMetadata({
	params,
}: TagPageProps): Promise<Metadata> {
	const { slug } = await params;
	const tag = await fetchTag(slug);
	if (!tag) {
		return {
			title: "Tag not found | Facility Presence",
			description: "This tag could not be found.",
		};
	}
	const title = `Articles tagged ${tag.name} | Facility Presence`;
	const description = `Articles tagged "${tag.name}" on the Facility Presence site — operations, member experience, and growth for racquet-sports facilities.`;
	const url = `${SITE_URL}/articles/tag/${tag.slug}`;
	return {
		title,
		description,
		alternates: { canonical: url },
		openGraph: {
			title,
			description,
			url,
			type: "website",
			siteName: "Facility Presence",
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}

export default async function TagArchivePage({ params }: TagPageProps) {
	const { slug } = await params;
	const tag = await fetchTag(slug);
	if (!tag) notFound();

	const articles = await fetchArticles(tag.slug);

	return (
		<div className="marketing-page">
			<section className="pt-8 pb-8 md:pt-12">
				<div className="container mx-auto px-4">
					<div className="eyebrow">
						<Link href="/articles" className="hover:text-[var(--ink-2)]">
							<span className="eyebrow-dot">●</span>
							&nbsp;&nbsp;ARTICLES / TAG
						</Link>
					</div>
					<h1 className="mt-3.5 max-w-[900px]">
						Articles tagged <span className="accent">{tag.name}</span>
					</h1>
					<p className="lead mt-5 max-w-[720px]">
						Every article we've written on{" "}
						<span className="font-medium">{tag.name}</span>, newest first.
					</p>
				</div>
			</section>

			<section className="pb-20 md:pb-[120px]">
				<div className="container mx-auto px-4">
					{articles.length === 0 ? (
						<div className="rounded-2xl border border-[var(--line)] border-dashed bg-[var(--paper)] p-12 text-center">
							<h2 className="font-display font-semibold text-[24px] text-[var(--ink)]">
								No articles in this tag yet
							</h2>
							<p className="mx-auto mt-3 max-w-[460px] text-[var(--ink-2)]">
								Check back soon, or{" "}
								<Link
									href="/articles"
									className="text-[var(--brand)] underline hover:no-underline"
								>
									browse every article
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
