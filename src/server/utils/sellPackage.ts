/**
 * Phase 12a — internal helper for the "sell a package" flow.
 *
 * Extracted from `packages.ts::sellPackage` (lines 439–688) so the future
 * Stripe webhook (Round 2) can mint MemberPackage rows + running-tab invoice
 * lines without duplicating the pre-validation + advisory-lock + line-append
 * + auto-close + audit-emission body.
 *
 * COMPOSITION (phase12 §23 decision #6 / §9.3.1 Choice B):
 *   - The internal helper OWNS its `writeAuditedMutation` transaction.
 *   - It performs the FULL pre-tx validation that the mutation used to do
 *     (member + plan + bill-to FK + cross-tenant + timezone-aware endDate
 *     calc) — Choice B in §9.3.1. The webhook can call this helper directly
 *     after committing its `ProcessedProcessorEvent` row in a short prior tx.
 *   - The tRPC mutation refactors to a thin wrapper that simply calls this
 *     helper with `actorUserId = ctx.user.userId`, `source = ADMIN_DASHBOARD`,
 *     `soldByUserId = ctx.user.userId`. Webhook calls it with
 *     `actorUserId = null`, `source = WEBHOOK`, `soldByUserId =` a system
 *     staff user resolved by the dispatcher.
 *
 * INVARIANTS preserved verbatim from the original mutation body:
 *   - `invoice-payer-${effectivePayer}-${club}` advisory lock as the FIRST
 *     statement inside the transaction (HANDOFF #113).
 *   - `getOrCreateOpenInvoice` round-trip — same Option-3 (consumer, payer)
 *     tab keying, same numbering, same credit-carry-forward gate
 *     (`AUTO_APPLY_CREDIT_ON_NEW_INVOICE = false`).
 *   - `assertLineItemKindConsistency` for kind ↔ FK guardrail
 *     (HANDOFF #119).
 *   - Recompute formula: `subtotalDelta = unitPrice - totalCreditPulled`,
 *     `totalDelta = lineTotal - totalCreditPulled`. Status ordering checks
 *     `amountPaid >= newTotal` FIRST (Round 4 credit-overrun fix).
 *   - Audit row via `buildPartyAuditEntries({ action: PACKAGE_SOLD, ... })`.
 *
 * See designFiles/roadmap/phase12-stripe-connect.md §9.3.1 (Choice B) +
 * designFiles/roadmap/phase12a-build-plan.md §2 Stream 1.
 */

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import dayjs from "~/lib/dayjs-config";
import {
	AUDIT_ACTIONS,
	type AuditSource,
	buildPartyAuditEntries,
	writeAuditedMutation,
} from "~/server/utils/auditedMutation";
import { assertLineItemKindConsistency } from "~/server/utils/invoiceLineItems";
import { getOrCreateOpenInvoice } from "~/server/utils/invoiceTab";

// ============================================================
// PRIVATE HELPERS (mirrored from packages.ts so the webhook path does not
// reach back into a tRPC router file. Identical behavior.)
// ============================================================

/**
 * Calculate endDate for a MemberPackage given a start date and duration.
 * Mirrors `packages.ts::calculateEndDate`. End-of-day in the supplied tz.
 */
function calculateEndDate(
	startDate: Date,
	durationValue: number | null,
	durationUnit: string | null,
	timezone: string | null,
): Date | null {
	if (durationValue === null || durationUnit === null) {
		return null;
	}
	const tz = timezone ?? "America/New_York";
	const start = dayjs(startDate).tz(tz);
	const unit = durationUnit as "days" | "weeks" | "months" | "years";
	const end = start.add(durationValue, unit).endOf("day");
	return end.toDate();
}

/**
 * Resolve the user's default facility timezone (active facility → first
 * UserClub.facility → null). Mirrors `packages.ts::getFacilityTimezoneForUser`.
 */
async function getFacilityTimezoneForUser(
	db: PrismaClient,
	userId: string,
): Promise<string | null> {
	const user = await db.user.findUnique({
		where: { userId },
		select: {
			activeFacility: { select: { timezone: true } },
			clubMemberships: {
				take: 1,
				include: { facility: { select: { timezone: true } } },
			},
		},
	});
	return (
		user?.activeFacility?.timezone ??
		user?.clubMemberships[0]?.facility.timezone ??
		null
	);
}

// ============================================================
// sellPackageInternal
// ============================================================

export interface SellPackageInternalInput {
	userId: string;
	packagePlanId: string;
	startDate?: Date; // defaults to now
	notes?: string;
	/** Optional bill-to override. null/undefined/`= userId` → self-pay. */
	billToUserId?: string;
}

export interface SellPackageInternalArgs {
	db: PrismaClient;
	clubShortName: string;
	/** null for webhook-initiated sales (set source: 'webhook'). */
	actorUserId: string | null;
	source: AuditSource;
	/**
	 * The staff user recorded as `soldBy` on the MemberPackage row + as the
	 * invoice `createdBy` / `closedBy` on auto-close. For mutation callers this
	 * is `ctx.user.userId`; for the webhook dispatcher this is a system staff
	 * user resolved by the dispatcher.
	 */
	soldByUserId: string;
	input: SellPackageInternalInput;
}

export async function sellPackageInternal(args: SellPackageInternalArgs) {
	const { db, clubShortName, actorUserId, source, soldByUserId, input } = args;

	// ----- Pre-validation (Choice B — runs OUTSIDE the audited tx) ---------
	// Verify the consumer is in this club.
	const member = await db.user.findFirst({
		where: { userId: input.userId, clubShortName },
		select: { userId: true, activeFacilityId: true },
	});
	if (!member) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Member not found in this club",
		});
	}

	// Validate bill-to user (only when present + different from the consumer).
	if (input.billToUserId && input.billToUserId !== input.userId) {
		const billTo = await db.user.findFirst({
			where: { userId: input.billToUserId, clubShortName },
			select: { userId: true },
		});
		if (!billTo) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Bill-to user not found in this club",
			});
		}
	}

	// Effective payer (collapses to userId for self-pay).
	const effectivePayerUserId =
		input.billToUserId && input.billToUserId !== input.userId
			? input.billToUserId
			: input.userId;

	// Verify the plan is active + in this club; pull the product's revenue
	// category to snapshot onto the package line.
	const plan = await db.packagePlan.findFirst({
		where: {
			packagePlanId: input.packagePlanId,
			clubShortName,
			isActive: true,
		},
		include: { product: { select: { revenueCategoryId: true } } },
	});
	if (!plan) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Package plan not found or inactive",
		});
	}

	// Calendar-end calc in the consumer's facility tz (#34).
	const startDate = input.startDate ?? new Date();
	const timezone = await getFacilityTimezoneForUser(db, input.userId);
	const endDate = calculateEndDate(
		startDate,
		plan.durationValue,
		plan.durationUnit,
		timezone,
	);

	// Snapshot the price at sale time onto the line item.
	const unitPriceInCents = plan.priceInCents;
	const lineTotalInCents = unitPriceInCents; // qty 1, no discount/tax in 9-EOD

	// ----- Audited transaction (the helper OWNS the wrapper) ---------------
	return await writeAuditedMutation(
		{
			db,
			actorUserId,
			clubShortName,
			source,
		},
		async (tx) => {
			// Advisory lock FIRST. Serializes concurrent sales / payments / closes
			// for this (effectivePayer, club) — HANDOFF #113.
			const lockKey = `invoice-payer-${effectivePayerUserId}-${clubShortName}`;
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

			// Find/create the (consumer, payer) running tab + carry credit if
			// the flag is on. Lock acquired above is the documented precondition.
			const { invoice, totalCreditPulledCents, creditLineCount } =
				await getOrCreateOpenInvoice(tx, {
					clubShortName,
					consumerUserId: input.userId,
					effectivePayerUserId,
					facilityId: member.activeFacilityId,
					createdByUserId: soldByUserId,
				});

			const memberPackage = await tx.memberPackage.create({
				data: {
					clubShortName,
					userId: input.userId,
					packagePlanId: input.packagePlanId,
					startDate,
					endDate,
					creditsTotal: plan.sessionCount,
					creditsUsed: 0,
					status: "active",
					soldBy: soldByUserId,
					notes: input.notes ?? null,
					invoiceId: invoice.invoiceId,
				},
			});

			// Append the PACKAGE_SALE line (kind ↔ FK guardrail, HANDOFF #119).
			assertLineItemKindConsistency({
				kind: "PACKAGE_SALE",
				packagePlanId: plan.packagePlanId,
			});
			await tx.invoiceLineItem.create({
				data: {
					invoiceId: invoice.invoiceId,
					kind: "PACKAGE_SALE",
					productId: plan.productId,
					packagePlanId: plan.packagePlanId,
					memberPackageId: memberPackage.memberPackageId,
					revenueCategoryId: plan.product?.revenueCategoryId ?? null,
					description: plan.name,
					quantity: 1,
					unitPriceInCents,
					discountInCents: 0,
					taxRateBps: 0,
					taxAmountInCents: 0,
					totalInCents: lineTotalInCents,
					sortOrder: creditLineCount,
				},
			});

			// Recompute + auto-close (Round 4 — check >= total FIRST so a credit-
			// overrun negative-balance invoice still lands on "paid"/auto-close).
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

			const updatedInvoice = await tx.invoice.update({
				where: { invoiceId: invoice.invoiceId },
				data: {
					subtotalInCents: newSubtotal,
					totalInCents: newTotal,
					status: newStatus,
					...(shouldAutoClose
						? { closedAt: new Date(), closedBy: soldByUserId }
						: {}),
				},
			});

			return {
				result: { memberPackage, invoice: updatedInvoice },
				audit: buildPartyAuditEntries({
					action: AUDIT_ACTIONS.PACKAGE_SOLD,
					consumerUserId: input.userId,
					payerUserId:
						input.billToUserId && input.billToUserId !== input.userId
							? input.billToUserId
							: null,
					entityType: "Invoice",
					entityId: updatedInvoice.invoiceId,
					metadata: {
						packagePlanId: input.packagePlanId,
						invoiceId: updatedInvoice.invoiceId,
						amountInCents: lineTotalInCents,
					},
				}),
			};
		},
	);
}
