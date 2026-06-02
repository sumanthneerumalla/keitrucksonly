import Link from "next/link";
import { notFound } from "next/navigation";
import BuyerBeneficiaryForm from "~/app/_components/client/shared/BuyerBeneficiaryForm";
import { Button } from "~/app/_components/shared/Button";
import { db } from "~/server/db";

/**
 * Phase 12a Round 3 Stream 6 — paid event checkout-form page (Option B URL).
 *
 * Mirrors the package checkout-form structure (§7.8.2). Resolves the event +
 * its product price server-side; rejects free events (those use the existing
 * registration flow, not Stripe).
 */
export default async function EventCheckoutFormPage({
	params,
}: {
	params: Promise<{ clubShortName: string; eventId: string }>;
}) {
	const { clubShortName, eventId } = await params;

	const event = await db.calendarEvent.findUnique({
		where: { eventId },
		select: {
			eventId: true,
			clubShortName: true,
			title: true,
			isPublic: true,
			product: { select: { priceInCents: true } },
		},
	});

	if (
		!event ||
		event.clubShortName !== clubShortName ||
		!event.isPublic ||
		!event.product ||
		event.product.priceInCents <= 0
	) {
		notFound();
	}

	const account = await db.clubStripeAccount.findUnique({
		where: { clubShortName },
		select: { chargesEnabled: true, disconnectedAt: true },
	});
	const clubReady =
		account?.chargesEnabled === true && account.disconnectedAt === null;

	if (!clubReady) {
		return (
			<div className="mx-auto max-w-2xl space-y-4 p-6 text-center">
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Online checkout unavailable
				</h1>
				<p className="text-[var(--muted-foreground)] text-sm">
					This club is not currently accepting online payments. Please contact
					the club directly to register for this event.
				</p>
				<div>
					<Button asChild variant="outline" size="sm">
						<Link href={`/club/${clubShortName}/shop/events/${eventId}`}>
							Back to event details
						</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6 p-6">
			<div className="space-y-1">
				<Link
					href={`/club/${clubShortName}/shop/events/${eventId}`}
					className="text-[var(--muted-foreground)] text-xs underline-offset-2 hover:underline"
				>
					← Back to event details
				</Link>
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Register for {event.title}
				</h1>
			</div>

			<BuyerBeneficiaryForm
				itemKind="event"
				itemId={event.eventId}
				clubShortName={clubShortName}
				pricing={{
					amountInCents: event.product.priceInCents,
					description: event.title,
				}}
				submitTo="event"
				submitToGuest="eventGuest"
			/>
		</div>
	);
}
