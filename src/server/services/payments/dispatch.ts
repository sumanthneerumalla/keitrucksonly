/**
 * Phase 12a — webhook event dispatch.
 *
 * `dispatchParsedEvent(db, parsed, event)` is called by `stripeWebhook.ts`
 * AFTER the dedup-row tx (`ProcessedProcessorEvent` insert) has committed.
 * Per phase12 §9.3.1 Choice B the dispatcher runs OUTSIDE that outer tx —
 * each downstream helper (`sellPackageInternal`, `sellMembershipInternal`,
 * `recordPaymentInternal`, `recordRefundInternal`) opens its OWN audited
 * transaction.
 *
 * Responsibilities by event kind:
 *   - `checkout.completed`:    resolve buyer (guest path = Clerk + local
 *                              find-or-create), update CheckoutSession state,
 *                              and dispatch by `intent.itemKind` to the right
 *                              downstream helper.
 *   - `refund.created`:        Path B sync (§9.2). Skip if Path A already
 *                              recorded `(processor, processorRefundId)`.
 *                              Pre-check D1 (consumed credit) before
 *                              attempting to record.
 *   - `account.updated`:       sync `ClubStripeAccount` flags + audit row.
 *   - `payment_intent.failed`: best-effort, no member-side action in 12a.
 *   - `unhandled`:             no-op.
 *
 * Errors raised here (caught by stripeWebhook.ts):
 *   - `WebhookFailure({ reason })`   → failure module writes OrphanedPurchase
 *                                       (and, for `'capacity_race'`,
 *                                       auto-refunds via Stripe first). The
 *                                       reason string carries the same
 *                                       vocabulary the old per-class shape
 *                                       used (`'unknown_metadata'`,
 *                                       `'unknown_club'`,
 *                                       `'clerk_create_failed_buyer'`,
 *                                       `'capacity_race'`, …).
 *   - Any other throw                → 500 to Stripe; retried.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
	type CheckoutIdentityBlock,
	type CheckoutIntent,
	type FamilyGroupLinkOutcome,
	type ParsedProviderEvent,
	type ProviderEvent,
	WebhookFailure,
} from "~/server/services/payments/types";
import {
	AUDIT_ACTIONS,
	AUDIT_SOURCES,
	writeAuditedMutation,
} from "~/server/utils/auditedMutation";
import {
	ClerkPersistentError,
	findOrCreateClerkUserId,
	findOrCreateLocalUserAccount,
} from "~/server/utils/createUserAccount";
import {
	assertRegistrable,
	createRegistrationTx,
} from "~/server/utils/eventRegistration";
import { linkFamilyGroup } from "~/server/utils/familyGroups";
import { assertLineItemKindConsistency } from "~/server/utils/invoiceLineItems";
import {
	recordPaymentInternal,
	recordRefundInternal,
} from "~/server/utils/invoicePayments";
import { getOrCreateOpenInvoice } from "~/server/utils/invoiceTab";
import { sellMembershipInternal } from "~/server/utils/sellMembership";
import { sellPackageInternal } from "~/server/utils/sellPackage";

// ============================================================
// Helpers
// ============================================================

/**
 * Split a Stripe customer name into firstName / lastName per §23 #2.
 * First whitespace boundary; falls back to email local-part if name is null.
 */
function splitGuestName(
	name: string | null,
	email: string,
): { firstName: string; lastName: string } {
	if (name && name.trim().length > 0) {
		const trimmed = name.trim();
		const idx = trimmed.search(/\s+/);
		if (idx === -1) return { firstName: trimmed, lastName: "" };
		return {
			firstName: trimmed.slice(0, idx),
			lastName: trimmed.slice(idx).trim(),
		};
	}
	const localPart = email.split("@")[0] ?? "user";
	return { firstName: localPart, lastName: "" };
}

/**
 * Cast the JSON intent stored on CheckoutSession back to the typed shape.
 * The row is server-written by `payments.startCheckout.*`, so the cast is
 * trusted.
 */
function asCheckoutIntent(json: Prisma.JsonValue): CheckoutIntent {
	return json as unknown as CheckoutIntent;
}

/**
 * Defensive normalization (§7.8.3 STRICT): lowercase + trim. We normalize
 * at mutation input AND here so a tampered intent row can't slip past.
 */
function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

/**
 * Resolve a single identity block via the existing Round 1 helpers
 * (Clerk find-or-create THEN local find-or-create — decision #24 / Option A).
 * Refines `ClerkPersistentError` into the supplied `clerkOrphanReason` so
 * the failure module writes an orphan with `clerk_create_failed_buyer` /
 * `clerk_create_failed_beneficiary` per §7.8.11 E12.
 */
async function resolveIdentityBlock(
	db: PrismaClient,
	block: CheckoutIdentityBlock,
	clubShortName: string,
	clerkOrphanReason: string,
): Promise<{ userId: string }> {
	const email = normalizeEmail(block.email);
	const firstName = block.firstName.trim();
	const lastName = block.lastName.trim();
	let clerkUserId: string;
	try {
		const result = await findOrCreateClerkUserId({
			email,
			firstName,
			lastName,
		});
		clerkUserId = result.clerkUserId;
	} catch (err) {
		// Re-throw as WebhookFailure so failure.ts writes the per-identity
		// reason. `ClerkPersistentError` (multi-Clerk-user collision) is the
		// only failure we refine here; other Clerk errors keep their TRPCError
		// surface and bubble up to the generic dispatch_failed catch-all.
		if (err instanceof ClerkPersistentError) {
			throw new WebhookFailure(clerkOrphanReason, {
				originalMessage: err.message,
			});
		}
		throw err;
	}
	const { userId } = await db.$transaction(async (tx) =>
		findOrCreateLocalUserAccount({
			db: tx,
			clerkUserId,
			email,
			firstName,
			lastName,
			clubShortName,
			role: "STUDENT",
		}),
	);
	return { userId };
}

/**
 * §7.8 — two-identity resolution path. Returns:
 *  - `consumerUserId` (beneficiary's userId)
 *  - `billedToUserId` (payer's userId, or null when self-pay dedup collapsed)
 *  - `familyGroupOutcome` (from `linkFamilyGroup`, or 'no_op_self_pay' on collapse)
 *
 * Same-email dedup (§7.8.5): if normalized beneficiary email === normalized
 * payer email, treat as one person. Single Clerk + User row. No family
 * group. `billedToUserId` left null (self-pay convention, HANDOFF #110).
 */
async function resolveTwoIdentityIntent(
	db: PrismaClient,
	intent: CheckoutIntent,
	clubShortName: string,
): Promise<{
	consumerUserId: string;
	billedToUserId: string | null;
	familyGroupOutcome: FamilyGroupLinkOutcome;
}> {
	if (!intent.beneficiary || !intent.payer) {
		// Caller checked this before invoking; defensive.
		throw new Error(
			"resolveTwoIdentityIntent invoked without both identity blocks",
		);
	}

	const beneficiaryEmail = normalizeEmail(intent.beneficiary.email);
	const payerEmail = normalizeEmail(intent.payer.email);

	// §7.8.5 — same-email dedup. Collapse to a single identity.
	if (beneficiaryEmail === payerEmail) {
		const { userId } = await resolveIdentityBlock(
			db,
			intent.beneficiary,
			clubShortName,
			// Single-identity Clerk failure inherits the beneficiary-side
			// reason; this branch already implies the two blocks collapsed.
			"clerk_create_failed_beneficiary",
		);
		return {
			consumerUserId: userId,
			billedToUserId: null,
			familyGroupOutcome: "no_op_self_pay",
		};
	}

	// Distinct identities — resolve beneficiary first (its Clerk failure is
	// the more user-visible side; orphan reason names it explicitly per E12).
	const beneficiary = await resolveIdentityBlock(
		db,
		intent.beneficiary,
		clubShortName,
		"clerk_create_failed_beneficiary",
	);
	const payer = await resolveIdentityBlock(
		db,
		intent.payer,
		clubShortName,
		"clerk_create_failed_buyer",
	);

	// §7.8.6 — auto-link in its own short tx so the advisory lock is held
	// for the minimum window. `linkFamilyGroup` is idempotent under retry.
	const familyGroupOutcome = await db.$transaction(async (tx) =>
		linkFamilyGroup(tx, {
			userIdA: beneficiary.userId,
			userIdB: payer.userId,
			clubShortName,
		}),
	);

	return {
		consumerUserId: beneficiary.userId,
		billedToUserId: payer.userId,
		familyGroupOutcome,
	};
}

/**
 * Persist the resolved family-group outcome onto `CheckoutSession.intent`
 * JSON so the confirmation page (§7.8.7) can render the right branch via
 * `payments.getCheckoutSessionStatus`. Stored in JSON rather than a new
 * column to avoid a migration (per Round 2.7 spec preference).
 */
async function stampFamilyGroupOutcome(
	db: PrismaClient,
	checkoutSessionId: string,
	outcome: FamilyGroupLinkOutcome,
): Promise<void> {
	const row = await db.checkoutSession.findUnique({
		where: { id: checkoutSessionId },
		select: { intent: true },
	});
	if (!row) return;
	const intent = asCheckoutIntent(row.intent);
	const next: CheckoutIntent = { ...intent, familyGroupOutcome: outcome };
	await db.checkoutSession.update({
		where: { id: checkoutSessionId },
		data: { intent: next as unknown as Prisma.InputJsonValue },
	});
}

/**
 * Resolve a system-staff user to record as `receivedBy` / `soldBy` on the
 * downstream rows. The audit row uses `actorUserId: null + source: webhook`,
 * but the `*ByUserId` FK columns need a real value. Uses any admin/owner of
 * the club, ordered by userId for determinism.
 */
async function resolveSystemStaffUserId(
	db: PrismaClient,
	clubShortName: string,
): Promise<string> {
	const row = await db.user.findFirst({
		where: {
			clubShortName,
			userType: { in: ["CLUB_ADMIN", "PLATFORM_ADMIN"] },
		},
		orderBy: { userId: "asc" },
		select: { userId: true },
	});
	if (!row) {
		throw new WebhookFailure("unknown_club", {
			message: `No admin/owner user found for club ${clubShortName}`,
		});
	}
	return row.userId;
}

// ============================================================
// dispatchParsedEvent — top-level switch
// ============================================================

export async function dispatchParsedEvent(
	db: PrismaClient,
	parsed: ParsedProviderEvent,
	event: ProviderEvent,
): Promise<void> {
	switch (parsed.kind) {
		case "checkout.completed":
			return dispatchCheckoutCompleted(db, parsed, event);
		case "refund.created":
			return dispatchRefundCreated(db, parsed, event);
		case "account.updated":
			return dispatchAccountUpdated(db, parsed, event);
		case "payment_intent.failed":
			return dispatchPaymentIntentFailed(db, parsed);
		case "unhandled":
			return;
	}
}

// ============================================================
// checkout.session.completed
// ============================================================

async function dispatchCheckoutCompleted(
	db: PrismaClient,
	parsed: Extract<ParsedProviderEvent, { kind: "checkout.completed" }>,
	_event: ProviderEvent,
): Promise<void> {
	const checkoutSessionId = parsed.metadata.checkoutSessionId;
	if (!checkoutSessionId) {
		throw new WebhookFailure("unknown_metadata", {
			message: "checkout.completed missing metadata.checkoutSessionId",
		});
	}

	const sessionRow = await db.checkoutSession.findUnique({
		where: { id: checkoutSessionId },
	});
	if (!sessionRow) {
		throw new WebhookFailure("unknown_metadata");
	}

	const intent = asCheckoutIntent(sessionRow.intent);
	const clubShortName = sessionRow.clubShortName;

	// §7.7 Gap #2 — defensive email guard. Guest flows REQUIRE an email;
	// invoice pay-now flows are logged-in members and don't need one.
	// §7.8 two-identity flows carry emails inside `intent.beneficiary` /
	// `intent.payer` (pre-Stripe form output), so Stripe's customer_details
	// email may legitimately be absent — skip the guard if either block
	// supplies an email.
	const hasIntentEmail = Boolean(
		intent.beneficiary?.email || intent.payer?.email,
	);
	if (
		!parsed.email &&
		!hasIntentEmail &&
		intent.itemKind !== "invoice" &&
		!intent.consumerUserId
	) {
		throw new WebhookFailure("no_email");
	}

	// Resolve identities. Three paths:
	//   (A) Two-identity intent (§7.8) — parent-for-kid flow from the new
	//       pre-Stripe form. `intent.beneficiary` + `intent.payer` are both
	//       present; we resolve both, link a family group, stamp the
	//       outcome on the CheckoutSession row.
	//   (B) Legacy single-identity intent — `intent.consumerUserId` set by
	//       a logged-in shopper. Use it as-is; payer = the existing
	//       intent.metadata.billToUserId (Phase 9a bill-to convention).
	//   (C) Legacy guest single-identity — neither set; fall back to the
	//       Stripe-side `customer_details` email/name (existing §8.5 flow).
	let consumerUserId: string | undefined = intent.consumerUserId;
	// `billedToUserId` is null in paths B/C unless the existing intent
	// metadata carried a `billToUserId` (staff-selected bill-to in Round 2).
	let billedToUserId: string | null = intent.metadata.billToUserId ?? null;

	if (intent.beneficiary && intent.payer) {
		// Path A — two-identity. Per decision #24 (Option A), the Clerk
		// HTTP call happens OUTSIDE any DB transaction; `resolveIdentityBlock`
		// follows that pattern.
		const resolved = await resolveTwoIdentityIntent(db, intent, clubShortName);
		consumerUserId = resolved.consumerUserId;
		billedToUserId = resolved.billedToUserId;
		// Stamp the outcome ASAP so the confirmation page (§7.8.7) can read
		// it via `getCheckoutSessionStatus` even if the downstream dispatch
		// throws — the OrphanedPurchase + Stripe charge are independent of
		// the family-group bookkeeping.
		await stampFamilyGroupOutcome(
			db,
			sessionRow.id,
			resolved.familyGroupOutcome,
		);
	} else if (!consumerUserId) {
		// Path C — legacy guest single-identity.
		const email = parsed.email;
		if (!email) {
			throw new WebhookFailure("no_email");
		}
		const { firstName, lastName } = splitGuestName(parsed.customerName, email);
		// `findOrCreateClerkUserId` throws `ClerkPersistentError` on the
		// length>1 multi-Clerk-user case; we catch it below and refine to
		// `WebhookFailure('clerk_create_failed')` so failure.ts writes
		// OrphanedPurchase with that reason.
		let clerkUserId: string;
		try {
			const r = await findOrCreateClerkUserId({
				email: normalizeEmail(email),
				firstName,
				lastName,
			});
			clerkUserId = r.clerkUserId;
		} catch (err) {
			if (err instanceof ClerkPersistentError) {
				throw new WebhookFailure("clerk_create_failed", {
					originalMessage: err.message,
				});
			}
			throw err;
		}
		const { userId } = await db.$transaction(async (tx) =>
			findOrCreateLocalUserAccount({
				db: tx,
				clerkUserId,
				email: normalizeEmail(email),
				firstName,
				lastName,
				clubShortName,
				role: "STUDENT",
			}),
		);
		consumerUserId = userId;
	}

	// Best-effort ProcessorCustomerLink. Race-safe via composite unique.
	//
	// 12b prep: storing the Stripe Customer ID so Phase 12b's saved-card flow
	// can charge an off-session PaymentIntent without re-entering card details
	// and without a backfill. NOT read anywhere in 12a — no 12a code path
	// looks up `ProcessorCustomerLink`. Cost is ~5 lines here; the forward-
	// migrate is "look up the link + charge".
	if (parsed.providerCustomerId) {
		await db.processorCustomerLink.createMany({
			data: [
				{
					userId: consumerUserId,
					processor: "stripe",
					providerAccountId: sessionRow.providerAccountId,
					providerCustomerId: parsed.providerCustomerId,
				},
			],
			skipDuplicates: true,
		});
	}

	const systemStaffUserId = await resolveSystemStaffUserId(db, clubShortName);

	// Dispatch by itemKind. Each branch opens its own audited tx via the
	// shared internal helpers (Choice B).
	switch (intent.itemKind) {
		case "package": {
			const { memberPackage, invoice: pkgInvoice } = await sellPackageInternal({
				db,
				clubShortName,
				actorUserId: null,
				source: AUDIT_SOURCES.WEBHOOK,
				soldByUserId: systemStaffUserId,
				input: {
					userId: consumerUserId,
					packagePlanId: intent.itemId,
					// §7.8: billedToUserId from the two-identity flow overrides
					// the legacy intent.metadata.billToUserId field. `null` is
					// the self-pay convention (HANDOFF #110).
					billToUserId: billedToUserId ?? undefined,
				},
			});
			// Precise row-targeted stamp (Round 2 fix): the prior `updateMany` on
			// `(invoiceId, stripeCheckoutSessionId: null)` could match >1 row
			// when an invoice already carried a prior package line. Use the
			// freshly-minted MemberPackage's PK so the stamp is exact-one.
			await db.memberPackage.updateMany({
				where: {
					memberPackageId: memberPackage.memberPackageId,
					stripeCheckoutSessionId: null,
				},
				data: {
					stripeCheckoutSessionId: parsed.sessionId,
					stripePaymentIntentId: parsed.paymentIntentId,
				},
			});
			await recordPaymentForInvoice(db, {
				invoiceId: pkgInvoice.invoiceId,
				clubShortName,
				systemStaffUserId,
				parsed,
			});
			await markCheckoutSessionCompleted(db, sessionRow.id);
			return;
		}

		case "membership": {
			const { membership, invoice: memInvoice } = await sellMembershipInternal({
				db,
				clubShortName,
				actorUserId: null,
				source: AUDIT_SOURCES.WEBHOOK,
				soldByUserId: systemStaffUserId,
				input: {
					userId: consumerUserId,
					membershipPlanId: intent.itemId,
					startDate: new Date().toISOString().slice(0, 10),
					// §7.8: billedToUserId from the two-identity flow overrides
					// the legacy intent.metadata.billToUserId field.
					billToUserId: billedToUserId ?? undefined,
				},
			});
			// Precise row-targeted stamp (Round 2 fix): the prior `updateMany`
			// on (userId, clubShortName, membershipPlanId, stripeCheckoutSessionId:
			// null) could match historical un-stamped memberships for the same
			// user+plan. Use the freshly-minted MemberMembership's PK.
			await db.memberMembership.updateMany({
				where: {
					memberMembershipId: membership.memberMembershipId,
					stripeCheckoutSessionId: null,
				},
				data: {
					stripeCheckoutSessionId: parsed.sessionId,
					stripePaymentIntentId: parsed.paymentIntentId,
				},
			});
			await recordPaymentForInvoice(db, {
				invoiceId: memInvoice.invoiceId,
				clubShortName,
				systemStaffUserId,
				parsed,
			});
			await markCheckoutSessionCompleted(db, sessionRow.id);
			return;
		}

		case "event": {
			// Registration + capacity check in its own short tx. Capture the
			// registration + event so we can attach the invoice + payment in
			// a follow-up transaction (Choice B — each helper opens its own
			// audited tx; this dispatcher orchestrates them).
			let registrationId: string;
			let eventProductId: string | null;
			let eventTitle: string;
			let eventRevenueCategoryId: string | null;
			let eventFacilityId: string | null;
			try {
				const out = await db.$transaction(async (tx) => {
					const ev = await assertRegistrable({
						db: tx,
						eventId: intent.itemId,
						userId: consumerUserId,
						selfServe: false,
					});
					const reg = await createRegistrationTx({
						tx,
						event: ev,
						userId: consumerUserId,
						source: "system",
						changedByUserId: systemStaffUserId,
					});
					// Pull product.revenueCategoryId for the line-item snapshot
					// (mirrors sellPackageInternal's plan.product include).
					let revenueCategoryId: string | null = null;
					if (ev.productId) {
						const product = await tx.product.findUnique({
							where: { productId: ev.productId },
							select: { revenueCategoryId: true },
						});
						revenueCategoryId = product?.revenueCategoryId ?? null;
					}
					return {
						registrationId: reg.registrationId,
						productId: ev.productId,
						title: ev.title,
						revenueCategoryId,
						facilityId: ev.facilityId,
					};
				});
				registrationId = out.registrationId;
				eventProductId = out.productId;
				eventTitle = out.title;
				eventRevenueCategoryId = out.revenueCategoryId;
				eventFacilityId = out.facilityId;
			} catch (err) {
				if (
					err instanceof TRPCError &&
					err.code === "BAD_REQUEST" &&
					/fully booked/i.test(err.message)
				) {
					throw new WebhookFailure("capacity_race", {
						sessionId: parsed.sessionId,
						paymentIntentId: parsed.paymentIntentId,
					});
				}
				throw err;
			}

			// Stamp Stripe traceability on the registration row (matches the
			// rental branch + the `@unique stripeCheckoutSessionId` on the
			// EventRegistration model for row-level idempotency).
			await db.eventRegistration.updateMany({
				where: {
					registrationId,
					stripeCheckoutSessionId: null,
				},
				data: {
					stripeCheckoutSessionId: parsed.sessionId,
					stripePaymentIntentId: parsed.paymentIntentId,
				},
			});

			// Open the invoice tab + append the EVENT_REGISTRATION line in
			// the same audited tx (mirrors sellPackageInternal's body).
			// Guest paid events default to self-pay (no bill-to FK on the
			// CheckoutSession intent), so consumer === effective payer.
			// Follow-up: extract a shared getOrCreateOpenInvoice + line-
			// append helper — this body duplicates the recompute/auto-
			// close shape from sellPackageInternal and billing.ts.
			const amountInCents = parsed.amountInCents;
			// kind ↔ FK guardrail (HANDOFF #119) — also asserted inside the
			// helper, but pinning the literal `kind: "EVENT_REGISTRATION"`
			// at the call site keeps a clear grep-able producer marker for
			// this branch (mirrors sellPackageInternal's PACKAGE_SALE site).
			assertLineItemKindConsistency({
				kind: "EVENT_REGISTRATION",
				eventRegistrationId: registrationId,
			});
			// §7.8: when a payer block resolved a distinct billedToUserId,
			// the invoice is opened on the PAYER's tab (HANDOFF #110 — credit
			// follows the payer). Without a distinct payer we fall back to
			// self-pay (consumer pays their own tab).
			const eventInvoice = await attachItemKindInvoice(db, {
				clubShortName,
				consumerUserId,
				effectivePayerUserId: billedToUserId ?? consumerUserId,
				facilityId: eventFacilityId,
				createdByUserId: systemStaffUserId,
				lineKind: "EVENT_REGISTRATION",
				productId: eventProductId,
				eventRegistrationId: registrationId,
				revenueCategoryId: eventRevenueCategoryId,
				description: eventTitle,
				amountInCents,
			});
			await recordPaymentForInvoice(db, {
				invoiceId: eventInvoice.invoiceId,
				clubShortName,
				systemStaffUserId,
				parsed,
			});
			await markCheckoutSessionCompleted(db, sessionRow.id);
			return;
		}

		case "rental": {
			const booking = await db.rentalBooking.findUnique({
				where: { bookingId: intent.itemId },
				select: {
					bookingId: true,
					status: true,
					clubShortName: true,
					userId: true,
					facilityId: true,
					productId: true,
					startTime: true,
					endTime: true,
					resource: { select: { title: true } },
					product: { select: { revenueCategoryId: true } },
				},
			});
			if (!booking || booking.status !== "CONFIRMED") {
				throw new WebhookFailure("unknown_metadata");
			}
			if (booking.clubShortName !== clubShortName) {
				throw new WebhookFailure("unknown_club");
			}
			// Defense-in-depth (Round 2.5 Important #8): the held booking's
			// userId MUST match the checkout intent's consumerUserId. The
			// `startCheckout.rental` mutation already enforces this for the
			// initial call, but a tampered cs_ id or a re-replayed webhook
			// against a different held booking would slip past without this.
			if (booking.userId !== consumerUserId) {
				throw new WebhookFailure("rental_userid_mismatch", {
					message: `rental booking userId (${booking.userId}) does not match checkout intent consumerUserId (${consumerUserId})`,
				});
			}
			await db.rentalBooking.update({
				where: { bookingId: booking.bookingId },
				data: {
					stripeCheckoutSessionId: parsed.sessionId,
					stripePaymentIntentId: parsed.paymentIntentId,
				},
			});

			// Public-shop rentals are paid by the booking owner (consumer ===
			// effective payer). Build a court-and-time description; fall back
			// to the bare court name when product is null (rentals don't
			// require a Product per schema — `productId` is nullable).
			const courtName = booking.resource?.title ?? "Court rental";
			const startIso = booking.startTime.toISOString();
			const endIso = booking.endTime.toISOString();
			const description = `Court rental — ${courtName} ${startIso} → ${endIso}`;
			const amountInCents = parsed.amountInCents;
			// Follow-up: extract a shared getOrCreateOpenInvoice + line-
			// append helper — see same note in the event branch above.
			assertLineItemKindConsistency({
				kind: "RENTAL",
				productId: booking.productId,
			});
			// §7.8: payer-vs-beneficiary override (see event branch above).
			const rentalInvoice = await attachItemKindInvoice(db, {
				clubShortName,
				consumerUserId,
				effectivePayerUserId: billedToUserId ?? consumerUserId,
				facilityId: booking.facilityId,
				createdByUserId: systemStaffUserId,
				lineKind: "RENTAL",
				productId: booking.productId,
				eventRegistrationId: null,
				revenueCategoryId: booking.product?.revenueCategoryId ?? null,
				description,
				amountInCents,
			});
			await recordPaymentForInvoice(db, {
				invoiceId: rentalInvoice.invoiceId,
				clubShortName,
				systemStaffUserId,
				parsed,
			});
			await markCheckoutSessionCompleted(db, sessionRow.id);
			return;
		}

		case "invoice": {
			const invoice = await db.invoice.findUnique({
				where: { invoiceId: intent.itemId },
				select: {
					invoiceId: true,
					userId: true,
					billedToUserId: true,
					clubShortName: true,
				},
			});
			if (!invoice) {
				throw new WebhookFailure("unknown_metadata");
			}
			if (invoice.clubShortName !== clubShortName) {
				throw new WebhookFailure("unknown_club");
			}
			await recordPaymentInternal({
				db,
				clubShortName,
				actorUserId: null,
				source: AUDIT_SOURCES.WEBHOOK,
				invoice: {
					invoiceId: invoice.invoiceId,
					userId: invoice.userId,
					billedToUserId: invoice.billedToUserId,
				},
				receivedByUserId: systemStaffUserId,
				input: {
					invoiceId: invoice.invoiceId,
					amountInCents: parsed.amountInCents,
					paymentMethod: "credit_card",
					processor: "stripe",
					processorTransactionId: parsed.sessionId,
					processorChargeId: parsed.chargeId ?? undefined,
					processorFeeInCents: parsed.feeInCents ?? undefined,
				},
			});
			await db.invoice.updateMany({
				where: {
					invoiceId: invoice.invoiceId,
					stripeCheckoutSessionId: null,
				},
				data: { stripeCheckoutSessionId: parsed.sessionId },
			});
			await markCheckoutSessionCompleted(db, sessionRow.id);
			return;
		}
	}
}

/**
 * Mark the local CheckoutSession 'completed' AFTER successful dispatch (§9.3.1
 * Round 2.5 Important #9). If dispatch throws partway through, the status
 * stays 'open' and `failure.ts` can transition it to 'failed' once orphan
 * triage owns the recovery. Prior version stamped 'completed' BEFORE
 * dispatch — a mid-dispatch crash would leave the row claiming success.
 */
async function markCheckoutSessionCompleted(
	db: PrismaClient,
	checkoutSessionId: string,
): Promise<void> {
	await db.checkoutSession.update({
		where: { id: checkoutSessionId },
		data: { status: "completed" },
	});
}

/**
 * Helper: open the (consumer, payer) running tab + append a single charge
 * line ("event" or "rental") in one audited tx, mirroring
 * `sellPackageInternal`'s body. The webhook then calls
 * `recordPaymentForInvoice` to attach the InvoicePayment + auto-close. We
 * keep this local (vs. extracting alongside sellPackage) because each
 * itemKind has a slightly different provenance-FK + description shape;
 * the duplication is the recompute formula + advisory-lock pattern.
 *
 * Follow-up (post-12a): if Stream 6 / CR-b ends up needing this same shape
 * from the staff "register paid event" path or the rental finalize path,
 * lift this into `src/server/utils/` alongside `sellPackageInternal`.
 */
async function attachItemKindInvoice(
	db: PrismaClient,
	args: {
		clubShortName: string;
		consumerUserId: string;
		effectivePayerUserId: string;
		facilityId: string | null;
		createdByUserId: string;
		lineKind: "EVENT_REGISTRATION" | "RENTAL";
		productId: string | null;
		eventRegistrationId: string | null;
		revenueCategoryId: string | null;
		description: string;
		amountInCents: number;
	},
): Promise<{ invoiceId: string }> {
	return await db.$transaction(async (tx) => {
		const lockKey = `invoice-payer-${args.effectivePayerUserId}-${args.clubShortName}`;
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

		const { invoice, totalCreditPulledCents, creditLineCount } =
			await getOrCreateOpenInvoice(tx, {
				clubShortName: args.clubShortName,
				consumerUserId: args.consumerUserId,
				effectivePayerUserId: args.effectivePayerUserId,
				facilityId: args.facilityId,
				createdByUserId: args.createdByUserId,
			});

		// Existing-line offset: a reused tab may already have package /
		// adhoc charge lines on it. Append after them (and after any credit
		// lines on a fresh invoice — `creditLineCount` covers that case).
		const lastLine = await tx.invoiceLineItem.findFirst({
			where: { invoiceId: invoice.invoiceId },
			orderBy: { sortOrder: "desc" },
			select: { sortOrder: true },
		});
		const sortOrder = Math.max(
			creditLineCount,
			(lastLine?.sortOrder ?? -1) + 1,
		);

		const unitPriceInCents = args.amountInCents;
		const lineTotalInCents = args.amountInCents;

		assertLineItemKindConsistency({
			kind: args.lineKind,
			eventRegistrationId: args.eventRegistrationId,
			productId: args.productId,
		});
		await tx.invoiceLineItem.create({
			data: {
				invoiceId: invoice.invoiceId,
				kind: args.lineKind,
				productId: args.productId,
				eventRegistrationId: args.eventRegistrationId,
				revenueCategoryId: args.revenueCategoryId,
				description: args.description.slice(0, 500),
				quantity: 1,
				unitPriceInCents,
				discountInCents: 0,
				taxRateBps: 0,
				taxAmountInCents: 0,
				totalInCents: lineTotalInCents,
				sortOrder,
			},
		});

		// Recompute mirrors sellPackageInternal (Round 4 — check >= total
		// FIRST so credit-overrun negative-balance invoices still auto-close).
		const subtotalDelta = unitPriceInCents - totalCreditPulledCents;
		const totalDelta = lineTotalInCents - totalCreditPulledCents;
		const newSubtotal = invoice.subtotalInCents + subtotalDelta;
		const newTotal = invoice.totalInCents + totalDelta;
		const amountPaid = invoice.amountPaidInCents;
		let newStatus: string;
		if (amountPaid >= newTotal) {
			newStatus = "paid";
		} else if (amountPaid <= 0) {
			newStatus = "open";
		} else {
			newStatus = "partially_paid";
		}
		const shouldAutoClose = newStatus === "paid";

		await tx.invoice.update({
			where: { invoiceId: invoice.invoiceId },
			data: {
				subtotalInCents: newSubtotal,
				totalInCents: newTotal,
				status: newStatus,
				...(shouldAutoClose
					? { closedAt: new Date(), closedBy: args.createdByUserId }
					: {}),
			},
		});

		return { invoiceId: invoice.invoiceId };
	});
}

/**
 * Helper: record the credit_card payment for a freshly-minted invoice from
 * sellPackageInternal / sellMembershipInternal.
 */
async function recordPaymentForInvoice(
	db: PrismaClient,
	args: {
		invoiceId: string;
		clubShortName: string;
		systemStaffUserId: string;
		parsed: Extract<ParsedProviderEvent, { kind: "checkout.completed" }>;
	},
): Promise<void> {
	const invoice = await db.invoice.findUnique({
		where: { invoiceId: args.invoiceId },
		select: {
			invoiceId: true,
			userId: true,
			billedToUserId: true,
		},
	});
	if (!invoice) {
		throw new WebhookFailure("unknown_metadata", {
			message: "invoice vanished between sell and pay",
		});
	}
	await recordPaymentInternal({
		db,
		clubShortName: args.clubShortName,
		actorUserId: null,
		source: AUDIT_SOURCES.WEBHOOK,
		invoice: {
			invoiceId: invoice.invoiceId,
			userId: invoice.userId,
			billedToUserId: invoice.billedToUserId,
		},
		receivedByUserId: args.systemStaffUserId,
		input: {
			invoiceId: invoice.invoiceId,
			amountInCents: args.parsed.amountInCents,
			paymentMethod: "credit_card",
			processor: "stripe",
			processorTransactionId: args.parsed.sessionId,
			processorChargeId: args.parsed.chargeId ?? undefined,
			processorFeeInCents: args.parsed.feeInCents ?? undefined,
		},
	});
}

// ============================================================
// charge.refunded — Path B sync (§9.2)
// ============================================================

async function dispatchRefundCreated(
	db: PrismaClient,
	parsed: Extract<ParsedProviderEvent, { kind: "refund.created" }>,
	_event: ProviderEvent,
): Promise<void> {
	if (!parsed.chargeId) {
		throw new WebhookFailure("unknown_metadata");
	}

	// Path A round-trip: if our UI already recorded this refund, no-op.
	const existingRefund = await db.invoiceRefund.findFirst({
		where: { processor: "stripe", processorRefundId: parsed.refundId },
		select: { refundId: true },
	});
	if (existingRefund) return;

	const payment = await db.invoicePayment.findFirst({
		where: { processor: "stripe", processorChargeId: parsed.chargeId },
		select: {
			paymentId: true,
			amountInCents: true,
			receivedBy: true,
			invoiceId: true,
			invoice: {
				select: {
					userId: true,
					billedToUserId: true,
					clubShortName: true,
					creditConsumedInCents: true,
					creditConsumedAt: true,
				},
			},
		},
	});
	if (!payment) {
		throw new WebhookFailure("unknown_metadata");
	}

	// D1 pre-check (§9.2 step 2): consumed credit blocks Path B; orphan
	// without writing the refund row. (recordRefundInternal also re-checks
	// under the lock — defense in depth.)
	if (
		payment.invoice.creditConsumedInCents > 0 ||
		payment.invoice.creditConsumedAt !== null
	) {
		throw new WebhookFailure("stripe_dashboard_refund_with_consumed_credit");
	}

	// §9.4: reuse the original payment's receivedBy as the refundedBy.
	const refundedByUserId =
		payment.receivedBy ??
		(await resolveSystemStaffUserId(db, payment.invoice.clubShortName));

	await recordRefundInternal({
		db,
		clubShortName: payment.invoice.clubShortName,
		actorUserId: null,
		source: AUDIT_SOURCES.WEBHOOK,
		payment: {
			paymentId: payment.paymentId,
			amountInCents: payment.amountInCents,
			processor: "stripe",
			invoiceId: payment.invoiceId,
			invoice: {
				userId: payment.invoice.userId,
				billedToUserId: payment.invoice.billedToUserId,
			},
		},
		refundedByUserId,
		input: {
			paymentId: payment.paymentId,
			amountInCents: parsed.amountInCents,
			reason: "Refunded via Stripe dashboard",
			processorRefundId: parsed.refundId,
			processorFeeInCents: parsed.feeInCents ?? undefined,
		},
	});
}

// ============================================================
// account.updated
// ============================================================

async function dispatchAccountUpdated(
	db: PrismaClient,
	parsed: Extract<ParsedProviderEvent, { kind: "account.updated" }>,
	_event: ProviderEvent,
): Promise<void> {
	// Look up first so we have clubShortName for the audited tx. Stripe
	// sometimes fires `account.updated` for accounts not linked to any
	// ShuttleMentor club — silently skip those.
	const row = await db.clubStripeAccount.findUnique({
		where: { stripeAccountId: parsed.providerAccountId },
		select: { clubShortName: true, id: true },
	});
	if (!row) return;

	// Round 2.5 Important #6: update + audit must commit atomically via
	// `writeAuditedMutation` (was previously two unrelated writes — a crash
	// between them would have produced an unaudited row mutation).
	await writeAuditedMutation(
		{
			db,
			actorUserId: null,
			clubShortName: row.clubShortName,
			source: AUDIT_SOURCES.WEBHOOK,
		},
		async (tx) => {
			const updated = await tx.clubStripeAccount.update({
				where: { stripeAccountId: parsed.providerAccountId },
				data: {
					chargesEnabled: parsed.chargesEnabled,
					payoutsEnabled: parsed.payoutsEnabled,
					detailsSubmitted: parsed.detailsSubmitted,
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
						chargesEnabled: parsed.chargesEnabled,
						payoutsEnabled: parsed.payoutsEnabled,
						detailsSubmitted: parsed.detailsSubmitted,
					},
				},
			};
		},
	);
}

// ============================================================
// payment_intent.payment_failed — best-effort
// ============================================================

async function dispatchPaymentIntentFailed(
	db: PrismaClient,
	parsed: Extract<ParsedProviderEvent, { kind: "payment_intent.failed" }>,
): Promise<void> {
	// Mark any matching CheckoutSession as voided. We don't have a direct
	// PI→CheckoutSession index, but the Embedded Checkout flow records the
	// session in `CheckoutSession.providerSessionId` and the PI lives on
	// the session row only after `checkout.session.completed`. For 12a we
	// treat this as a logging hook; no member-side action.
	void db;
	void parsed;
}
