import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import EventDetailClient from "~/app/(app)/events/[eventId]/EventDetailClient";
import {
	buildEventJsonLd,
	buildEventMetadata,
	fetchEventForSeo,
	shouldEmitEventJsonLd,
} from "~/lib/eventSeo";
import { isOnboardedUser } from "~/lib/utils";
import { db } from "~/server/db";

interface EventDetailPageProps {
	params: Promise<{ eventId: string }>;
}

export async function generateMetadata({
	params,
}: EventDetailPageProps): Promise<Metadata> {
	const { eventId } = await params;
	return buildEventMetadata(eventId, await fetchEventForSeo(eventId));
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
