/**
 * Phase 12a — webhook failure → dead-letter routing (§10).
 *
 * `handleWebhookFailure(err, event, parsed, ctx)` translates known failures
 * into `OrphanedPurchase` rows + (when applicable) auto-refund Stripe-side
 * money. Returns Response so the route handler can return it directly.
 *
 * The webhook handler returns 200 to Stripe on every failure routed through
 * here — these are persistent classes; Stripe retries would never recover
 * them. The orphan queue is the manual-triage path.
 */

import type { PrismaClient } from "@prisma/client";
import { getStripeProvider } from "~/server/services/payments/index";
import {
	CapacityRaceError,
	ClerkPersistentError,
	LivemodeMismatchError,
	OrphanError,
	type ParsedProviderEvent,
	type ProviderEvent,
} from "~/server/services/payments/types";

interface FailureContext {
	db: PrismaClient;
	/** Resolved when known (e.g. checkout.completed). Null when unknown. */
	clubShortName: string | null;
}

export async function handleWebhookFailure(
	err: unknown,
	event: ProviderEvent,
	parsed: ParsedProviderEvent,
	ctx: FailureContext,
): Promise<Response> {
	// LivemodeMismatch — caller already returns 400; this branch is defensive.
	if (err instanceof LivemodeMismatchError) {
		return new Response("livemode mismatch", { status: 400 });
	}

	// ClerkPersistent — multi-Clerk-user collision per §23 #5.
	if (err instanceof ClerkPersistentError) {
		await writeOrphan(ctx, {
			reason: "clerk_create_failed",
			event,
			parsed,
		});
		return new Response("ok", { status: 200 });
	}

	// CapacityRace — auto-refund + orphan per §11.
	if (err instanceof CapacityRaceError) {
		await autoRefundAndOrphan(ctx, err, event, parsed);
		return new Response("ok", { status: 200 });
	}

	// OrphanError — categorized reason from the dispatcher (unknown_metadata,
	// unknown_club, no_email, stripe_dashboard_refund_with_consumed_credit).
	if (err instanceof OrphanError) {
		await writeOrphan(ctx, {
			reason: err.reason,
			event,
			parsed,
		});
		return new Response("ok", { status: 200 });
	}

	// Catch-all (Choice B silent-event-loss guard): `ProcessedProcessorEvent`
	// has already committed in the webhook outer tx, so re-throwing here would
	// 500 to Stripe — Stripe's retry would short-circuit on the dedup row and
	// the event would be silently lost. Instead, persist the dispatch failure
	// as an `OrphanedPurchase` (reason='dispatch_failed') and return 200 so
	// the dedup row stays valid. Owners triage from `/admin/payments/orphans`.
	const errorMessage = err instanceof Error ? err.message : String(err);
	const errorStack = err instanceof Error ? (err.stack ?? "") : "";
	const stackSnippet = errorStack.split("\n").slice(0, 8).join("\n");
	await writeOrphan(ctx, {
		reason: "dispatch_failed",
		event,
		parsed,
		notes: `${errorMessage}\n\n${stackSnippet}`.slice(0, 4000),
		anchorByProviderAccount: true,
	});
	return new Response("ok", { status: 200 });
}

// ============================================================
// OrphanedPurchase writer
// ============================================================

async function writeOrphan(
	ctx: FailureContext,
	args: {
		reason: string;
		event: ProviderEvent;
		parsed: ParsedProviderEvent;
		notes?: string;
		/**
		 * When true (catch-all dispatch_failed path), if we can't anchor a club
		 * via ctx or metadata, try resolving via `providerAccountId` on the
		 * parsed event; if still none, fall back to the first club alphabetically
		 * as a sentinel so the row lands somewhere for platform-admin triage
		 * (rather than dropping silently).
		 */
		anchorByProviderAccount?: boolean;
	},
): Promise<void> {
	// Resolve clubShortName best-effort: prefer ctx, then peek into parsed
	// metadata for checkout.completed events.
	let clubShortName = ctx.clubShortName;
	let providerSessionId: string | null = null;
	let providerPaymentIntentId: string | null = null;
	let email: string | null = null;
	let providerAccountId: string | null = null;

	if (args.parsed.kind === "checkout.completed") {
		clubShortName ??= args.parsed.metadata.clubShortName ?? null;
		providerSessionId = args.parsed.sessionId;
		providerPaymentIntentId = args.parsed.paymentIntentId;
		email = args.parsed.email;
	} else if (args.parsed.kind === "refund.created") {
		providerPaymentIntentId = args.parsed.paymentIntentId;
	} else if (args.parsed.kind === "account.updated") {
		providerAccountId = args.parsed.providerAccountId;
	}

	// Catch-all branch: try harder to anchor before giving up.
	if (!clubShortName && args.anchorByProviderAccount) {
		if (providerAccountId) {
			const linked = await ctx.db.clubStripeAccount.findFirst({
				where: { stripeAccountId: providerAccountId },
				select: { clubShortName: true },
			});
			clubShortName = linked?.clubShortName ?? null;
		}
		if (!clubShortName) {
			// Sentinel fallback — first club alphabetically. The orphan-triage
			// UI flags `dispatch_failed` rows as needing platform-admin
			// reassignment to the correct club.
			const sentinel = await ctx.db.club.findFirst({
				orderBy: { clubShortName: "asc" },
				select: { clubShortName: true },
			});
			clubShortName = sentinel?.clubShortName ?? null;
		}
	}

	// If we still don't know the club, drop the write. Stripe still gets 200
	// because there's nothing to retry into.
	if (!clubShortName) {
		return;
	}

	await ctx.db.orphanedPurchase.create({
		data: {
			clubShortName,
			processor: "stripe",
			providerSessionId,
			providerPaymentIntentId,
			email,
			reason: args.reason,
			status: "PENDING",
			rawEvent: args.event.raw as object,
			notes: args.notes,
		},
	});
}

// ============================================================
// CapacityRace — auto-refund via provider + orphan
// ============================================================

async function autoRefundAndOrphan(
	ctx: FailureContext,
	err: CapacityRaceError,
	event: ProviderEvent,
	parsed: ParsedProviderEvent,
): Promise<void> {
	if (!ctx.clubShortName) {
		await writeOrphan(ctx, {
			reason: "seat_filled_pre_webhook",
			event,
			parsed,
		});
		return;
	}

	// Resolve the connected account id for the refund call.
	const stripeAccount = await ctx.db.clubStripeAccount.findUnique({
		where: { clubShortName: ctx.clubShortName },
		select: { stripeAccountId: true },
	});

	if (stripeAccount && err.paymentIntentId) {
		try {
			const provider = getStripeProvider();
			await provider.createRefund({
				providerAccountId: stripeAccount.stripeAccountId,
				providerChargeId: "", // not needed when refunding by PI
				providerPaymentIntentId: err.paymentIntentId,
				amountInCents:
					parsed.kind === "checkout.completed" ? parsed.amountInCents : 0,
				refundApplicationFee: true,
				idempotencyKey: `auto-refund-${err.sessionId}`,
			});
		} catch {
			// Best-effort — the orphan row records the situation for manual
			// triage even if the auto-refund call itself failed.
		}
	}

	await writeOrphan(ctx, {
		reason: "seat_filled_pre_webhook",
		event,
		parsed,
	});
}
