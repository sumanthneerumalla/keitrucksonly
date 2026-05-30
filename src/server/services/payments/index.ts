/**
 * Phase 12a — payment-provider resolver.
 *
 * `getProviderForClub(db, clubShortName)` looks up the club's connection
 * row (`ClubStripeAccount` for now; future `ClubPaysafeAccount` /
 * `ClubValorAccount` slot in here as a small switch) and returns a
 * `PaymentProvider` instance ready to mint checkout sessions / refunds /
 * webhook parses.
 *
 * Throws `PRECONDITION_FAILED` if the club has no connection or has been
 * disconnected. Callers (the tRPC payments router, the webhook dispatcher)
 * never construct providers directly.
 *
 * The Stripe SDK import is fenced to `./stripe.ts` (§4.3) — this file does
 * NOT import `'stripe'`.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { StripeProvider } from "~/server/services/payments/stripe";
import type { PaymentProvider } from "~/server/services/payments/types";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Returns the active `PaymentProvider` for a club. In 12a a club has at
 * most one Stripe connection; later phases extend with Paysafe/Valor and
 * switch on the first row found.
 */
export async function getProviderForClub(
	db: DbClient,
	clubShortName: string,
): Promise<PaymentProvider> {
	const stripeAccount = await db.clubStripeAccount.findUnique({
		where: { clubShortName },
		select: { stripeAccountId: true, disconnectedAt: true },
	});

	if (stripeAccount && stripeAccount.disconnectedAt === null) {
		return new StripeProvider();
	}

	if (stripeAccount && stripeAccount.disconnectedAt !== null) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "This club's Stripe connection is disconnected.",
		});
	}

	throw new TRPCError({
		code: "PRECONDITION_FAILED",
		message: "This club has no connected payment processor.",
	});
}

/**
 * Variant of `getProviderForClub` that does NOT touch the DB. Used by the
 * webhook handler when signature verification must happen BEFORE we know
 * which club an event is for (the metadata reveals the club, but signature
 * verification gates parsing the metadata).
 */
export function getStripeProvider(): PaymentProvider {
	return new StripeProvider();
}
