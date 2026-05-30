/**
 * Phase 12a — Stripe webhook handler core.
 *
 * `handleStripeWebhook(rawBody, sig, endpointKind)` is the shared body used
 * by both Next.js route handlers:
 *   - `/api/webhooks/stripe/platform/route.ts` → endpointKind='platform'
 *   - `/api/webhooks/stripe/connect/route.ts`  → endpointKind='connect'
 *
 * Order of operations:
 *   1. Verify signature on raw body. SignatureError → 400 (Stripe stops
 *      retrying — bad signature can't recover).
 *   2. Sanity-check `event.livemode` against `STRIPE_LIVEMODE` env.
 *      Mismatch → 400 (suggests a mis-registered endpoint).
 *   3. Parse the event to `ParsedProviderEvent`.
 *   4. Open a SHORT $transaction whose ONLY work is the
 *      `ProcessedProcessorEvent` insert (Invariant I6). P2002 → duplicate
 *      delivery → return 200 silently.
 *   5. After the dedup row is committed, call `dispatchParsedEvent(db, …)`
 *      OUTSIDE any tx. Downstream helpers (sellPackageInternal,
 *      recordPaymentInternal, recordRefundInternal) open their own audited
 *      transactions — Choice B composition (phase12 §9.3.1).
 *   6. Any error from dispatch routes through `handleWebhookFailure`:
 *      known classes (Clerk, capacity race, OrphanError reasons) → 200
 *      with an OrphanedPurchase row; unknown errors → re-thrown so the
 *      route handler returns 500 and Stripe retries.
 */

import { Prisma } from "@prisma/client";
import { db } from "~/server/db";
import { dispatchParsedEvent } from "~/server/services/payments/dispatch";
import { handleWebhookFailure } from "~/server/services/payments/failure";
import { getStripeProvider } from "~/server/services/payments/index";
import {
	LivemodeMismatchError,
	type ParsedProviderEvent,
	SignatureError,
} from "~/server/services/payments/types";

export async function handleStripeWebhook(
	rawBody: string,
	sig: string | null,
	endpointKind: "platform" | "connect",
): Promise<Response> {
	const provider = getStripeProvider();

	// 1. Signature verification — first call, on RAW body (Gap #3).
	let event: Awaited<ReturnType<typeof provider.verifyWebhookSignature>>;
	try {
		event = provider.verifyWebhookSignature({
			rawBody,
			signatureHeader: sig,
			endpointKind,
		});
	} catch (err) {
		if (err instanceof SignatureError) {
			return new Response("signature verification failed", { status: 400 });
		}
		throw err;
	}

	// 2. Livemode sanity check.
	const expectedLivemode = process.env.STRIPE_LIVEMODE === "true";
	if (event.livemode !== expectedLivemode) {
		// LivemodeMismatchError is thrown for visibility / logging; we still
		// return 400 directly per §8.3.
		void new LivemodeMismatchError(event);
		return new Response("livemode mismatch", { status: 400 });
	}

	// 3. Parse. Parsing failures (network blip during fee lookup, unexpected
	// payload shape) propagate up so the route handler returns 500 and
	// Stripe retries.
	const parsed: ParsedProviderEvent = await provider.parseEvent(event);

	if (parsed.kind === "unhandled") {
		return new Response("ok", { status: 200 });
	}

	// 4. Dedup-row insert in its own short tx (Invariant I6).
	try {
		await db.$transaction(async (tx) => {
			await tx.processedProcessorEvent.create({
				data: { processor: "stripe", eventId: event.id },
			});
		});
	} catch (err) {
		if (
			err instanceof Prisma.PrismaClientKnownRequestError &&
			err.code === "P2002"
		) {
			// Duplicate delivery — silent success.
			return new Response("ok", { status: 200 });
		}
		throw err;
	}

	// 5. Dispatch OUTSIDE any tx — Choice B (§9.3.1). Each downstream helper
	// opens its own audited transaction.
	try {
		await dispatchParsedEvent(db, parsed, event);
	} catch (err) {
		const clubShortName = await resolveClubShortNameForFailure(parsed);
		return await handleWebhookFailure(err, event, parsed, {
			db,
			clubShortName,
		});
	}

	return new Response("ok", { status: 200 });
}

/**
 * Best-effort club resolution for dead-letter anchoring. The dispatcher
 * carries enough context for orphan rows in the common cases:
 *   - checkout.completed → metadata.clubShortName
 *   - refund.created     → InvoicePayment → Invoice.clubShortName
 *   - account.updated    → ClubStripeAccount lookup
 * Falls back to null when we genuinely can't anchor (the failure module
 * then skips writing the orphan row rather than misattribute it).
 */
async function resolveClubShortNameForFailure(
	parsed: ParsedProviderEvent,
): Promise<string | null> {
	if (parsed.kind === "checkout.completed") {
		return parsed.metadata.clubShortName ?? null;
	}
	if (parsed.kind === "refund.created" && parsed.chargeId) {
		const p = await db.invoicePayment.findFirst({
			where: { processor: "stripe", processorChargeId: parsed.chargeId },
			select: { invoice: { select: { clubShortName: true } } },
		});
		return p?.invoice.clubShortName ?? null;
	}
	if (parsed.kind === "account.updated") {
		const row = await db.clubStripeAccount.findUnique({
			where: { stripeAccountId: parsed.providerAccountId },
			select: { clubShortName: true },
		});
		return row?.clubShortName ?? null;
	}
	return null;
}
