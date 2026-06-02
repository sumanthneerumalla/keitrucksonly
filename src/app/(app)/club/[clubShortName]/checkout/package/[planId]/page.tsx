import Link from "next/link";
import { notFound } from "next/navigation";
import BuyerBeneficiaryForm from "~/app/_components/client/shared/BuyerBeneficiaryForm";
import { Button } from "~/app/_components/shared/Button";
import { db } from "~/server/db";

/**
 * Phase 12a Round 3 Stream 6 — package checkout-form page (Option B URL).
 *
 * Per phase12 §7.8.2 the user flow is:
 *   /club/<short>/shop/packages/<planId>          (browse)
 *   /club/<short>/checkout/package/<planId>       (THIS PAGE — capture identity)
 *   /checkout/<checkoutSessionId>                 (pay via Stripe iframe)
 *
 * Server component: resolves the plan + club's pay-readiness server-side and
 * renders a thin <BuyerBeneficiaryForm> below the summary box. The form
 * decides which `startCheckout.*` endpoint to hit (auth vs guest) at submit
 * time based on `useAuth().isSignedIn`.
 */
export default async function PackageCheckoutFormPage({
	params,
}: {
	params: Promise<{ clubShortName: string; planId: string }>;
}) {
	const { clubShortName, planId } = await params;

	const plan = await db.packagePlan.findUnique({
		where: { packagePlanId: planId },
		select: {
			packagePlanId: true,
			clubShortName: true,
			name: true,
			priceInCents: true,
			isActive: true,
			isPubliclyListed: true,
			publicDescription: true,
		},
	});

	// Cross-tenant + listed guard. The same checks run inside
	// `payments.startCheckout.package(Guest)`; doing them up front turns a
	// surprise mutation error into a 404 page.
	if (
		!plan ||
		plan.clubShortName !== clubShortName ||
		!plan.isActive ||
		plan.priceInCents <= 0
	) {
		notFound();
	}

	// Pay-readiness: if the club's Stripe Connect link isn't usable we surface
	// a friendly message instead of letting the user fill out a form whose
	// submit will bounce.
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
					the club directly to purchase this package.
				</p>
				<div>
					<Button asChild variant="outline" size="sm">
						<Link href={`/club/${clubShortName}/shop/packages/${planId}`}>
							Back to package details
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
					href={`/club/${clubShortName}/shop/packages/${planId}`}
					className="text-[var(--muted-foreground)] text-xs underline-offset-2 hover:underline"
				>
					← Back to package details
				</Link>
				<h1 className="font-semibold text-[var(--foreground)] text-xl">
					Buy {plan.name}
				</h1>
				{plan.publicDescription && (
					<p className="text-[var(--muted-foreground)] text-sm">
						{plan.publicDescription}
					</p>
				)}
			</div>

			<BuyerBeneficiaryForm
				itemKind="package"
				itemId={plan.packagePlanId}
				clubShortName={clubShortName}
				pricing={{
					amountInCents: plan.priceInCents,
					description: plan.name,
				}}
				submitTo="package"
				submitToGuest="packageGuest"
			/>
		</div>
	);
}
