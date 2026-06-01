import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import BuyerBeneficiaryForm from "~/app/_components/client/shared/BuyerBeneficiaryForm";
import { Button } from "~/app/_components/shared/Button";
import { db } from "~/server/db";

/**
 * Phase 12a Round 3 Stream 6 — rental checkout-form page (Option B URL).
 *
 * Per phase12 §7.8.2 + the payments router: rental checkout is auth-only —
 * `payments.startCheckout.rental` is `protectedProcedure` (the rental
 * already exists with a userId-scoped advisory lock from
 * validateAndCreateBooking). There's no guest-rental endpoint, so an
 * unauthenticated visitor gets redirected to sign-in.
 *
 * We also verify ownership server-side (the booking must belong to the
 * viewer) — the mutation will re-check, but a 404 page beats a friendly
 * error after the user fills out the form.
 */
export default async function RentalCheckoutFormPage({
	params,
}: {
	params: Promise<{ clubShortName: string; bookingId: string }>;
}) {
	const { clubShortName, bookingId } = await params;

	// Guest visitors can't pay for a rental — there's no guest endpoint. Send
	// them to sign-in with the current path so they come back here.
	const session = await auth();
	if (!session?.userId) {
		redirect(
			`/sign-in?redirect_url=${encodeURIComponent(
				`/club/${clubShortName}/checkout/rental/${bookingId}`,
			)}`,
		);
	}

	const booking = await db.rentalBooking.findUnique({
		where: { bookingId },
		select: {
			bookingId: true,
			clubShortName: true,
			userId: true,
			status: true,
			product: { select: { name: true, priceInCents: true } },
			user: { select: { clerkUserId: true } },
		},
	});

	if (
		!booking ||
		booking.clubShortName !== clubShortName ||
		booking.status !== "CONFIRMED" ||
		!booking.product ||
		booking.product.priceInCents <= 0 ||
		booking.user.clerkUserId !== session.userId
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
					the club directly to pay for this booking.
				</p>
				<div>
					<Button asChild variant="outline" size="sm">
						<Link href="/rentals">Back to my rentals</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6 p-6">
			<div className="space-y-1">
				<Link
					href="/rentals"
					className="text-[var(--muted-foreground)] text-xs underline-offset-2 hover:underline"
				>
					← Back to my rentals
				</Link>
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Pay for {booking.product.name}
				</h1>
			</div>

			<BuyerBeneficiaryForm
				itemKind="rental"
				itemId={booking.bookingId}
				clubShortName={clubShortName}
				pricing={{
					amountInCents: booking.product.priceInCents,
					description: booking.product.name,
				}}
				submitTo="rental"
				submitToGuest={null}
			/>
		</div>
	);
}
