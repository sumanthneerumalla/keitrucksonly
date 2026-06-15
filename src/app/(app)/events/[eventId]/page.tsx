import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { cache } from "react";
import EventDetailClient from "~/app/(app)/events/[eventId]/EventDetailClient";
import { getClubBaseUrl } from "~/lib/clubPublicUrl";
import { SITE_URL } from "~/lib/marketing";
import { isOnboardedUser } from "~/lib/utils";
import { db } from "~/server/db";

interface EventDetailPageProps {
	params: Promise<{ eventId: string }>;
}

// Server-side fetch of the public-facing event fields for metadata + JSON-LD.
// Kept separate from the client component's tRPC load so search engines and
// social scrapers get the structured data without executing client JS.
// cache() dedupes the two call sites (generateMetadata + the page) into one
// query per request.
const fetchEventForSeo = cache(async (eventId: string) => {
	return db.calendarEvent.findUnique({
		where: { eventId },
		select: {
			title: true,
			description: true,
			start: true,
			end: true,
			isPublic: true,
			isDeleted: true,
			eventType: true,
			club: {
				select: {
					clubShortName: true,
					clubName: true,
					canonicalDomain: true,
				},
			},
			facility: {
				select: {
					name: true,
					streetAddress: true,
					city: true,
					state: true,
					zipCode: true,
				},
			},
			product: {
				select: { priceInCents: true },
			},
		},
	});
});

function buildEventDescription(description: string | null): string {
	const fallback = "View event details, schedule, and registration.";
	if (!description) return fallback;
	const stripped = description
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!stripped) return fallback;
	return stripped.length > 155 ? `${stripped.slice(0, 152).trim()}…` : stripped;
}

export async function generateMetadata({
	params,
}: EventDetailPageProps): Promise<Metadata> {
	const { eventId } = await params;
	const event = await fetchEventForSeo(eventId);

	const canonical = `${SITE_URL}/events/${eventId}`;

	if (!event || !event.isPublic || event.isDeleted) {
		return {
			title: "Event",
			description: "View event details.",
			alternates: { canonical },
		};
	}

	const title = `${event.title} | ${event.club.clubName}`;
	const description = buildEventDescription(event.description);

	return {
		title,
		description,
		alternates: { canonical },
		openGraph: {
			title,
			description,
			url: canonical,
			type: "website",
			siteName: event.club.clubName,
		},
		twitter: {
			card: "summary",
			title,
			description,
		},
	};
}

// schema.org Event structured data. Built only for public, non-deleted,
// non-BLOCK events. All nullable fields are guarded so we never emit `undefined`.
function buildEventJsonLd(
	eventId: string,
	event: NonNullable<Awaited<ReturnType<typeof fetchEventForSeo>>>,
): Record<string, unknown> {
	const canonical = `${SITE_URL}/events/${eventId}`;

	const address: Record<string, unknown> = { "@type": "PostalAddress" };
	if (event.facility?.streetAddress)
		address.streetAddress = event.facility.streetAddress;
	if (event.facility?.city) address.addressLocality = event.facility.city;
	if (event.facility?.state) address.addressRegion = event.facility.state;
	if (event.facility?.zipCode) address.postalCode = event.facility.zipCode;

	const location: Record<string, unknown> = { "@type": "Place" };
	if (event.facility?.name) location.name = event.facility.name;
	// Only attach address if it carries at least one real field.
	if (Object.keys(address).length > 1) location.address = address;

	const jsonLd: Record<string, unknown> = {
		"@context": "https://schema.org",
		"@type": "Event",
		name: event.title,
		description: buildEventDescription(event.description),
		startDate: event.start.toISOString(),
		endDate: event.end.toISOString(),
		eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
		eventStatus: "https://schema.org/EventScheduled",
		organizer: {
			"@type": "Organization",
			name: event.club.clubName,
			url: getClubBaseUrl(event.club),
		},
	};

	// Only attach location when it carries a name or address.
	if (Object.keys(location).length > 1) jsonLd.location = location;

	if (
		event.product?.priceInCents !== undefined &&
		event.product?.priceInCents !== null
	) {
		jsonLd.offers = {
			"@type": "Offer",
			price: (event.product.priceInCents / 100).toFixed(2),
			priceCurrency: "USD",
			availability: "https://schema.org/InStock",
			url: canonical,
		};
	}

	return jsonLd;
}

export default async function EventDetailPage({
	params,
}: EventDetailPageProps) {
	const { eventId } = await params;
	const session = await auth();

	let userType: string | null = null;
	let userId: string | null = null;

	if (session?.userId) {
		const user = await db.user.findUnique({
			where: { clerkUserId: session.userId },
		});
		if (user && isOnboardedUser(user)) {
			userType = user.userType;
			userId = user.userId;
		}
	}

	// SEO structured data — fetched server-side, independent of the client load.
	const seoEvent = await fetchEventForSeo(eventId);
	const emitJsonLd =
		seoEvent?.isPublic === true &&
		!seoEvent.isDeleted &&
		seoEvent.eventType !== "BLOCK";
	const jsonLd =
		emitJsonLd && seoEvent ? buildEventJsonLd(eventId, seoEvent) : null;

	return (
		<>
			{jsonLd ? (
				<script
					type="application/ld+json"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify of static structured-data object — no raw user input is injected as HTML
					dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
				/>
			) : null}
			<EventDetailClient
				eventId={eventId}
				userType={userType ?? ""}
				userId={userId ?? ""}
			/>
		</>
	);
}
