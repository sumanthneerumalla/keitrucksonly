import { notFound } from "next/navigation";
import ShopClient from "~/app/(app)/club/[clubShortName]/shop/ShopClient";
import { db } from "~/server/db";

/**
 * Public storefront page for a club. Renders three sections:
 * Upcoming Classes, Packages, Products. (public-shop.md §"Public UI — New Routes")
 *
 * Server component fetches the club name; the client fetches the three
 * `shop.listPublic*` procedures in parallel.
 */
interface ShopPageProps {
	params: Promise<{ clubShortName: string }>;
}

export default async function ShopPage({ params }: ShopPageProps) {
	const { clubShortName } = await params;

	const club = await db.club.findUnique({
		where: { clubShortName },
		select: { clubShortName: true, clubName: true },
	});
	if (!club) notFound();

	return (
		<ShopClient clubShortName={club.clubShortName} clubName={club.clubName} />
	);
}
