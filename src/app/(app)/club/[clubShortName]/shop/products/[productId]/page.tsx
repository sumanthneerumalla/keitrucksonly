import ProductDetailClient from "~/app/(app)/club/[clubShortName]/shop/products/[productId]/ProductDetailClient";

/**
 * Public product detail page. (public-shop.md §"Public UI — New Routes")
 * NOT_FOUND if unlisted (decision #22) — handled in client.
 */
interface ProductDetailPageProps {
	params: Promise<{ clubShortName: string; productId: string }>;
}

export default async function ProductDetailPage({
	params,
}: ProductDetailPageProps) {
	const { clubShortName, productId } = await params;

	return (
		<ProductDetailClient clubShortName={clubShortName} productId={productId} />
	);
}
