import PackageDetailClient from "~/app/(app)/club/[clubShortName]/shop/packages/[planId]/PackageDetailClient";

/**
 * Public package-plan detail page. (public-shop.md §"Public UI — New Routes")
 * Throws NOT_FOUND in tRPC if the plan is unlisted (decision #22) — handled by client.
 */
interface PackageDetailPageProps {
	params: Promise<{ clubShortName: string; planId: string }>;
}

export default async function PackageDetailPage({
	params,
}: PackageDetailPageProps) {
	const { clubShortName, planId } = await params;

	return <PackageDetailClient clubShortName={clubShortName} planId={planId} />;
}
