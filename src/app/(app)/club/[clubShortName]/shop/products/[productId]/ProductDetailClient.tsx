"use client";

import { ArrowLeft, Tag } from "lucide-react";
import Link from "next/link";
import { Button } from "~/app/_components/shared/Button";
import { api } from "~/trpc/react";

interface ProductDetailClientProps {
	clubShortName: string;
	productId: string;
}

const formatPrice = (cents: number, currency = "USD") =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(cents / 100);

export default function ProductDetailClient({
	clubShortName,
	productId,
}: ProductDetailClientProps) {
	const { data, isLoading, error } = api.shop.getPublicProduct.useQuery({
		clubShortName,
		productId,
	});

	if (isLoading) {
		return (
			<div className="mx-auto max-w-3xl space-y-4 p-6">
				<div className="h-48 w-full animate-pulse rounded-lg bg-[var(--muted)]" />
				<div className="h-8 w-1/2 animate-pulse rounded bg-[var(--muted)]" />
				<div className="h-4 w-3/4 animate-pulse rounded bg-[var(--muted)]" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6">
				<div className="text-center">
					<p className="text-[var(--muted-foreground)] text-sm">
						This product is no longer available.
					</p>
					<Link
						href={`/club/${clubShortName}/shop`}
						className="mt-3 inline-flex items-center gap-1.5 text-[var(--primary)] text-sm underline"
					>
						<ArrowLeft size={14} />
						Back to shop
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6 p-6">
			{/* Back nav */}
			<Link
				href={`/club/${clubShortName}/shop`}
				className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)] text-sm transition-colors hover:text-[var(--foreground)]"
			>
				<ArrowLeft size={14} />
				Back to shop
			</Link>

			{/* Hero */}
			{data.publicImageDataUrl ? (
				// biome-ignore lint/performance/noImgElement: data URL — Next/Image not applicable
				<img
					src={data.publicImageDataUrl}
					alt={data.name}
					className="h-64 w-full rounded-lg object-cover"
				/>
			) : (
				<div className="flex h-64 w-full items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/15 to-amber-100 text-amber-700">
					<Tag size={56} />
				</div>
			)}

			{/* Title + price */}
			<div className="space-y-2">
				<h1 className="font-bold text-[var(--foreground)] text-2xl">
					{data.name}
				</h1>
				<p className="font-semibold text-[var(--primary)] text-xl">
					{formatPrice(data.priceInCents, data.currency)}
				</p>
			</div>

			{/* Description */}
			{data.publicDescription && (
				<div className="glass-card rounded-lg p-5">
					<h2 className="mb-2 font-semibold text-[var(--foreground)] text-sm">
						About
					</h2>
					<p className="whitespace-pre-wrap text-[var(--muted-foreground)] text-sm">
						{data.publicDescription}
					</p>
				</div>
			)}

			{/* Buy stub — Phase C blocks paid checkout */}
			<div className="flex justify-end">
				<Button disabled title="Sign in to buy" size="lg">
					Sign in to buy
				</Button>
			</div>
		</div>
	);
}
