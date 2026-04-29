import { auth } from "@clerk/nextjs/server";
import EventDetailClient from "~/app/(app)/events/[eventId]/EventDetailClient";
import { isOnboardedUser } from "~/lib/utils";
import { db } from "~/server/db";

/**
 * Public shop event detail page.
 *
 * Shop-scoped URL for a single event. Renders the same `EventDetailClient` used
 * at `/events/[eventId]` — that route is kept around for the authenticated
 * calendar/internal links, but ALL shop-card click-throughs come here for URL
 * cohesion with `/club/[shortname]/shop/packages/[planId]` and `/products/[productId]`.
 *
 * The `clubShortName` param isn't needed by `EventDetailClient` (the event row
 * carries its own club via `event.clubShortName`), but it's part of the URL for
 * cohesion + future per-club navigation chrome.
 */
interface ShopEventDetailPageProps {
	params: Promise<{ clubShortName: string; eventId: string }>;
}

export default async function ShopEventDetailPage({
	params,
}: ShopEventDetailPageProps) {
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

	return (
		<EventDetailClient
			eventId={eventId}
			userType={userType ?? ""}
			userId={userId ?? ""}
		/>
	);
}
