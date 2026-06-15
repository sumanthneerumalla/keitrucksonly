import type { Metadata } from "next";
import { cache } from "react";
import { getClubBaseUrl } from "~/lib/clubPublicUrl";
import { SITE_URL } from "~/lib/marketing";
import { db } from "~/server/db";

/**
 * Shared event SEO helpers (Phase 16). Used by BOTH the in-app event page
 * (/events/[eventId]) and the club-chromed public event page
 * (/club/[clubShortName]/events/[eventId]). Both routes produce the SAME
 * canonical (`/events/<id>`) so the club-chromed wrapper consolidates to the
 * single indexed event URL — no duplicate content.
 */

// Server-side fetch of the public-facing event fields for metadata + JSON-LD.
// cache() dedupes the generateMetadata + page call sites into one query.
export const fetchEventForSeo = cache(async (eventId: string) => {
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

export type EventForSeo = NonNullable<
	Awaited<ReturnType<typeof fetchEventForSeo>>
>;

export function buildEventDescription(description: string | null): string {
	const fallback = "View event details, schedule, and registration.";
	if (!description) return fallback;
	const stripped = description
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!stripped) return fallback;
	return stripped.length > 155 ? `${stripped.slice(0, 152).trim()}…` : stripped;
}

// The single canonical URL for an event — the in-app /events/<id> form.
function eventCanonical(eventId: string): string {
	return `${SITE_URL}/events/${eventId}`;
}

export function buildEventMetadata(
	eventId: string,
	event: Awaited<ReturnType<typeof fetchEventForSeo>>,
): Metadata {
	const canonical = eventCanonical(eventId);
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
		twitter: { card: "summary", title, description },
	};
}

export function shouldEmitEventJsonLd(
	event: Awaited<ReturnType<typeof fetchEventForSeo>>,
): event is EventForSeo {
	return (
		event?.isPublic === true && !event.isDeleted && event.eventType !== "BLOCK"
	);
}

// schema.org Event structured data. All nullable fields are guarded so we
// never emit `undefined`.
export function buildEventJsonLd(
	eventId: string,
	event: EventForSeo,
): Record<string, unknown> {
	const canonical = eventCanonical(eventId);

	const address: Record<string, unknown> = { "@type": "PostalAddress" };
	if (event.facility?.streetAddress)
		address.streetAddress = event.facility.streetAddress;
	if (event.facility?.city) address.addressLocality = event.facility.city;
	if (event.facility?.state) address.addressRegion = event.facility.state;
	if (event.facility?.zipCode) address.postalCode = event.facility.zipCode;

	const location: Record<string, unknown> = { "@type": "Place" };
	if (event.facility?.name) location.name = event.facility.name;
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
