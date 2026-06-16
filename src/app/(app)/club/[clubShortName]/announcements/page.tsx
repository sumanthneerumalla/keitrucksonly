import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AnnouncementFeed from "~/app/_components/client/public/announcements/AnnouncementFeed";
import type { AnnouncementCard } from "~/lib/announcement";
import { getClubPublicUrl } from "~/lib/clubPublicUrl";
import { db } from "~/server/db";
import { api } from "~/trpc/server";

// Phase 15 Step 6 — Public single-feed page for a club's announcements.
// Mirrors the club articles page chrome (`marketing-page` wrapper, eyebrow,
// `.container mx-auto px-4`). NO per-announcement detail page — the feed is
// the canonical surface.

// ISR — same 60s rebuild window as the club article pages.
export const revalidate = 60;

// Build-safe: render on demand, no static params at build time.
export async function generateStaticParams() {
	return [];
}

interface ClubAnnouncementsPageProps {
	params: Promise<{ clubShortName: string }>;
}

async function loadFeedData(clubShortName: string): Promise<{
	items: AnnouncementCard[];
	nextCursor?: string;
}> {
	try {
		const res = await api.announcements.listPublished({
			clubShortName,
			limit: 20,
		});
		return res;
	} catch {
		return { items: [] };
	}
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

export async function generateMetadata({
	params,
}: ClubAnnouncementsPageProps): Promise<Metadata> {
	const { clubShortName } = await params;
	const club = await fetchClub(clubShortName);
	if (!club) {
		return {
			title: "Announcements not found",
			description: "This club's announcements could not be found.",
		};
	}
	const title = `${club.clubName} Announcements`;
	const description = `Latest announcements and updates from ${club.clubName}.`;
	const url = getClubPublicUrl(club, "/announcements");
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
			card: "summary",
			title,
			description,
		},
	};
}

export default async function ClubAnnouncementsPage({
	params,
}: ClubAnnouncementsPageProps) {
	const { clubShortName } = await params;
	const club = await fetchClub(clubShortName);
	if (!club) notFound();

	const { items, nextCursor } = await loadFeedData(clubShortName);

	return (
		<div className="marketing-page">
			<section className="pt-8 pb-8 md:pt-12">
				<div className="container mx-auto px-4">
					<div className="eyebrow">
						<span className="eyebrow-dot">●</span>
						&nbsp;&nbsp;ANNOUNCEMENTS
					</div>
					<h1 className="mt-3.5 max-w-[900px]">From {club.clubName}</h1>
					<p className="lead mt-5 max-w-[720px]">
						The latest updates, notices, and news from {club.clubName}.
					</p>
				</div>
			</section>

			<section className="pb-20 md:pb-[120px]">
				<div className="container mx-auto px-4">
					<AnnouncementFeed
						clubShortName={clubShortName}
						initialItems={items}
						initialCursor={nextCursor}
					/>
				</div>
			</section>
		</div>
	);
}
