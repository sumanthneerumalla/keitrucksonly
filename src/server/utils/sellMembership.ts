/**
 * Phase 12a — internal helper for the "sell a membership" flow.
 *
 * Extracted from `memberships.ts::sell` (lines 524–754) so the future Stripe
 * webhook (Round 2) can mint MemberMembership rows + running-tab MEMBERSHIP_FEE
 * lines without duplicating the pre-validation + advisory-lock + recompute
 * + audit-emission body. The shipped procedure stays named `memberships.sell`
 * (#129); the helper uses the `sellMembershipInternal` suffix to match
 * `sellPackageInternal`.
 *
 * COMPOSITION (phase12 §23 #6 / §9.3.1 Choice B):
 *   - The internal helper OWNS its `writeAuditedMutation` transaction.
 *   - It performs the FULL pre-tx validation (member + plan + bill-to FK +
 *     start-date parse + backdating check + computeMembershipTerm). The
 *     webhook calls this helper after committing its `ProcessedProcessorEvent`
 *     row in a short prior tx.
 *   - The tRPC mutation refactors to a thin wrapper.
 *
 * INVARIANTS preserved verbatim from the original mutation body:
 *   - Backdating rejection (start ≥ today calendar-day in member's tz).
 *   - `invoice-payer-${effectivePayer}-${club}` advisory lock as the FIRST
 *     statement inside the transaction (HANDOFF #113).
 *   - Self-pay vs bill-to running-tab keying matches sellPackage's Option-3.
 *   - `assertLineItemKindConsistency` for kind ↔ FK guardrail (#119).
 *   - Recompute formula + status ordering (>= total first, Round-4 fix).
 *   - Auto-renew left inert in 10a per scope.
 *   - Audit row via `buildPartyAuditEntries({ action: MEMBERSHIP_SOLD })`.
 *
 * See designFiles/roadmap/phase12-stripe-connect.md §9.3.1 (Choice B) +
 * designFiles/roadmap/phase12a-build-plan.md §2 Stream 1.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import dayjs from "~/lib/dayjs-config";
import {
	AUDIT_ACTIONS,
	type AuditSource,
	buildPartyAuditEntries,
	writeAuditedMutation,
} from "~/server/utils/auditedMutation";
import { assertLineItemKindConsistency } from "~/server/utils/invoiceLineItems";
import { computeMembershipTerm } from "~/server/utils/membershipTerm";

// ============================================================
// PRIVATE HELPERS (mirrored from memberships.ts so the webhook path does not
// reach back into a tRPC router file. Identical behavior.)
// ============================================================

async function getFacilityTimezoneForUser(
	db: PrismaClient | Prisma.TransactionClient,
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

/**
 * Parse yyyy-mm-dd into a Date anchored at the START of that calendar day in
 * the given tz. Same shape as `memberships.ts::parseStartDate`.
 */
function parseStartDate(startISO: string, timezone: string | null): Date {
	const tz = timezone ?? "America/New_York";
	return dayjs.tz(startISO, tz).startOf("day").toDate();
}

/** Today (calendar day) at 00:00 in the given tz — the backdating floor. */
function startOfTodayInTz(timezone: string | null): dayjs.Dayjs {
	const tz = timezone ?? "America/New_York";
	return dayjs().tz(tz).startOf("day");
}

// ============================================================
// sellMembershipInternal
// ============================================================

export interface SellMembershipInternalInput {
	userId: string;
	membershipPlanId: string;
	/** ISO date string (yyyy-mm-dd) — start of the calendar term. */
	startDate: string;
	notes?: string;
	billToUserId?: string;
	/**
	 * When true AND the plan has a nonzero `initiationFeeInCents`, a one-time
	 * "Registration fee" FEE line is appended alongside the MEMBERSHIP_FEE
	 * line (same revenue category as the membership). Staff sales default
	 * this from "member has no prior non-voided membership" (waivable in the
	 * modal); the Stripe webhook always passes true because online checkout
	 * charged `feePerTermInCents + initiationFeeInCents`.
	 */
	chargeInitiationFee?: boolean;
}

export interface SellMembershipInternalArgs {
	db: PrismaClient;
	clubShortName: string;
	actorUserId: string | null;
	source: AuditSource;
	/** Staff `soldBy` userId + invoice `createdBy` / `closedBy`. */
	soldByUserId: string;
	input: SellMembershipInternalInput;
}

export async function sellMembershipInternal(args: SellMembershipInternalArgs) {
	const { db, clubShortName, actorUserId, source, soldByUserId, input } = args;

	// ----- Pre-validation (Choice B — runs OUTSIDE the audited tx) ---------
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

	const effectivePayerUserId =
		input.billToUserId && input.billToUserId !== input.userId
			? input.billToUserId
			: input.userId;

	const plan = await db.membershipPlan.findFirst({
		where: {
			membershipPlanId: input.membershipPlanId,
			clubShortName,
			isActive: true,
		},
		include: {
			membershipType: { select: { revenueCategoryId: true, name: true } },
		},
	});
	if (!plan) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Membership plan not found or inactive",
		});
	}

	const timezone = await getFacilityTimezoneForUser(db, input.userId);
	const startDate = parseStartDate(input.startDate, timezone);
	const startDay = dayjs(startDate)
		.tz(timezone ?? "America/New_York")
		.startOf("day");
	if (startDay.isBefore(startOfTodayInTz(timezone))) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Start date can't be in the past",
		});
	}
	const { periodStart, periodEnd } = computeMembershipTerm(
		startDate,
		plan.billingUnit,
		plan.billingInterval,
		timezone,
	);

	// Snapshot the full-term fee at sale time.
	const unitPriceInCents = plan.feePerTermInCents;
	const lineTotalInCents = unitPriceInCents;
	// One-time registration fee — charged only when the caller opted in AND
	// the plan defines one. Snapshotted here like the term fee.
	const initiationFeeInCents = input.chargeInitiationFee
		? plan.initiationFeeInCents
		: 0;

	// ----- Audited transaction (the helper OWNS the wrapper) ---------------
	return await writeAuditedMutation(
		{
			db,
			actorUserId,
			clubShortName,
			source,
		},
		async (tx) => {
			// Advisory lock FIRST (mirrors sellPackage / HANDOFF #113).
			const lockKey = `invoice-payer-${effectivePayerUserId}-${clubShortName}`;
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

			// Find the (consumer, payer) running tab. Credit-carry-forward
			// disabled here too — matches sellPackage's AUTO_APPLY_CREDIT flag.
			const runningTabBilledToUserId =
				effectivePayerUserId === input.userId ? null : effectivePayerUserId;
			let invoice = await tx.invoice.findFirst({
				where: {
					clubShortName,
					userId: input.userId,
					billedToUserId: runningTabBilledToUserId,
					status: { in: ["draft", "open", "partially_paid"] },
					closedAt: null,
				},
				orderBy: { issueDate: "asc" },
			});

			if (!invoice) {
				const club = await tx.club.update({
					where: { clubShortName },
					data: { nextInvoiceNumber: { increment: 1 } },
					select: { nextInvoiceNumber: true },
				});
				const seq = club.nextInvoiceNumber - 1;
				const invoiceNumber = `INV-${String(seq).padStart(6, "0")}`;
				invoice = await tx.invoice.create({
					data: {
						clubShortName,
						invoiceNumber,
						userId: input.userId,
						billedToUserId:
							input.billToUserId && input.billToUserId !== input.userId
								? input.billToUserId
								: null,
						facilityId: member.activeFacilityId,
						status: "open",
						subtotalInCents: 0,
						taxTotalInCents: 0,
						totalInCents: 0,
						amountPaidInCents: 0,
						createdBy: soldByUserId,
					},
				});
			}

			const existingLineCount = await tx.invoiceLineItem.count({
				where: { invoiceId: invoice.invoiceId },
			});

			const membership = await tx.memberMembership.create({
				data: {
					clubShortName,
					userId: input.userId,
					membershipPlanId: plan.membershipPlanId,
					facilityId: member.activeFacilityId,
					status: "active",
					startDate: periodStart,
					endDate: periodEnd,
					soldBy: soldByUserId,
					notes: input.notes ?? null,
				},
			});

			assertLineItemKindConsistency({
				kind: "MEMBERSHIP_FEE",
				memberMembershipId: membership.memberMembershipId,
			});
			await tx.invoiceLineItem.create({
				data: {
					invoiceId: invoice.invoiceId,
					kind: "MEMBERSHIP_FEE",
					memberMembershipId: membership.memberMembershipId,
					revenueCategoryId: plan.membershipType?.revenueCategoryId ?? null,
					description: plan.description,
					quantity: 1,
					unitPriceInCents,
					discountInCents: 0,
					taxRateBps: 0,
					taxAmountInCents: 0,
					totalInCents: lineTotalInCents,
					sortOrder: existingLineCount,
					periodStart,
					periodEnd,
				},
			});

			// One-time registration fee line. Kind=FEE (not MEMBERSHIP_FEE — that
			// kind means "recurring term charge" and carries period dates), but it
			// keeps the membership FK for provenance. Registration fees report
			// under the same revenue category as the membership itself.
			if (initiationFeeInCents > 0) {
				assertLineItemKindConsistency({
					kind: "FEE",
					memberMembershipId: membership.memberMembershipId,
				});
				await tx.invoiceLineItem.create({
					data: {
						invoiceId: invoice.invoiceId,
						kind: "FEE",
						memberMembershipId: membership.memberMembershipId,
						revenueCategoryId: plan.membershipType?.revenueCategoryId ?? null,
						description: `Registration fee — ${
							plan.membershipType?.name ?? plan.description
						}`,
						quantity: 1,
						unitPriceInCents: initiationFeeInCents,
						discountInCents: 0,
						taxRateBps: 0,
						taxAmountInCents: 0,
						totalInCents: initiationFeeInCents,
						sortOrder: existingLineCount + 1,
					},
				});
			}

			const newSubtotal =
				invoice.subtotalInCents + unitPriceInCents + initiationFeeInCents;
			const newTotal =
				invoice.totalInCents + lineTotalInCents + initiationFeeInCents;
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
				result: { membership, invoice: updatedInvoice },
				audit: buildPartyAuditEntries({
					action: AUDIT_ACTIONS.MEMBERSHIP_SOLD,
					consumerUserId: input.userId,
					payerUserId:
						input.billToUserId && input.billToUserId !== input.userId
							? input.billToUserId
							: null,
					entityType: "MemberMembership",
					entityId: membership.memberMembershipId,
					metadata: {
						membershipPlanId: plan.membershipPlanId,
						invoiceId: updatedInvoice.invoiceId,
						amountInCents: lineTotalInCents + initiationFeeInCents,
						...(initiationFeeInCents > 0 ? { initiationFeeInCents } : {}),
					},
				}),
			};
		},
	);
}
