import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import BuyerBeneficiaryForm from "~/app/_components/client/shared/BuyerBeneficiaryForm";
import { Button } from "~/app/_components/shared/Button";
import { db } from "~/server/db";

/**
 * Phase 12a Round 3 Stream 6 — membership initial-purchase checkout-form
 * page (Option B URL).
 *
 * Membership initial buy is auth-only in 12a (recurring billing lives in
 * 12b — `autoRenew` stays false even when the plan defaults true). The
 * `payments.startCheckout.membership` mutation is `protectedProcedure`, so
 * unauthed visitors get bounced to sign-in.
 */
export default async function MembershipCheckoutFormPage({
	params,
}: {
	params: Promise<{ clubShortName: string; planId: string }>;
}) {
	const { clubShortName, planId } = await params;

	const session = await auth();
	if (!session?.userId) {
		redirect(
			`/sign-in?redirect_url=${encodeURIComponent(
				`/club/${clubShortName}/checkout/membership/${planId}`,
			)}`,
		);
	}

	const plan = await db.membershipPlan.findUnique({
		where: { membershipPlanId: planId },
		select: {
			membershipPlanId: true,
			clubShortName: true,
			description: true,
			feePerTermInCents: true,
			initiationFeeInCents: true,
			isActive: true,
			membershipType: { select: { name: true } },
		},
	});

	if (!plan || plan.clubShortName !== clubShortName || !plan.isActive) {
		notFound();
	}

	const amount = plan.feePerTermInCents + plan.initiationFeeInCents;
	if (amount <= 0) {
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
					the club directly to start your membership.
				</p>
				<div>
					<Button asChild variant="outline" size="sm">
						<Link href={`/club/${clubShortName}/shop`}>Back to shop</Link>
					</Button>
				</div>
			</div>
		);
	}

	const description = plan.membershipType?.name
		? `${plan.membershipType.name} — ${plan.description}`
		: plan.description;

	return (
		<div className="mx-auto max-w-2xl space-y-6 p-6">
			<div className="space-y-1">
				<Link
					href={`/club/${clubShortName}/shop`}
					className="text-[var(--muted-foreground)] text-xs underline-offset-2 hover:underline"
				>
					← Back to shop
				</Link>
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Start membership: {plan.membershipType?.name ?? plan.description}
				</h1>
			</div>

			<BuyerBeneficiaryForm
				itemKind="membership"
				itemId={plan.membershipPlanId}
				clubShortName={clubShortName}
				pricing={{ amountInCents: amount, description }}
				submitTo="membership"
				submitToGuest={null}
			/>
		</div>
	);
}
