import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AnnouncementFeed from "~/app/_components/client/public/announcements/AnnouncementFeed";
import { ArticleCard } from "~/app/_components/client/public/articles/ArticleCard";
import { DAYS_OF_WEEK, operatingHoursSchema } from "~/lib/clubProfile";
import { clubOgImageUrl, getClubBaseUrl } from "~/lib/clubPublicUrl";
import { SITE_URL } from "~/lib/marketing";
import { db } from "~/server/db";
import { api } from "~/trpc/server";
import { ClubLandingHero } from "./ClubLandingHero";
import { ClubLocationsSection } from "./ClubLocationsSection";
import { ClubUpcomingEvents } from "./ClubUpcomingEvents";

// ISR — the landing page is statically cached and refreshed at most every 5
// minutes. revalidateClub() (D9) busts it sooner on branding/facility edits.
// Single-node Docker → the filesystem ISR cache works with no extra infra.
export const revalidate = 300;

interface ClubPageProps {
	// since Next.js 15, dynamic route params are async and must be awaited.
	params: Promise<{ clubShortName: string }>;
}

// Phase 16 Step 1 — club landing metadata. The canonical points at the club's
// public base URL (the `/<short>` rewrite form, or `canonicalDomain` once set),
// which also de-duplicates the directly-reachable internal /club/<short> path.
export async function generateMetadata({
	params,
}: ClubPageProps): Promise<Metadata> {
	const { clubShortName } = await params;
	const club = await db.club.findUnique({
		where: { clubShortName },
		select: {
			clubShortName: true,
			clubName: true,
			description: true,
			canonicalDomain: true,
			logoImageId: true,
			heroImageId: true,
			facilities: {
				where: { isActive: true },
				orderBy: { position: "asc" },
				take: 1,
				select: { city: true, state: true },
			},
		},
	});
	if (!club) {
		return {
			title: "Club not found",
			description: "This club could not be found.",
		};
	}

	const facility = club.facilities[0];
	const location =
		facility?.city && facility?.state
			? `${facility.city}, ${facility.state}`
			: null;
	const title = location ? `${club.clubName} — ${location}` : club.clubName;
	const description =
		club.description?.slice(0, 155) ||
		`Upcoming events, programs, and court bookings at ${club.clubName}${location ? ` in ${location}` : ""}.`;
	const url = getClubBaseUrl(club);
	const ogImage = clubOgImageUrl(club);
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
			images: [ogImage],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images: [ogImage],
		},
	};
}

const SCHEMA_DAY: Record<(typeof DAYS_OF_WEEK)[number], string> = {
	mon: "Monday",
	tue: "Tuesday",
	wed: "Wednesday",
	thu: "Thursday",
	fri: "Friday",
	sat: "Saturday",
	sun: "Sunday",
};

type ClubForJsonLd = {
	clubShortName: string;
	clubName: string;
	description: string | null;
	canonicalDomain: string | null;
	logoImageId: string | null;
	socialLinks: unknown;
};
type FacilityForJsonLd = {
	name: string;
	streetAddress: string | null;
	city: string | null;
	state: string | null;
	zipCode: string | null;
	phone: string | null;
	operatingHours: unknown;
};

// schema.org SportsActivityLocation per active facility (a LocalBusiness
// subtype) — the local-SEO structured-data payload. Falls back to an
// Organization node when the club has no active facilities yet.
function buildClubJsonLd(
	club: ClubForJsonLd,
	facilities: FacilityForJsonLd[],
): Record<string, unknown> | Record<string, unknown>[] {
	const url = getClubBaseUrl(club);
	const image = club.logoImageId
		? `${SITE_URL}/api/content-image/${club.logoImageId}`
		: undefined;
	const sameAs =
		club.socialLinks &&
		typeof club.socialLinks === "object" &&
		!Array.isArray(club.socialLinks)
			? Object.values(club.socialLinks as Record<string, unknown>).filter(
					(v): v is string => typeof v === "string" && v.length > 0,
				)
			: [];

	if (facilities.length === 0) {
		const org: Record<string, unknown> = {
			"@context": "https://schema.org",
			"@type": "Organization",
			name: club.clubName,
			url,
		};
		if (club.description) org.description = club.description;
		if (image) org.image = image;
		if (sameAs.length) org.sameAs = sameAs;
		return org;
	}

	const nodes = facilities.map((f) => {
		const node: Record<string, unknown> = {
			"@context": "https://schema.org",
			"@type": "SportsActivityLocation",
			name:
				facilities.length > 1 ? `${club.clubName} – ${f.name}` : club.clubName,
			url,
		};
		if (club.description) node.description = club.description;
		if (image) node.image = image;
		if (sameAs.length) node.sameAs = sameAs;

		const address: Record<string, unknown> = { "@type": "PostalAddress" };
		if (f.streetAddress) address.streetAddress = f.streetAddress;
		if (f.city) address.addressLocality = f.city;
		if (f.state) address.addressRegion = f.state;
		if (f.zipCode) address.postalCode = f.zipCode;
		if (Object.keys(address).length > 1) node.address = address;
		if (f.phone) node.telephone = f.phone;

		const parsed = operatingHoursSchema.safeParse(f.operatingHours);
		if (parsed.success) {
			const spec = DAYS_OF_WEEK.flatMap((d) => {
				const interval = parsed.data[d];
				return interval
					? [
							{
								"@type": "OpeningHoursSpecification",
								dayOfWeek: `https://schema.org/${SCHEMA_DAY[d]}`,
								opens: interval.open,
								closes: interval.close,
							},
						]
					: [];
			});
			if (spec.length) node.openingHoursSpecification = spec;
		}
		return node;
	});

	return nodes.length === 1 && nodes[0] ? nodes[0] : nodes;
}

/**
 * Club-specific landing page (Phase 16). Server-rendered club-branded body:
 * hero + jobs-to-be-done CTAs, upcoming events, about, latest articles +
 * announcements, and per-facility locations/hours. Logged-out visitors reach
 * it via the short URL /<short> (middleware rewrite); the club chrome
 * (ClubNavBar/ClubFooter) is supplied by AuthedLayout.
 */
export default async function ClubPage({ params }: ClubPageProps) {
	const { clubShortName } = await params;

	const club = await db.club.findUnique({
		where: { clubShortName },
		select: {
			clubShortName: true,
			clubName: true,
			tagline: true,
			description: true,
			canonicalDomain: true,
			logoImageId: true,
			heroImageId: true,
			socialLinks: true,
			facilities: {
				where: { isActive: true },
				orderBy: { position: "asc" },
				select: {
					facilityId: true,
					name: true,
					streetAddress: true,
					city: true,
					state: true,
					zipCode: true,
					phone: true,
					email: true,
					operatingHours: true,
					description: true,
				},
			},
		},
	});
	if (!club) notFound();

	// Latest published content — best-effort; a fetch failure just hides the
	// section rather than failing the whole page.
	const [articles, announcements] = await Promise.all([
		api.articles
			.listPublished({ clubShortName, limit: 3 })
			.then((r) => r.items)
			.catch(() => []),
		api.announcements
			.listPublished({ clubShortName, limit: 3 })
			.then((r) => r.items)
			.catch(() => []),
	]);

	const facilities = club.facilities;
	const primary = facilities[0];
	const location =
		primary?.city && primary?.state
			? `${primary.city}, ${primary.state}`
			: null;
	const jsonLd = buildClubJsonLd(club, facilities);

	return (
		<div>
			<script
				type="application/ld+json"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify of static structured data — no raw user input injected as HTML
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>

			<ClubLandingHero
				clubShortName={clubShortName}
				clubName={club.clubName}
				tagline={club.tagline}
				location={location}
				heroImageId={club.heroImageId}
			/>

			{/* Upcoming events (client widget — facility switcher) */}
			<section id="events" className="scroll-mt-16">
				<div className="container mx-auto px-4 py-12">
					<ClubUpcomingEvents clubShortName={clubShortName} />
				</div>
			</section>

			{/* About */}
			{club.description && (
				<section
					id="about"
					className="scroll-mt-16 border-[var(--line)] border-t"
				>
					<div className="container mx-auto max-w-3xl px-4 py-14">
						<h2 className="mb-4 font-bold text-2xl text-[var(--foreground)]">
							About {club.clubName}
						</h2>
						<p className="whitespace-pre-line text-[var(--muted-foreground)] leading-relaxed">
							{club.description}
						</p>
					</div>
				</section>
			)}

			{/* Latest articles */}
			{articles.length > 0 && (
				<section className="border-[var(--line)] border-t">
					<div className="container mx-auto px-4 py-14">
						<div className="mb-8 flex items-center justify-between">
							<h2 className="font-bold text-2xl text-[var(--foreground)]">
								Latest articles
							</h2>
							<Link
								href={`/club/${clubShortName}/articles`}
								className="text-[var(--primary)] text-sm hover:underline"
							>
								View all →
							</Link>
						</div>
						<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
							{articles.map((article) => (
								<ArticleCard
									key={article.slug}
									article={article}
									urlBase={`/club/${clubShortName}/articles`}
								/>
							))}
						</div>
					</div>
				</section>
			)}

			{/* Announcements teaser */}
			{announcements.length > 0 && (
				<section className="border-[var(--line)] border-t bg-[var(--paper-2)]">
					<div className="container mx-auto max-w-3xl px-4 py-14">
						<div className="mb-8 flex items-center justify-between">
							<h2 className="font-bold text-2xl text-[var(--foreground)]">
								Announcements
							</h2>
							<Link
								href={`/club/${clubShortName}/announcements`}
								className="text-[var(--primary)] text-sm hover:underline"
							>
								View all →
							</Link>
						</div>
						<AnnouncementFeed
							clubShortName={clubShortName}
							initialItems={announcements}
						/>
					</div>
				</section>
			)}

			<ClubLocationsSection facilities={facilities} />
		</div>
	);
}
