"use client";

import { CalendarDays, Package as PackageIcon, Tag } from "lucide-react";
import Link from "next/link";
import dayjs from "~/lib/dayjs-config";
import { api } from "~/trpc/react";

interface ShopClientProps {
	clubShortName: string;
	clubName: string;
}

const formatPrice = (cents: number, currency = "USD") =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(cents / 100);

function SectionHeader({
	title,
	icon,
}: {
	title: string;
	icon: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-2">
			<div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--primary)]">
				{icon}
			</div>
			<h2 className="font-semibold text-[var(--foreground)] text-lg">
				{title}
			</h2>
		</div>
	);
}

function CardSkeleton() {
	return (
		<div className="glass-card animate-pulse rounded-lg p-4">
			<div className="mb-3 h-24 w-full rounded-md bg-[var(--muted)]" />
			<div className="mb-2 h-4 w-3/4 rounded bg-[var(--muted)]" />
			<div className="h-3 w-1/2 rounded bg-[var(--muted)]" />
		</div>
	);
}

function EmptyState({ message }: { message: string }) {
	return (
		<p className="text-[var(--muted-foreground)] text-sm italic">{message}</p>
	);
}

export default function ShopClient({
	clubShortName,
	clubName,
}: ShopClientProps) {
	const eventsQuery = api.shop.listPublicBookableEvents.useQuery({
		clubShortName,
	});
	const plansQuery = api.shop.listPublicPackagePlans.useQuery({
		clubShortName,
	});
	const productsQuery = api.shop.listPublicProducts.useQuery({
		clubShortName,
	});

	const events = eventsQuery.data?.events ?? [];
	const plans = plansQuery.data?.plans ?? [];
	const products = productsQuery.data?.products ?? [];

	return (
		<div className="mx-auto max-w-5xl space-y-8 p-6">
			{/* Header */}
			<header className="space-y-1">
				<h1 className="font-bold text-2xl text-[var(--foreground)]">
					{clubName}
				</h1>
				<p className="text-[var(--muted-foreground)] text-sm">
					Browse upcoming classes, packages, and products.
				</p>
			</header>

			{/* Upcoming Classes */}
			<section className="space-y-3">
				<SectionHeader
					title="Upcoming Classes"
					icon={<CalendarDays size={16} />}
				/>
				{eventsQuery.isLoading ? (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<CardSkeleton />
						<CardSkeleton />
						<CardSkeleton />
					</div>
				) : events.length === 0 ? (
					<EmptyState message="No upcoming classes yet." />
				) : (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{events.map((event) => {
							const remaining =
								event.maxParticipants !== null
									? event.maxParticipants - event._count.registrations
									: null;
							return (
								<Link
									key={event.eventId}
									href={`/club/${clubShortName}/shop/events/${event.eventId}`}
									className="glass-card group flex flex-col overflow-hidden rounded-lg transition-shadow hover:shadow-md"
								>
									<div className="flex h-24 items-center justify-center bg-gradient-to-br from-[var(--primary)]/15 to-[var(--accent)] text-[var(--primary)]">
										<CalendarDays size={28} />
									</div>
									<div className="space-y-1.5 p-4">
										<h3 className="font-medium text-[var(--foreground)] text-sm group-hover:text-[var(--primary)]">
											{event.title}
										</h3>
										<p className="text-[var(--muted-foreground)] text-xs">
											{dayjs(event.start).format("ddd, MMM D · h:mm A")}
										</p>
										<p className="text-[var(--muted-foreground)] text-xs">
											{event.maxParticipants !== null
												? `${event._count.registrations} / ${event.maxParticipants}`
												: "Open"}
											{remaining !== null && remaining <= 3 && remaining > 0
												? ` · Only ${remaining} left`
												: ""}
										</p>
										{event.product && event.product.priceInCents > 0 ? (
											<p className="font-medium text-[var(--foreground)] text-xs">
												{formatPrice(
													event.product.priceInCents,
													event.product.currency,
												)}
											</p>
										) : (
											<p className="font-medium text-green-600 text-xs">Free</p>
										)}
									</div>
								</Link>
							);
						})}
					</div>
				)}
			</section>

			{/* Packages */}
			<section className="space-y-3">
				<SectionHeader title="Packages" icon={<PackageIcon size={16} />} />
				{plansQuery.isLoading ? (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<CardSkeleton />
						<CardSkeleton />
						<CardSkeleton />
					</div>
				) : plans.length === 0 ? (
					<EmptyState message="No packages available." />
				) : (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{plans.map((plan) => (
							<Link
								key={plan.packagePlanId}
								href={`/club/${clubShortName}/shop/packages/${plan.packagePlanId}`}
								className="glass-card group flex flex-col overflow-hidden rounded-lg transition-shadow hover:shadow-md"
							>
								<div className="flex h-24 items-center justify-center bg-gradient-to-br from-emerald-500/15 to-emerald-100 text-emerald-700">
									<PackageIcon size={28} />
								</div>
								<div className="space-y-1.5 p-4">
									<h3 className="font-medium text-[var(--foreground)] text-sm group-hover:text-[var(--primary)]">
										{plan.name}
									</h3>
									{plan.publicDescription && (
										<p className="line-clamp-2 text-[var(--muted-foreground)] text-xs">
											{plan.publicDescription}
										</p>
									)}
									<p className="font-medium text-[var(--foreground)] text-sm">
										{formatPrice(plan.priceInCents)}
									</p>
								</div>
							</Link>
						))}
					</div>
				)}
			</section>

			{/* Products */}
			<section className="space-y-3">
				<SectionHeader title="Products" icon={<Tag size={16} />} />
				{productsQuery.isLoading ? (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<CardSkeleton />
						<CardSkeleton />
						<CardSkeleton />
					</div>
				) : products.length === 0 ? (
					<EmptyState message="No products listed." />
				) : (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{products.map((product) => (
							<Link
								key={product.productId}
								href={`/club/${clubShortName}/shop/products/${product.productId}`}
								className="glass-card group flex flex-col overflow-hidden rounded-lg transition-shadow hover:shadow-md"
							>
								<div className="flex h-24 items-center justify-center bg-gradient-to-br from-amber-500/15 to-amber-100 text-amber-700">
									<Tag size={28} />
								</div>
								<div className="space-y-1.5 p-4">
									<h3 className="font-medium text-[var(--foreground)] text-sm group-hover:text-[var(--primary)]">
										{product.name}
									</h3>
									{product.publicDescription && (
										<p className="line-clamp-2 text-[var(--muted-foreground)] text-xs">
											{product.publicDescription}
										</p>
									)}
									<p className="font-medium text-[var(--foreground)] text-sm">
										{formatPrice(product.priceInCents, product.currency)}
									</p>
								</div>
							</Link>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
