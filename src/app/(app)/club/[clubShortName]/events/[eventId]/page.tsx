import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EventDetailClient from "~/app/(app)/events/[eventId]/EventDetailClient";
import {
	buildEventJsonLd,
	buildEventMetadata,
	fetchEventForSeo,
	shouldEmitEventJsonLd,
} from "~/lib/eventSeo";
import { isOnboardedUser } from "~/lib/utils";
import { db } from "~/server/db";

interface ClubEventPageProps {
	params: Promise<{ clubShortName: string; eventId: string }>;
}

/**
 * Phase 16 Step 5 — club-chromed public event page. Reachable via the short
 * URL /<short>/events/<id> (middleware rewrite). Identical content to
 * /events/[eventId] but rendered inside the club chrome (AuthedLayout treats
 * /club/* as a club page) so a visitor coming from the club landing page stays
 * in the club's branding. Canonical (from buildEventMetadata) points back at
 * /events/<id>, so this wrapper consolidates to the single indexed URL.
 */
export async function generateMetadata({
	params,
}: ClubEventPageProps): Promise<Metadata> {
	const { eventId } = await params;
	return buildEventMetadata(eventId, await fetchEventForSeo(eventId));
}

export default async function ClubEventPage({ params }: ClubEventPageProps) {
	const { clubShortName, eventId } = await params;

	const seoEvent = await fetchEventForSeo(eventId);
	// Public surface: only public, non-deleted events that actually belong to
	// THIS club render here (prevents /club/<wrong>/events/<id> mis-branding).
	if (
		!seoEvent ||
		!seoEvent.isPublic ||
		seoEvent.isDeleted ||
		seoEvent.club.clubShortName !== clubShortName
	) {
		notFound();
	}

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

	const jsonLd = shouldEmitEventJsonLd(seoEvent)
		? buildEventJsonLd(eventId, seoEvent)
		: null;

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
