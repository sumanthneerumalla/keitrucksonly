/**
 * Phase 12a Round 2 Stream 3 — tRPC `payments` router.
 *
 * Owns the user-facing surface of the Stripe Connect integration:
 *   - Onboarding (5 procedures: getConnectionStatus, shouldShowConnectBanner,
 *     startOnboarding, refreshAccountStatus, disconnect)
 *   - Checkout-session creation (7 startCheckout.* mutations, one per item kind)
 *   - Orphan queue management (listOrphans, resolveOrphan)
 *
 * All provider access goes through `getProviderForClub` (Stream 2 resolver) —
 * this file never imports `'stripe'`. Amounts are ALWAYS resolved server-side
 * from canonical rows; the client never submits a price.
 *
 * Locked decisions reflected here (designFiles/roadmap/phase12-stripe-connect.md):
 *   - §3 — direct charges; embedded checkout; no platform fees in 12a
 *     (`applicationFeeInCents: 0`)
 *   - §7.4 — surface-by-surface auth matrix (logged-in vs publicProcedure guest)
 *   - §7.6 — metadata contract (`checkoutSessionId`, `clubShortName`, `itemKind`,
 *     `itemId`, `consumerUserId`, `correlationId`)
 *   - §23 #3 — NO sync `refreshAccountStatus` in the checkout pre-check; trust
 *     the cached `ClubStripeAccount` row
 *   - §23 #6 — Choice B helper composition: the in-router checkout helper does
 *     NOT open `writeAuditedMutation` (CheckoutSession rows aren't business
 *     state-changes — they're a side-effect that the eventual webhook turns
 *     into auditable state via `sellPackageInternal` / `recordPaymentInternal`
 *     which own their own audited tx). Onboarding/disconnect/refresh/resolve
 *     ARE wrapped — they ARE business state changes.
 *   - §23 #11 — `shouldShowConnectBanner` predicate uses status-IN
 *     `('open','partially_paid','overdue')` rather than `outstandingInCents > 0`
 *     (outstanding is computed-not-stored per HANDOFF #95 — raw SQL only).
 *
 * Cross-tenant guard: every mutation that touches an Invoice / PackagePlan /
 * MembershipPlan / CalendarEvent / RentalBooking verifies the row's
 * `clubShortName` matches the caller's club before any provider call.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
	OrphanedPurchaseStatus,
	type Prisma,
	RentalBookingStatus,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	clubAdminProcedure,
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import {
	getProviderForClub,
	getStripeProvider,
} from "~/server/services/payments";
import type {
	CheckoutIdentityBlock,
	CheckoutIntent,
	CheckoutItemKind,
	FamilyGroupLinkOutcome,
} from "~/server/services/payments/types";
import {
	AUDIT_ACTIONS,
	AUDIT_SOURCES,
	writeAuditedMutation,
} from "~/server/utils/auditedMutation";
import { getConfig } from "~/server/utils/config";
import { recordRefundInternal } from "~/server/utils/invoicePayments";
import {
	getCurrentUser,
	isFacilityOrAbove,
	isPlatformAdmin,
	isSameClub,
} from "~/server/utils/utils";

// ============================================================
// Internal helpers
// ============================================================

/**
 * §7.8 two-identity capture block. Optional on every `startCheckout.*`
 * mutation — when present, the email is normalized server-side (lowercase
 * + trim per §7.8.3 STRICT) BEFORE being stored in `CheckoutSession.intent`.
 * Same shape for beneficiary and payer.
 */
const identityBlockSchema = z.object({
	firstName: z.string().trim().min(1).max(100),
	lastName: z.string().trim().max(100).default(""),
	// Validate as email; normalize at the helper. Keep max length sane.
	email: z.string().trim().email().max(255),
});

/**
 * Apply §7.8.3 strict normalization (lowercase + trim) and produce the
 * stored `CheckoutIdentityBlock` shape. Called from each startCheckout.*
 * mutation. Returns `null` if the input was undefined.
 */
function normalizeIdentityBlock(
	block: z.infer<typeof identityBlockSchema> | undefined,
): CheckoutIdentityBlock | null {
	if (!block) return null;
	return {
		firstName: block.firstName.trim(),
		lastName: block.lastName.trim(),
		email: block.email.trim().toLowerCase(),
	};
}

/**
 * Embedded Checkout return URL. The literal `{CHECKOUT_SESSION_ID}` token is
 * the **Stripe-side** placeholder — Stripe substitutes the Stripe session id
 * (cs_xxx) at completion. Our server confirmation page reads the local
 * CheckoutSession by its cuid (joined via providerSessionId), so passing the
 * Stripe id through the URL is fine.
 *
 * Round 3.6 N6 — guest flows land on `/shop/confirmation`, in-app flows on
 * `/checkout/confirmation`. The two pages render the same client; the split
 * just makes Stripe's receipt-email link point at the appropriate surface.
 */
const SHOP_CONFIRMATION_RETURN_URL =
	"/shop/confirmation?session_id={CHECKOUT_SESSION_ID}";
const INAPP_CONFIRMATION_RETURN_URL =
	"/checkout/confirmation?session_id={CHECKOUT_SESSION_ID}";

/**
 * Mint a CheckoutSession primary key in the cuid-style format the schema's
 * `@default(cuid())` produces (single letter prefix + 24 chars of base36).
 * We mint server-side because the id must be stamped into Stripe metadata
 * BEFORE the row is inserted (the webhook keys off `metadata.checkoutSessionId`).
 * Round 3.6 N2 — was `randomUUID()` (dash-formatted uuid); cuid-style matches
 * the rest of the codebase's id format and the schema column's default.
 *
 * Cryptographically random (16 random bytes → ~96 bits entropy after the
 * substring) is overkill for collision resistance at our scale but matches
 * the security profile of crypto.randomUUID. No new dependency.
 */
function mintCheckoutSessionId(): string {
	// 16 bytes → 26+ chars of base36; take 24 + 'c' prefix for the cuid shape.
	const tail = randomBytes(16).toString("hex");
	const base36 = BigInt(`0x${tail}`)
		.toString(36)
		.padStart(24, "0")
		.slice(0, 24);
	return `c${base36}`;
}

/**
 * Pre-check the cached `ClubStripeAccount` row. Per §23 #3 we do NOT call
 * `provider.refreshAccountStatus` here — that would add ~150ms to every
 * checkout for a once-per-decade event. If Stripe disables a club mid-day,
 * the in-flight buyer will see Stripe's own error message and retry.
 */
async function assertClubReadyForCharges(
	tx: Prisma.TransactionClient,
	clubShortName: string,
): Promise<{ providerAccountId: string }> {
	const account = await tx.clubStripeAccount.findUnique({
		where: { clubShortName },
		select: {
			stripeAccountId: true,
			chargesEnabled: true,
			disconnectedAt: true,
		},
	});
	if (!account || !account.chargesEnabled || account.disconnectedAt !== null) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"This club is not currently accepting online payments. Please contact the club directly.",
		});
	}
	return { providerAccountId: account.stripeAccountId };
}

/**
 * The shared internal helper for every `startCheckout.*` mutation. Owns:
 *   1. The cached-account pre-check (PRECONDITION_FAILED on fail).
 *   2. A locally-minted `checkoutSessionId` (cuid; stamped BOTH into Stripe
 *      metadata AND used as the CheckoutSession row's primary key — the
 *      webhook keys off `metadata.checkoutSessionId`).
 *   3. The provider.createCheckoutSession call (returns cs_xxx + clientSecret).
 *   4. The local CheckoutSession row insert (mirrors §7.3 schema).
 *   5. Returning `{ checkoutSessionId, clientSecret }` for the `/checkout/[id]`
 *      page.
 *
 * NOT wrapped in `writeAuditedMutation` — per §23 #6 (Choice B): the
 * CheckoutSession row is an in-flight side-effect, not auditable business
 * state. The webhook later mints MemberPackage / EventRegistration / etc. via
 * `sellPackageInternal` / `recordPaymentInternal` which own their own audited
 * transactions.
 *
 * The whole helper still runs inside a single Prisma $transaction so that the
 * row insert + provider call act as a unit (a failed insert after the Stripe
 * call is recoverable as an orphan via lastSyncedAt; a failed provider call
 * leaves no half-written row).
 */
async function createCheckoutSessionForIntent(
	db: Prisma.TransactionClient | Prisma.TransactionClient,
	args: {
		clubShortName: string;
		itemKind: CheckoutItemKind;
		itemId: string;
		amountInCents: number;
		description: string;
		consumerUserId: string | null;
		/**
		 * Round 2.7.1 — the user who clicked "Pay" (the actor), distinct from
		 * `consumerUserId` (the beneficiary). `null` for `publicProcedure`
		 * guest paths; populated from `ctx.user.userId` on `protectedProcedure`
		 * callers. Powers the §7.8.13 resume-checkout banner so a parent
		 * paying for a kid sees their own in-flight row, not the kid's.
		 */
		initiatedByUserId: string | null;
		billToUserId: string | null;
		invoiceId: string | null;
		customerEmail: string | undefined;
		providerCustomerId: string | undefined;
		/**
		 * §7.8 — two-identity blocks from the pre-Stripe form. Caller has
		 * already passed them through `normalizeIdentityBlock` so emails
		 * are lowercased + trimmed. Same-email dedup runs in this helper:
		 * if both emails match after normalization we collapse to a single
		 * identity and skip the family-group plans (§7.8.5).
		 */
		beneficiary?: CheckoutIdentityBlock | null;
		payer?: CheckoutIdentityBlock | null;
		/**
		 * Round 3.6 N6 — pick the Stripe `return_url` per surface:
		 *   - 'guest' (publicProcedure callers) → `/shop/confirmation?...`
		 *   - 'inapp' (protectedProcedure callers) → `/checkout/confirmation?...`
		 * Both pages render the same client, so neither branch breaks UX; the
		 * split keeps the Stripe receipt-email link pointed at the appropriate
		 * surface for that buyer.
		 */
		audience: "guest" | "inapp";
	},
): Promise<{ checkoutSessionId: string; clientSecret: string }> {
	const { providerAccountId } = await assertClubReadyForCharges(
		db,
		args.clubShortName,
	);

	// Mint the local id NOW so it can be stamped into Stripe metadata before
	// the Stripe row exists. We use it as both the metadata.checkoutSessionId
	// and the CheckoutSession PK so the webhook lookup is one indexed read.
	// Round 3.6 N2 — cuid-style id (matches schema's `@default(cuid())` shape
	// and the rest of the codebase) instead of dash-formatted uuid.
	const checkoutSessionId = mintCheckoutSessionId();
	const correlationId = randomUUID();

	// Round 2.7.1 — compute once, store on the local row AND pass to Stripe
	// (as Unix seconds) so the two sides agree on when this session goes
	// stale. 30 min matches Stripe's default + §7.8.12 stage 2 + §7.8.13.
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

	const metadata: Record<string, string> = {
		checkoutSessionId,
		clubShortName: args.clubShortName,
		itemKind: args.itemKind,
		itemId: args.itemId,
		// Empty string for guests — Stripe metadata is string-typed, no nulls.
		consumerUserId: args.consumerUserId ?? "",
		correlationId,
	};
	if (args.billToUserId) metadata.billToUserId = args.billToUserId;
	if (args.invoiceId) metadata.invoiceId = args.invoiceId;

	const provider = await getProviderForClub(db, args.clubShortName);

	const { sessionId, clientSecret } = await provider.createCheckoutSession({
		providerAccountId,
		amountInCents: args.amountInCents,
		currency: "usd",
		description: args.description,
		customerEmail: args.customerEmail,
		providerCustomerId: args.providerCustomerId,
		applicationFeeInCents: 0, // §3: 0% in 12a; scaffolded for future
		metadata,
		// Round 3.6 N6 — guest surfaces land on /shop/confirmation; logged-in
		// surfaces land on /checkout/confirmation. Both render the same client.
		returnUrl:
			args.audience === "guest"
				? SHOP_CONFIRMATION_RETURN_URL
				: INAPP_CONFIRMATION_RETURN_URL,
		expiresAt,
	});

	// §7.8.5 same-email dedup: collapse to a single identity. When both
	// blocks are present AND emails are identical after normalization we
	// drop the payer block, so the webhook treats it as self-pay (no
	// family group, billedToUserId left null).
	const beneficiary = args.beneficiary ?? undefined;
	let payer = args.payer ?? undefined;
	if (beneficiary && payer && beneficiary.email === payer.email) {
		payer = undefined;
	}

	const intent: CheckoutIntent = {
		itemKind: args.itemKind,
		itemId: args.itemId,
		consumerUserId: args.consumerUserId ?? undefined,
		amountInCents: args.amountInCents,
		description: args.description,
		// Two-identity blocks (optional). Both must be present together for
		// the webhook to take the two-identity path; one alone falls back
		// to single-identity behavior.
		beneficiary: beneficiary ?? undefined,
		payer: payer ?? undefined,
		metadata: {
			checkoutSessionId,
			clubShortName: args.clubShortName,
			itemKind: args.itemKind,
			itemId: args.itemId,
			consumerUserId: args.consumerUserId ?? undefined,
			invoiceId: args.invoiceId ?? undefined,
			billToUserId: args.billToUserId ?? undefined,
			correlationId,
		},
	};

	await db.checkoutSession.create({
		data: {
			id: checkoutSessionId,
			clubShortName: args.clubShortName,
			processor: "stripe",
			providerSessionId: sessionId,
			providerAccountId,
			clientSecret,
			amountInCents: args.amountInCents,
			description: args.description,
			intent: intent as unknown as Prisma.InputJsonValue,
			status: "open",
			consumerUserId: args.consumerUserId ?? null,
			// Round 2.7.1 — actor (who clicked Pay), distinct from
			// consumerUserId (beneficiary). Null on guest paths.
			initiatedByUserId: args.initiatedByUserId ?? null,
			invoiceId: args.invoiceId ?? null,
			// Round 2.7.1 — mirrors the Stripe session's expires_at.
			expiresAt,
		},
	});

	return { checkoutSessionId, clientSecret };
}

/**
 * Best-effort: pull the original Stripe-side amount off an `OrphanedPurchase`
 * row's stored rawEvent (used by `resolveOrphan` to drive an explicit Stripe
 * refund — see Round 2 Blocker #4). For checkout.session.completed events the
 * value lives at `rawEvent.data.object.amount_total`. Returns null if the
 * shape doesn't match (e.g. parse_error orphans, refund.created orphans).
 */
function extractOrphanAmountInCents(rawEvent: unknown): number | null {
	if (!rawEvent || typeof rawEvent !== "object") return null;
	const data = (rawEvent as { data?: unknown }).data;
	if (!data || typeof data !== "object") return null;
	const object = (data as { object?: unknown }).object;
	if (!object || typeof object !== "object") return null;
	const amount = (object as { amount_total?: unknown; amount?: unknown })
		.amount_total;
	if (typeof amount === "number" && Number.isFinite(amount)) return amount;
	const fallback = (object as { amount?: unknown }).amount;
	if (typeof fallback === "number" && Number.isFinite(fallback))
		return fallback;
	return null;
}

// ============================================================
// Router
// ============================================================

/**
 * `startCheckout.*` — one mutation per item kind. Each resolves the canonical
 * amount + description server-side, then defers to the shared internal helper.
 */
const startCheckoutRouter = createTRPCRouter({
	/**
	 * Pay-now from a member-facing invoice detail page. Auth mirrors
	 * `billing.getInvoice` (HANDOFF #120): the viewer must be the consumer
	 * (`userId`), the explicit payer (`billedToUserId`), or same-club staff.
	 * Anyone else gets NOT_FOUND so cross-club probes cannot enumerate ids.
	 */
	invoice: protectedProcedure
		.input(
			z.object({
				invoiceId: z.string().min(1),
				// §7.8 — optional two-identity blocks (parent-pays-for-kid via
				// the pre-Stripe form). Invoice pay-now usually skips the form
				// (the invoice already encodes consumer + billed-to), but we
				// accept them here for symmetry with the other surfaces.
				beneficiary: identityBlockSchema.optional(),
				payer: identityBlockSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const viewer = await getCurrentUser(ctx);
			return await ctx.db.$transaction(async (tx) => {
				const invoice = await tx.invoice.findUnique({
					where: { invoiceId: input.invoiceId },
					select: {
						invoiceId: true,
						invoiceNumber: true,
						clubShortName: true,
						userId: true,
						billedToUserId: true,
						totalInCents: true,
						amountPaidInCents: true,
						status: true,
						user: { select: { email: true } },
					},
				});
				if (!invoice) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Invoice not found",
					});
				}
				const isConsumer = invoice.userId === viewer.userId;
				const isPayer = invoice.billedToUserId === viewer.userId;
				const isStaffViewer =
					isPlatformAdmin(viewer) ||
					(isFacilityOrAbove(viewer) && isSameClub(viewer, invoice));
				if (!(isConsumer || isPayer || isStaffViewer)) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Invoice not found",
					});
				}
				if (invoice.status === "void") {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Voided invoices cannot be paid.",
					});
				}
				const balance = Math.max(
					0,
					invoice.totalInCents - invoice.amountPaidInCents,
				);
				if (balance <= 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "This invoice has no outstanding balance.",
					});
				}
				return await createCheckoutSessionForIntent(tx, {
					clubShortName: invoice.clubShortName,
					itemKind: "invoice",
					itemId: invoice.invoiceId,
					amountInCents: balance,
					description: `Invoice ${invoice.invoiceNumber}`,
					consumerUserId: invoice.userId,
					initiatedByUserId: viewer.userId,
					billToUserId: invoice.billedToUserId,
					invoiceId: invoice.invoiceId,
					customerEmail: invoice.user.email ?? undefined,
					providerCustomerId: undefined,
					beneficiary: normalizeIdentityBlock(input.beneficiary),
					payer: normalizeIdentityBlock(input.payer),
					audience: "inapp",
				});
			});
		}),

	/**
	 * Logged-in package self-purchase or staff-driven sell. `consumerUserId`
	 * defaults to the caller (Phase 8d self-purchase); when staff sets it
	 * explicitly they may also pass `billToUserId` (Phase 9a bill-to).
	 */
	package: protectedProcedure
		.input(
			z.object({
				packagePlanId: z.string().min(1),
				consumerUserId: z.string().min(1).optional(),
				billToUserId: z.string().min(1).optional(),
				beneficiary: identityBlockSchema.optional(),
				payer: identityBlockSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const viewer = await getCurrentUser(ctx);
			return await ctx.db.$transaction(async (tx) => {
				const plan = await tx.packagePlan.findUnique({
					where: { packagePlanId: input.packagePlanId },
					select: {
						packagePlanId: true,
						clubShortName: true,
						name: true,
						priceInCents: true,
						isActive: true,
					},
				});
				if (!plan) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Package plan not found",
					});
				}
				if (!isSameClub(viewer, plan)) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Package plan not found",
					});
				}
				if (!plan.isActive) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "This package is not currently available.",
					});
				}
				if (plan.priceInCents <= 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Free packages cannot be purchased online.",
					});
				}
				const consumerUserId = input.consumerUserId ?? viewer.userId;
				return await createCheckoutSessionForIntent(tx, {
					clubShortName: plan.clubShortName,
					itemKind: "package",
					itemId: plan.packagePlanId,
					amountInCents: plan.priceInCents,
					description: plan.name,
					consumerUserId,
					initiatedByUserId: viewer.userId,
					billToUserId: input.billToUserId ?? null,
					invoiceId: null,
					customerEmail: viewer.email ?? undefined,
					providerCustomerId: undefined,
					beneficiary: normalizeIdentityBlock(input.beneficiary),
					payer: normalizeIdentityBlock(input.payer),
					audience: "inapp",
				});
			});
		}),

	/**
	 * Public-shop guest path. consumerUserId is left null on the local row;
	 * the webhook resolves the user via `customer_details.email` (§7.7) and
	 * find-or-creates a Clerk user via `findOrCreateClerkUserId` (§8.5).
	 * Only publicly-listed plans are sellable through this surface.
	 */
	packageGuest: publicProcedure
		.input(
			z.object({
				clubShortName: z.string().min(1),
				packagePlanId: z.string().min(1),
				beneficiary: identityBlockSchema.optional(),
				payer: identityBlockSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return await ctx.db.$transaction(async (tx) => {
				const plan = await tx.packagePlan.findUnique({
					where: { packagePlanId: input.packagePlanId },
					select: {
						packagePlanId: true,
						clubShortName: true,
						name: true,
						priceInCents: true,
						isActive: true,
						isPubliclyListed: true,
					},
				});
				if (!plan || plan.clubShortName !== input.clubShortName) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Package plan not found",
					});
				}
				if (!plan.isActive || !plan.isPubliclyListed) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "This package is not available for online purchase.",
					});
				}
				if (plan.priceInCents <= 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Free packages cannot be purchased online.",
					});
				}
				return await createCheckoutSessionForIntent(tx, {
					clubShortName: plan.clubShortName,
					itemKind: "package",
					itemId: plan.packagePlanId,
					amountInCents: plan.priceInCents,
					description: plan.name,
					consumerUserId: null,
					// Guest path — no logged-in actor to attribute.
					initiatedByUserId: null,
					billToUserId: null,
					invoiceId: null,
					customerEmail: undefined,
					providerCustomerId: undefined,
					beneficiary: normalizeIdentityBlock(input.beneficiary),
					payer: normalizeIdentityBlock(input.payer),
					audience: "guest",
				});
			});
		}),

	/**
	 * Paid CalendarEvent purchase (logged-in). Free events use the existing
	 * register flow — not Stripe — so we reject if the event has no product or
	 * the product's price is 0. consumerUserId defaults to the caller; staff
	 * may pass an explicit consumerUserId to buy for a member.
	 */
	event: protectedProcedure
		.input(
			z.object({
				eventId: z.string().min(1),
				consumerUserId: z.string().min(1).optional(),
				beneficiary: identityBlockSchema.optional(),
				payer: identityBlockSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const viewer = await getCurrentUser(ctx);
			return await ctx.db.$transaction(async (tx) => {
				const event = await tx.calendarEvent.findUnique({
					where: { eventId: input.eventId },
					select: {
						eventId: true,
						clubShortName: true,
						title: true,
						product: { select: { priceInCents: true } },
					},
				});
				if (!event) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Event not found",
					});
				}
				if (!isSameClub(viewer, event)) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Event not found",
					});
				}
				const price = event.product?.priceInCents ?? 0;
				if (!event.product || price <= 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"This event is free or has no price; use the registration flow instead of checkout.",
					});
				}
				const consumerUserId = input.consumerUserId ?? viewer.userId;
				return await createCheckoutSessionForIntent(tx, {
					clubShortName: event.clubShortName,
					itemKind: "event",
					itemId: event.eventId,
					amountInCents: price,
					description: event.title,
					consumerUserId,
					initiatedByUserId: viewer.userId,
					billToUserId: null,
					invoiceId: null,
					customerEmail: viewer.email ?? undefined,
					providerCustomerId: undefined,
					beneficiary: normalizeIdentityBlock(input.beneficiary),
					payer: normalizeIdentityBlock(input.payer),
					audience: "inapp",
				});
			});
		}),

	/**
	 * Public-shop guest path for a paid event. Capacity race is a
	 * webhook-side concern (§11) — we don't pre-reserve a seat here.
	 */
	eventGuest: publicProcedure
		.input(
			z.object({
				clubShortName: z.string().min(1),
				eventId: z.string().min(1),
				beneficiary: identityBlockSchema.optional(),
				payer: identityBlockSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return await ctx.db.$transaction(async (tx) => {
				const event = await tx.calendarEvent.findUnique({
					where: { eventId: input.eventId },
					select: {
						eventId: true,
						clubShortName: true,
						title: true,
						isPublic: true,
						product: { select: { priceInCents: true } },
					},
				});
				if (!event || event.clubShortName !== input.clubShortName) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Event not found",
					});
				}
				if (!event.isPublic) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Event not found",
					});
				}
				const price = event.product?.priceInCents ?? 0;
				if (!event.product || price <= 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "This event is free; use the registration flow instead.",
					});
				}
				return await createCheckoutSessionForIntent(tx, {
					clubShortName: event.clubShortName,
					itemKind: "event",
					itemId: event.eventId,
					amountInCents: price,
					description: event.title,
					consumerUserId: null,
					// Guest path — no logged-in actor to attribute.
					initiatedByUserId: null,
					billToUserId: null,
					invoiceId: null,
					customerEmail: undefined,
					providerCustomerId: undefined,
					beneficiary: normalizeIdentityBlock(input.beneficiary),
					payer: normalizeIdentityBlock(input.payer),
					audience: "guest",
				});
			});
		}),

	/**
	 * Pay for a rental that has already been HELD by `validateAndCreateBooking`
	 * (CR-b). Status must still be CONFIRMED — a cancelled booking has lost
	 * its slot. The amount comes from the booking's product price.
	 */
	rental: protectedProcedure
		.input(
			z.object({
				rentalBookingId: z.string().min(1),
				beneficiary: identityBlockSchema.optional(),
				payer: identityBlockSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const viewer = await getCurrentUser(ctx);
			return await ctx.db.$transaction(async (tx) => {
				const booking = await tx.rentalBooking.findUnique({
					where: { bookingId: input.rentalBookingId },
					select: {
						bookingId: true,
						clubShortName: true,
						userId: true,
						status: true,
						product: { select: { name: true, priceInCents: true } },
					},
				});
				if (!booking) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Rental booking not found",
					});
				}
				if (!isSameClub(viewer, booking) || booking.userId !== viewer.userId) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Rental booking not found",
					});
				}
				if (booking.status !== RentalBookingStatus.CONFIRMED) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "This rental is no longer available for payment.",
					});
				}
				if (!booking.product || booking.product.priceInCents <= 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "This rental has no online price; pay at the front desk.",
					});
				}
				return await createCheckoutSessionForIntent(tx, {
					clubShortName: booking.clubShortName,
					itemKind: "rental",
					itemId: booking.bookingId,
					amountInCents: booking.product.priceInCents,
					description: booking.product.name,
					consumerUserId: viewer.userId,
					initiatedByUserId: viewer.userId,
					billToUserId: null,
					invoiceId: null,
					customerEmail: viewer.email ?? undefined,
					providerCustomerId: undefined,
					beneficiary: normalizeIdentityBlock(input.beneficiary),
					payer: normalizeIdentityBlock(input.payer),
					audience: "inapp",
				});
			});
		}),

	/**
	 * Membership initial purchase (Phase 10a one-time, no auto-renew in 12a —
	 * `autoRenew` stays false even if plan default is true; recurring billing
	 * needs SetupIntent which is 12b territory). Amount = recurring term fee
	 * + one-time initiation fee.
	 */
	membership: protectedProcedure
		.input(
			z.object({
				membershipPlanId: z.string().min(1),
				consumerUserId: z.string().min(1).optional(),
				billToUserId: z.string().min(1).optional(),
				beneficiary: identityBlockSchema.optional(),
				payer: identityBlockSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const viewer = await getCurrentUser(ctx);
			return await ctx.db.$transaction(async (tx) => {
				const plan = await tx.membershipPlan.findUnique({
					where: { membershipPlanId: input.membershipPlanId },
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
				if (!plan) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Membership plan not found",
					});
				}
				if (!isSameClub(viewer, plan)) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Membership plan not found",
					});
				}
				if (!plan.isActive) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "This membership is not currently available.",
					});
				}
				const amount = plan.feePerTermInCents + plan.initiationFeeInCents;
				if (amount <= 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Free memberships cannot be purchased online.",
					});
				}
				const consumerUserId = input.consumerUserId ?? viewer.userId;
				const description = plan.membershipType?.name
					? `${plan.membershipType.name} — ${plan.description}`
					: plan.description;
				return await createCheckoutSessionForIntent(tx, {
					clubShortName: plan.clubShortName,
					itemKind: "membership",
					itemId: plan.membershipPlanId,
					amountInCents: amount,
					description,
					consumerUserId,
					initiatedByUserId: viewer.userId,
					billToUserId: input.billToUserId ?? null,
					invoiceId: null,
					customerEmail: viewer.email ?? undefined,
					providerCustomerId: undefined,
					beneficiary: normalizeIdentityBlock(input.beneficiary),
					payer: normalizeIdentityBlock(input.payer),
					audience: "inapp",
				});
			});
		}),
});

export const paymentsRouter = createTRPCRouter({
	// ========================================================
	// Config (no-SSH workaround — §24)
	// ========================================================

	/**
	 * Returns the Stripe publishable key resolved via env-first / DB-fallback
	 * (see `getConfig`). `publicProcedure` because guest checkouts on
	 * `/checkout/[sessionId]` need to load Stripe.js without a logged-in user.
	 * The CheckoutPage server component is the primary caller (passes the key
	 * down to CheckoutClient as a prop); this tRPC procedure exists for any
	 * future client-only surface that needs to load Stripe.js.
	 */
	getPublishableKey: publicProcedure.query(async () => {
		const publishableKey = await getConfig(
			"NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
		);
		if (!publishableKey) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Stripe publishable key not configured.",
			});
		}
		return { publishableKey };
	}),

	// ========================================================
	// Onboarding (5 procedures)
	// ========================================================

	/**
	 * Returns the club's current Stripe connection row plus a computed
	 * `isReadyForCharges` flag. Used by the settings page AND by member-facing
	 * surfaces (InvoiceDetail Pay-Now button) to decide whether checkout is
	 * available — Stream 6 will surface it. Per §23 #3 we do NOT call out to
	 * Stripe here; the cached row is the source of truth.
	 */
	getConnectionStatus: clubAdminProcedure.query(async ({ ctx }) => {
		const account = await ctx.db.clubStripeAccount.findUnique({
			where: { clubShortName: ctx.user.clubShortName },
		});
		const isReadyForCharges =
			account?.chargesEnabled === true && account.disconnectedAt === null;
		// Accounts v2 migration (2026-06-01): the pre-Connect form prefills
		// the contact email from the calling admin. Surface it here so the
		// settings page server component can hand it to the client card
		// without a separate fetch.
		return {
			account,
			isReadyForCharges,
			adminEmail: ctx.user.email ?? null,
		};
	}),

	/**
	 * Drives the conditional "Connect Stripe" banner on the admin dashboard
	 * (Stream 5). Per §23 #11: the "outstanding invoices" leg uses status-IN
	 * filtering, NOT computed-outstanding (which would need raw SQL per
	 * HANDOFF #95). "overdue" is a derived display status, not a stored one;
	 * keeping it in the IN clause is harmless and matches the design's
	 * verbatim predicate.
	 */
	shouldShowConnectBanner: clubAdminProcedure.query(async ({ ctx }) => {
		const clubShortName = ctx.user.clubShortName;
		const account = await ctx.db.clubStripeAccount.findUnique({
			where: { clubShortName },
			select: { chargesEnabled: true, disconnectedAt: true },
		});
		const isReady =
			account?.chargesEnabled === true && account.disconnectedAt === null;
		if (isReady) return { show: false, reason: null };

		// Does the club have at least one publicly-listed paid item?
		const [paidPackage, paidProduct, openInvoice] = await Promise.all([
			ctx.db.packagePlan.findFirst({
				where: {
					clubShortName,
					isPubliclyListed: true,
					priceInCents: { gt: 0 },
				},
				select: { packagePlanId: true },
			}),
			ctx.db.product.findFirst({
				where: {
					clubShortName,
					isPubliclyListed: true,
					priceInCents: { gt: 0 },
				},
				select: { productId: true },
			}),
			ctx.db.invoice.findFirst({
				where: {
					clubShortName,
					status: { in: ["open", "partially_paid", "overdue"] },
				},
				select: { invoiceId: true },
			}),
		]);

		const hasPaidItems = paidPackage !== null || paidProduct !== null;
		const hasOutstanding = openInvoice !== null;

		if (hasPaidItems) return { show: true, reason: "has_paid_items" };
		if (hasOutstanding)
			return { show: true, reason: "has_outstanding_invoices" };
		return { show: false, reason: null };
	}),

	/**
	 * Mint a fresh Stripe Account Link. First-time: instantiate StripeProvider
	 * directly (the resolver `getProviderForClub` requires a row, which doesn't
	 * exist yet — chicken-and-egg). Create the Stripe Standard account, persist
	 * a `ClubStripeAccount` row with `chargesEnabled=false`, return the URL.
	 *
	 * Resume (row exists, chargesEnabled=false): Stream 2's `PaymentProvider`
	 * interface does not expose a "mint a new accountLink against an existing
	 * Stripe account" method — its only onboarding entry point
	 * (`createOnboardingLink`) creates a NEW Stripe account each call, which
	 * would orphan the existing one. Throwing PRECONDITION_FAILED for now
	 * surfaces the gap rather than silently leaking accounts; resolving it is a
	 * follow-up task (extend the provider interface with
	 * `createAccountLinkForExisting(providerAccountId, …)`).
	 *
	 * Both branches use `writeAuditedMutation` since they ARE business state
	 * changes (creating a Stripe account, stamping connectedAt).
	 */
	startOnboarding: clubAdminProcedure
		.input(
			z.object({
				// Accounts v2 migration (2026-06-01): 5 universal pre-Connect
				// fields collected by `<StripeConnectionCard>` before redirect
				// to Stripe's hosted onboarding (§6.1 + §23 row 12).
				businessName: z.string().trim().min(1).max(200),
				country: z
					.string()
					.trim()
					.length(2)
					.transform((s) => s.toLowerCase())
					.default("us"),
				entityType: z.enum([
					"company",
					"individual",
					"non_profit",
					"government_entity",
				]),
				contactEmail: z.string().trim().email().max(255),
				displayName: z
					.string()
					.trim()
					.max(200)
					.optional()
					.transform((v) => (v === "" ? undefined : v)),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clubShortName = ctx.user.clubShortName;

			const existing = await ctx.db.clubStripeAccount.findUnique({
				where: { clubShortName },
				select: { stripeAccountId: true, chargesEnabled: true },
			});

			if (existing) {
				// Resume path — see docstring. Block until the provider interface
				// grows a "fresh link for existing account" method.
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"A Stripe account is already linked. Resuming an incomplete onboarding from this UI is not yet implemented — please complete onboarding in the Stripe dashboard, then click Refresh.",
				});
			}

			// First-time path — direct provider instantiation since
			// `getProviderForClub` would throw without a row.
			const provider = getStripeProvider();
			// Stripe's AccountLink API (v1 AND v2) REQUIRES absolute URLs —
			// path-only strings either fail validation or redirect the user
			// onto Stripe's own domain after onboarding. Resolve via env-first
			// / DB-fallback so the owner can configure this without SSH (same
			// no-SSH workaround pattern the Stripe secrets use, §24/§25).
			const appUrlRaw = await getConfig("NEXT_PUBLIC_APP_URL");
			if (!appUrlRaw) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						'App URL not configured. Set the NEXT_PUBLIC_APP_URL env var or add a PlatformConfig row with key "NEXT_PUBLIC_APP_URL" (e.g., https://www.dev.facilitypresence.com).',
				});
			}
			// Strip trailing slashes so the resulting URL doesn't end up with
			// a double `//` after path concatenation.
			const appUrl = appUrlRaw.replace(/\/+$/, "");
			const returnUrl = `${appUrl}/admin/settings/payments?stripe=return`;
			const refreshUrl = `${appUrl}/admin/settings/payments?stripe=refresh`;
			const { url, providerAccountId } = await provider.createOnboardingLink({
				clubShortName,
				returnUrl,
				refreshUrl,
				businessName: input.businessName,
				country: input.country,
				entityType: input.entityType,
				contactEmail: input.contactEmail,
				displayName: input.displayName,
			});

			// Snapshot livemode immediately so a misregistered prod-vs-test endpoint
			// is caught by the webhook's livemode-mismatch guard.
			const livemode = process.env.STRIPE_LIVEMODE === "true";

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					const row = await tx.clubStripeAccount.create({
						data: {
							clubShortName,
							stripeAccountId: providerAccountId,
							livemode,
							chargesEnabled: false,
							payoutsEnabled: false,
							detailsSubmitted: false,
							accountEmail: input.contactEmail,
						},
					});
					return {
						result: { url },
						audit: {
							action: AUDIT_ACTIONS.STRIPE_ACCOUNT_CONNECTED,
							targetUserId: null,
							entityType: "ClubStripeAccount",
							entityId: row.id,
							metadata: {
								providerAccountId,
								livemode,
								// v2 migration: capture the form input on the audit row so
								// owner can reconcile "what did we send to Stripe?".
								businessName: input.businessName,
								country: input.country,
								entityType: input.entityType,
								contactEmail: input.contactEmail,
								displayName: input.displayName ?? null,
							},
						},
					};
				},
			);
		}),

	/**
	 * Pull latest account status from Stripe and write it back to the cached
	 * row. Called by the settings page on mount + after a Stripe return URL
	 * (`?stripe=return`). Emits `STRIPE_ACCOUNT_UPDATED` so a Stripe-side
	 * change (e.g. requirements satisfied) is reflected in the audit log.
	 */
	refreshAccountStatus: clubAdminProcedure.mutation(async ({ ctx }) => {
		const clubShortName = ctx.user.clubShortName;
		const existing = await ctx.db.clubStripeAccount.findUnique({
			where: { clubShortName },
		});
		if (!existing) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "No Stripe account is linked to this club yet.",
			});
		}
		const provider = await getProviderForClub(ctx.db, clubShortName);
		const status = await provider.refreshAccountStatus(
			existing.stripeAccountId,
		);

		return await writeAuditedMutation(
			{
				db: ctx.db,
				actorUserId: ctx.user.userId,
				clubShortName,
				source: AUDIT_SOURCES.ADMIN_DASHBOARD,
			},
			async (tx) => {
				const updated = await tx.clubStripeAccount.update({
					where: { clubShortName },
					data: {
						chargesEnabled: status.chargesEnabled,
						payoutsEnabled: status.payoutsEnabled,
						detailsSubmitted: status.detailsSubmitted,
						accountEmail: status.accountEmail,
						livemode: status.livemode,
						lastSyncedAt: new Date(),
					},
				});
				return {
					result: updated,
					audit: {
						action: AUDIT_ACTIONS.STRIPE_ACCOUNT_UPDATED,
						targetUserId: null,
						entityType: "ClubStripeAccount",
						entityId: updated.id,
						metadata: {
							chargesEnabled: status.chargesEnabled,
							payoutsEnabled: status.payoutsEnabled,
							detailsSubmitted: status.detailsSubmitted,
						},
					},
				};
			},
		);
	}),

	/**
	 * Soft-disconnect: stamps `disconnectedAt`. Does NOT call Stripe — Standard
	 * accounts retain the OAuth relationship. "Disconnect" means "stop using
	 * Stripe in ShuttleMentor," not "delete the Stripe account."
	 *
	 * `confirm: z.literal(true)` forces a deliberate yes from the caller —
	 * the UI shows an AlertDialog and submits `{ confirm: true }` only on
	 * explicit click. A missing or false `confirm` is a hard validation error.
	 */
	disconnect: clubAdminProcedure
		.input(z.object({ confirm: z.literal(true) }))
		.mutation(async ({ ctx }) => {
			const clubShortName = ctx.user.clubShortName;
			const existing = await ctx.db.clubStripeAccount.findUnique({
				where: { clubShortName },
				select: { id: true, disconnectedAt: true },
			});
			if (!existing) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "No Stripe account is linked to this club.",
				});
			}
			if (existing.disconnectedAt !== null) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "This Stripe account is already disconnected.",
				});
			}
			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					await tx.clubStripeAccount.update({
						where: { clubShortName },
						data: { disconnectedAt: new Date() },
					});
					return {
						result: undefined,
						audit: {
							action: AUDIT_ACTIONS.STRIPE_ACCOUNT_DISCONNECTED,
							targetUserId: null,
							entityType: "ClubStripeAccount",
							entityId: existing.id,
						},
					};
				},
			);
		}),

	// ========================================================
	// Checkout (8: 7 startCheckout.* + the shared helper above)
	// ========================================================

	startCheckout: startCheckoutRouter,

	// ========================================================
	// Resume / confirmation surface (Round 2.7 — §7.8.13)
	// ========================================================

	/**
	 * Drives the "⏳ You have an unfinished checkout" banner on `/account/*`
	 * pages (§7.8.13). Filters by the caller's userId + clubShortName +
	 * status='open' + `expiresAt > now()`. Returns `[]` when nothing pending
	 * — banner stays hidden.
	 *
	 * Round 2.7.1: `userId` in design-doc speak maps to our
	 * `CheckoutSession.initiatedByUserId` column — the user who clicked
	 * "Pay" (the actor), NOT `consumerUserId` (the beneficiary). For a
	 * parent paying for a kid's membership the parent's banner shows the
	 * row even though the kid is the consumer. Guest sessions have
	 * `initiatedByUserId=null` and never surface here.
	 */
	listMyOpenCheckouts: protectedProcedure.query(async ({ ctx }) => {
		const viewer = await getCurrentUser(ctx);
		const now = new Date();
		const rows = await ctx.db.checkoutSession.findMany({
			where: {
				clubShortName: viewer.clubShortName,
				initiatedByUserId: viewer.userId,
				status: "open",
				expiresAt: { gt: now },
			},
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				description: true,
				amountInCents: true,
				expiresAt: true,
			},
		});
		return rows.map((row) => ({
			checkoutSessionId: row.id,
			description: row.description,
			amountInCents: row.amountInCents,
			expiresAt: row.expiresAt,
		}));
	}),

	/**
	 * Dismiss a stale CheckoutSession from the resume banner (§7.8.13).
	 * Cross-tenant + ownership guarded: row's `initiatedByUserId` must equal
	 * the caller (matches the banner's visibility predicate — only the
	 * actor who started a checkout may dismiss it) and its `clubShortName`
	 * must match — otherwise NOT_FOUND to avoid cross-tenant enumeration.
	 */
	dismissCheckoutSession: protectedProcedure
		.input(z.object({ checkoutSessionId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const viewer = await getCurrentUser(ctx);
			const row = await ctx.db.checkoutSession.findUnique({
				where: { id: input.checkoutSessionId },
				select: {
					id: true,
					clubShortName: true,
					initiatedByUserId: true,
					status: true,
				},
			});
			if (
				!row ||
				row.clubShortName !== viewer.clubShortName ||
				row.initiatedByUserId !== viewer.userId
			) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Checkout session not found",
				});
			}
			// No-op if already terminal — silent success keeps the UI simple.
			if (row.status === "open") {
				await ctx.db.checkoutSession.update({
					where: { id: row.id },
					data: { status: "expired" },
				});
			}
			return { ok: true as const };
		}),

	/**
	 * Confirmation-page poll surface (§7.8.7, §7.8.11 E5). Guest confirmation
	 * pages call this every 2s for up to 30s waiting for the webhook to
	 * mark the row 'completed' — hence `publicProcedure` (no auth).
	 *
	 * Lookup is by `providerSessionId` (Stripe's `cs_xxx`, the value Stripe
	 * substitutes into the `{CHECKOUT_SESSION_ID}` template variable on
	 * the return URL) — NOT our internal `CheckoutSession.id`.
	 *
	 * Output is deliberately narrow: status + completedAt + familyGroupOutcome.
	 * No amount, description, identity emails — anything that could be
	 * scraped by guessing session ids stays server-side.
	 */
	getCheckoutSessionStatus: publicProcedure
		.input(z.object({ sessionId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const row = await ctx.db.checkoutSession.findUnique({
				where: { providerSessionId: input.sessionId },
				select: {
					status: true,
					updatedAt: true,
					intent: true,
				},
			});
			if (!row) {
				// Guest confirmation pages may hit this before the local row
				// is even created in race conditions — return a stable shape
				// so the poller can keep trying without crashing.
				return {
					status: "open" as const,
					completedAt: undefined,
					familyGroupOutcome: undefined,
				};
			}
			// `CheckoutSession.status` is a String column (not an enum); the
			// design contract documents these four values. We cast to keep
			// the public type narrow for callers.
			const status = row.status as "open" | "completed" | "expired" | "failed";
			// Read the outcome out of intent JSON (no dedicated column — see
			// CheckoutIntent.familyGroupOutcome in types.ts).
			const familyGroupOutcome =
				(row.intent as { familyGroupOutcome?: FamilyGroupLinkOutcome } | null)
					?.familyGroupOutcome ?? undefined;
			return {
				status,
				completedAt: status === "completed" ? row.updatedAt : undefined,
				familyGroupOutcome,
			};
		}),

	// ========================================================
	// Orphan management (2 procedures)
	// ========================================================

	/**
	 * Cursor-paginated list of orphaned purchases for the admin queue
	 * (`/admin/payments/orphans`, Stream 5). Default page size 50; ordered
	 * newest first.
	 */
	listOrphans: clubAdminProcedure
		.input(
			z
				.object({
					status: z.nativeEnum(OrphanedPurchaseStatus).optional(),
					cursor: z.string().min(1).optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const pageSize = 50;
			const where: Prisma.OrphanedPurchaseWhereInput = {
				clubShortName: ctx.user.clubShortName,
			};
			if (input?.status) where.status = input.status;

			const rows = await ctx.db.orphanedPurchase.findMany({
				where,
				orderBy: [{ createdAt: "desc" }, { id: "asc" }],
				take: pageSize + 1,
				...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
			});
			const hasMore = rows.length > pageSize;
			const items = hasMore ? rows.slice(0, pageSize) : rows;
			const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
			return { items, nextCursor };
		}),

	/**
	 * Resolve a single orphan: reconcile (mark fixed manually), refund (call
	 * provider.createRefund with deterministic idempotency key), or ignore.
	 * Stamps status + resolvedAt + resolvedBy. Emits `ORPHAN_RESOLVED`.
	 *
	 * Wrapped in `writeAuditedMutation` — owner-visible state change.
	 */
	resolveOrphan: clubAdminProcedure
		.input(
			z.object({
				orphanId: z.string().min(1),
				// Round 2 Blocker #4: the prior `'refund'` value was ambiguous
				// (UI might mean "refund-via-Stripe" OR "cash refund — clear the
				// row"). Renamed to `refund_via_stripe` so intent is explicit
				// and matches the parallel `payments.refundStripePayment`
				// endpoint for invoice-side refunds.
				action: z.enum(["reconcile", "refund_via_stripe", "ignore"]),
				notes: z.string().max(2000).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clubShortName = ctx.user.clubShortName;

			const orphan = await ctx.db.orphanedPurchase.findUnique({
				where: { id: input.orphanId },
				select: {
					id: true,
					clubShortName: true,
					status: true,
					providerPaymentIntentId: true,
					providerSessionId: true,
					rawEvent: true,
				},
			});
			if (!orphan || orphan.clubShortName !== clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Orphan not found",
				});
			}
			if (orphan.status !== OrphanedPurchaseStatus.PENDING) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "This orphan has already been resolved.",
				});
			}

			// Refund action: call Stripe BEFORE opening the audit tx so a
			// provider error doesn't roll back an empty audit; the row stamp
			// happens INSIDE the audited tx so the audit + state change commit
			// atomically. The deterministic key dedupes accidental double-clicks
			// AND any Stripe-retry replay of the original webhook.
			let refundResult: {
				providerRefundId: string;
				feeInCents: number | null;
			} | null = null;
			if (input.action === "refund_via_stripe") {
				if (!orphan.providerPaymentIntentId) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"This orphan has no provider payment intent — refund cannot be issued.",
					});
				}
				// Round 2 Blocker #4: prior code passed `amountInCents: 0` and
				// commented "0 = full refund". Stripe rejects 0 — full refund
				// is communicated by *omitting* `amount`, but our internal
				// `createRefund` now hard-requires positive `amountInCents`
				// (see stripe.ts). Pull the original amount off the orphan's
				// rawEvent (Checkout Session `amount_total`); reject if absent
				// (e.g. parse_error orphan with no amount).
				const orphanAmount = extractOrphanAmountInCents(orphan.rawEvent);
				if (orphanAmount === null || orphanAmount <= 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"No amount on orphan to refund — please use the Stripe dashboard for this row.",
					});
				}
				const account = await ctx.db.clubStripeAccount.findUnique({
					where: { clubShortName },
					select: { stripeAccountId: true, disconnectedAt: true },
				});
				if (!account || account.disconnectedAt !== null) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"This club's Stripe connection is disconnected — refund cannot be issued.",
					});
				}
				const provider = await getProviderForClub(ctx.db, clubShortName);
				refundResult = await provider.createRefund({
					providerAccountId: account.stripeAccountId,
					providerChargeId: "", // unused for direct charges; PI is sufficient
					providerPaymentIntentId: orphan.providerPaymentIntentId,
					amountInCents: orphanAmount,
					refundApplicationFee: false, // §3: no platform fees in 12a
					idempotencyKey: `manual-refund-${orphan.id}`,
				});
			}

			const nextStatus =
				input.action === "refund_via_stripe"
					? OrphanedPurchaseStatus.REFUNDED
					: input.action === "reconcile"
						? OrphanedPurchaseStatus.RECONCILED
						: OrphanedPurchaseStatus.IGNORED;

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					const updated = await tx.orphanedPurchase.update({
						where: { id: orphan.id },
						data: {
							status: nextStatus,
							notes: input.notes ?? undefined,
							resolvedAt: new Date(),
							resolvedBy: ctx.user.userId,
						},
					});
					return {
						result: updated,
						audit: {
							action: AUDIT_ACTIONS.ORPHAN_RESOLVED,
							targetUserId: null,
							entityType: "OrphanedPurchase",
							entityId: updated.id,
							metadata: {
								action: input.action,
								...(refundResult
									? { providerRefundId: refundResult.providerRefundId }
									: {}),
							},
						},
					};
				},
			);
		}),

	// ========================================================
	// Stripe-side refund (Round 2 Blocker #2 — explicit "send money back to
	// the card" path). The bookkeeping-only path lives at
	// `billing.recordRefund` (cash/check/account-credit returns); it does NOT
	// touch Stripe. This endpoint is the ONLY way to call Stripe refund from
	// an invoice-payment context — Round 3 UI offers "How are you returning
	// the money?" with **account credit as the default** and routes only the
	// explicit "back to the card" choice here.
	// ========================================================
	refundStripePayment: clubAdminProcedure
		.input(
			z.object({
				paymentId: z.string().min(1),
				amountInCents: z.number().int().positive(),
				reason: z.string().trim().min(1).max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const clubShortName = ctx.user.clubShortName;

			const payment = await ctx.db.invoicePayment.findUnique({
				where: { paymentId: input.paymentId },
				select: {
					paymentId: true,
					amountInCents: true,
					processor: true,
					processorChargeId: true,
					processorTransactionId: true,
					invoiceId: true,
					invoice: {
						select: {
							invoiceId: true,
							userId: true,
							billedToUserId: true,
							clubShortName: true,
							creditConsumedInCents: true,
							creditConsumedAt: true,
							status: true,
						},
					},
				},
			});
			if (!payment) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Payment not found",
				});
			}
			// Cross-tenant guard — the payment's invoice must live in caller's club.
			if (payment.invoice.clubShortName !== clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Payment not found",
				});
			}
			if (payment.invoice.status === "void") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Cannot refund a payment on a void invoice.",
				});
			}
			if (payment.processor !== "stripe") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This payment was not collected via Stripe — use the bookkeeping refund path (cash / check / account credit) instead.",
				});
			}
			if (!payment.processorChargeId && !payment.processorTransactionId) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This payment is missing Stripe identifiers — refund cannot be issued through this path.",
				});
			}
			// Pre-call D1 guard (HANDOFF #123): if the overpayment from this
			// payment was already consumed as account credit on other invoices,
			// reversing it via Stripe would over-reverse the credit ledger.
			// `recordRefundInternal` re-checks under the lock; we surface it
			// up-front to avoid a half-attempted Stripe call.
			if (
				payment.invoice.creditConsumedInCents > 0 ||
				payment.invoice.creditConsumedAt !== null
			) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"Refund would over-reverse the credit ledger; reverse applied credit first.",
				});
			}
			// Over-refund guard (Round 3.6 IMPORTANT #1): cap = paid −
			// already-refunded − credit-already-issued-against-this-payment.
			// Without the credit term, an admin who issued $50 of account
			// credit on a $100 payment could still Stripe-refund the full
			// $100 to the card → $150 returned against $100 paid.
			// `recordRefundInternal` re-runs the same math under the
			// per-payer advisory lock; this is the pre-lock fast-fail.
			const [priorRefunds, priorCreditIssued] = await Promise.all([
				ctx.db.invoiceRefund.aggregate({
					_sum: { amountInCents: true },
					where: { paymentId: payment.paymentId },
				}),
				ctx.db.invoiceLineItem.aggregate({
					_sum: { totalInCents: true },
					where: {
						creditFromPaymentId: payment.paymentId,
						kind: "CREDIT",
					},
				}),
			]);
			const alreadyRefunded = priorRefunds._sum.amountInCents ?? 0;
			// CREDIT line totals are negative; abs to get the dollar amount
			// of credit already issued against this payment.
			const alreadyCredited = Math.abs(
				priorCreditIssued._sum.totalInCents ?? 0,
			);
			const refundable =
				payment.amountInCents - alreadyRefunded - alreadyCredited;
			if (input.amountInCents > refundable) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: `Refund would exceed remaining refundable amount. Payment $${(payment.amountInCents / 100).toFixed(2)} paid; $${(alreadyRefunded / 100).toFixed(2)} already refunded; $${(alreadyCredited / 100).toFixed(2)} issued as account credit. Maximum refundable via Stripe: $${(refundable / 100).toFixed(2)}.`,
				});
			}
			// Disconnect guard.
			const account = await ctx.db.clubStripeAccount.findUnique({
				where: { clubShortName },
				select: { stripeAccountId: true, disconnectedAt: true },
			});
			if (!account || account.disconnectedAt !== null) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This club's Stripe connection is disconnected — refund cannot be issued.",
				});
			}
			if (!payment.processorTransactionId) {
				// processorTransactionId is the PaymentIntent for direct charges;
				// `createRefund` requires it. processorChargeId alone isn't
				// sufficient for our internal path (we refund by PI).
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This payment is missing its Stripe PaymentIntent id — refund cannot be issued through this path.",
				});
			}

			// Call Stripe FIRST so a provider error doesn't poison the audit.
			// The internal bookkeeping write then records the InvoiceRefund row
			// via `recordRefundInternal` (which opens its own audited tx,
			// holds the per-payer advisory lock, re-checks D1 under the lock,
			// and emits REFUND_ISSUED). Idempotency key is per-payment-cuid so
			// accidental double-clicks dedupe at Stripe's edge.
			const idempotencyKey = `stripe-refund-${payment.paymentId}-${randomUUID()}`;
			const provider = await getProviderForClub(ctx.db, clubShortName);
			const { providerRefundId, feeInCents } = await provider.createRefund({
				providerAccountId: account.stripeAccountId,
				providerChargeId: payment.processorChargeId ?? "",
				providerPaymentIntentId: payment.processorTransactionId,
				amountInCents: input.amountInCents,
				refundApplicationFee: true,
				idempotencyKey,
			});

			const { refund } = await recordRefundInternal({
				db: ctx.db,
				clubShortName,
				actorUserId: ctx.user.userId,
				source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				payment: {
					paymentId: payment.paymentId,
					amountInCents: payment.amountInCents,
					processor: payment.processor,
					invoiceId: payment.invoiceId,
					invoice: {
						userId: payment.invoice.userId,
						billedToUserId: payment.invoice.billedToUserId,
					},
				},
				refundedByUserId: ctx.user.userId,
				input: {
					paymentId: payment.paymentId,
					amountInCents: input.amountInCents,
					reason: input.reason,
					processorRefundId: providerRefundId,
					processorFeeInCents: feeInCents ?? undefined,
				},
			});

			return refund;
		}),
});
