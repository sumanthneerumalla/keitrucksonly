import { redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "~/app/_components/server/OnboardedGuard";

/**
 * Club-agnostic Shop entry. The sidebar links here with a static "/shop" href;
 * this resolves the member's active club server-side and redirects to the
 * public storefront at /club/[clubShortName]/shop — mirroring how /rentals and
 * /invoices stay club-agnostic in the nav. (public-shop.md storefront)
 */
export default async function ShopRedirectPage() {
	const user = await getOnboardedUserOrRedirect();
	redirect(`/club/${user.clubShortName}/shop`);
}
