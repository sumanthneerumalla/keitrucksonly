import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleCard } from "~/app/_components/client/public/articles/ArticleCard";
import type { ArticleCard as ArticleCardType } from "~/lib/article";
import { getClubPublicUrl } from "~/lib/clubPublicUrl";
import { db } from "~/server/db";
import { api } from "~/trpc/server";

export const revalidate = 60;

interface ClubTagPageProps {
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

async function fetchTag(
	slug: string,
	clubShortName: string,
): Promise<{ name: string; slug: string } | null> {
	try {
		return await api.articles.getTagBySlug({ slug, clubShortName });
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

async function fetchArticles(
	tagSlug: string,
	clubShortName: string,
): Promise<ArticleCardType[]> {
	try {
		const res = await api.articles.listPublished({
			clubShortName,
			limit: 24,
			tagSlug,
		});
		return res.items;
	} catch {
		return [];
	}
}

export async function generateMetadata({
	params,
}: ClubTagPageProps): Promise<Metadata> {
	const { clubShortName, slug } = await params;
	const [club, tag] = await Promise.all([
		fetchClub(clubShortName),
		fetchTag(slug, clubShortName),
	]);
	if (!club || !tag) {
		return {
			title: "Tag not found",
			description: "This tag could not be found.",
		};
	}
	const title = `Articles tagged ${tag.name} | ${club.clubName}`;
	const description = `Articles from ${club.clubName} tagged "${tag.name}".`;
	const url = getClubPublicUrl(club, `/articles/tag/${tag.slug}`);
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

export default async function ClubTagArchivePage({ params }: ClubTagPageProps) {
	const { clubShortName, slug } = await params;
	const club = await fetchClub(clubShortName);
	if (!club) notFound();
	const tag = await fetchTag(slug, clubShortName);
	if (!tag) notFound();

	const articles = await fetchArticles(tag.slug, clubShortName);
	const urlBase = `/${clubShortName}/articles`;

	return (
		<div className="marketing-page">
			<section className="pt-8 pb-8 md:pt-12">
				<div className="container mx-auto px-4">
					<div className="eyebrow">
						<Link href={urlBase} className="hover:text-[var(--ink-2)]">
							<span className="eyebrow-dot">●</span>
							&nbsp;&nbsp;ARTICLES / TAG
						</Link>
					</div>
					<h1 className="mt-3.5 max-w-[900px]">
						Articles tagged <span className="accent">{tag.name}</span>
					</h1>
					<p className="lead mt-5 max-w-[720px]">
						Every {club.clubName} article on{" "}
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
									href={urlBase}
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
								<ArticleCard key={p.id} article={p} urlBase={urlBase} />
							))}
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
