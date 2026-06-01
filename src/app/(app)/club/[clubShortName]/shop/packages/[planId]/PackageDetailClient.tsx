"use client";

import { ArrowLeft, Package as PackageIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "~/app/_components/shared/Button";
import { api } from "~/trpc/react";

interface PackageDetailClientProps {
	clubShortName: string;
	planId: string;
}

const formatPrice = (cents: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(cents / 100);

const formatValidity = (
	durationValue: number | null,
	durationUnit: string | null,
) => {
	if (durationValue === null || durationUnit === null) return "No expiry";
	return `Valid for ${durationValue} ${durationUnit.toLowerCase()}`;
};

export default function PackageDetailClient({
	clubShortName,
	planId,
}: PackageDetailClientProps) {
	const { data, isLoading, error } = api.shop.getPublicPackagePlan.useQuery({
		clubShortName,
		packagePlanId: planId,
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
						This package is no longer available.
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
				<div className="flex h-64 w-full items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/15 to-emerald-100 text-emerald-700">
					<PackageIcon size={56} />
				</div>
			)}

			{/* Title + price */}
			<div className="space-y-2">
				<h1 className="font-bold text-2xl text-[var(--foreground)]">
					{data.name}
				</h1>
				<p className="font-semibold text-[var(--primary)] text-xl">
					{formatPrice(data.priceInCents)}
				</p>
			</div>

			{/* Details */}
			<div className="glass-card space-y-3 rounded-lg p-5 text-sm">
				<div className="grid grid-cols-2 gap-3">
					<div>
						<p className="text-[var(--muted-foreground)] text-xs">Sessions</p>
						<p className="font-medium text-[var(--foreground)]">
							{data.sessionCount ?? "Unlimited"}
						</p>
					</div>
					<div>
						<p className="text-[var(--muted-foreground)] text-xs">Validity</p>
						<p className="font-medium text-[var(--foreground)]">
							{formatValidity(data.durationValue, data.durationUnit)}
						</p>
					</div>
					<div className="col-span-2">
						<p className="text-[var(--muted-foreground)] text-xs">
							Eligibility
						</p>
						<p className="font-medium text-[var(--foreground)]">
							{data.isGeneralDropIn
								? "General open play"
								: (data.product?.name ?? "—")}
						</p>
					</div>
				</div>
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

			{/* Phase 12a Round 3 Stream 6 — Buy button routes to the dedicated
			    checkout-form page (Option B URL structure, §7.8.2). The form
			    captures identity (buyer vs beneficiary) before mounting the
			    Stripe iframe at `/checkout/[sessionId]`. */}
			<div className="flex justify-end">
				<Button asChild size="lg">
					<Link href={`/club/${clubShortName}/checkout/package/${planId}`}>
						Buy
					</Link>
				</Button>
			</div>
		</div>
	);
}
