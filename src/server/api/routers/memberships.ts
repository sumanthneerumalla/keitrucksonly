import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import dayjs from "~/lib/dayjs-config";
import {
	clubAdminProcedure,
	createTRPCRouter,
	facilityProcedure,
} from "~/server/api/trpc";
import {
	AUDIT_ACTIONS,
	AUDIT_SOURCES,
	buildPartyAuditEntries,
	writeAuditedMutation,
} from "~/server/utils/auditedMutation";
import { assertLineItemKindConsistency } from "~/server/utils/invoiceLineItems";
import { computeMembershipTerm } from "~/server/utils/membershipTerm";

// ============================================================
// Phase 10a — Memberships router (WP3 + WP4 + WP5).
//
// Contract: this router is consumed by the (already-built) admin catalog pages
// (`MembershipTypesClient`, `MembershipPlansClient`, `MembershipPlanForm`,
// `MembershipPreferencesClient`) and the member-facing UI (`SellMembershipModal`,
// `MemberMembershipsCard`, `AdminCheckinClient`). Procedure names + input/output
// shapes match exactly what those call sites consume.
//
// Permissions (mirrors packages.ts + #50): catalog CRUD + preferences =
// `clubAdminProcedure`; sell, status changes, and read queries =
// `facilityProcedure` (FACILITY can view + sell, but not edit the catalog).
// ============================================================

// ============================================================
// MEMBERSHIP PREFERENCES (Club.membershipPreferences JSON bag)
// ============================================================

const BILLING_ANCHOR_MODES = ["signup", "calendar"] as const;
const CANCEL_REFUND_STRATEGIES = [
	"manual",
	"used_terms_at_base_rate",
	"prorate_dropin",
] as const;
const PRORATION_ROUNDINGS = ["nearest", "up", "down"] as const;

/**
 * Club-level membership settings (phase10-memberships.md "Membership
 * Preferences"). Stored as an app-validated JSON bag on `Club`. 10a only
 * implements `billingAnchorMode = "signup"` + `cancelRefundStrategy = "manual"`;
 * the remaining keys round-trip unchanged as inert future config.
 */
const membershipPreferencesSchema = z.object({
	requireRemarkForFreeze: z.boolean(),
	requireRemarkForSuspend: z.boolean(),
	requireRemarkForCancel: z.boolean(),
	autoGenerateMemberNumbers: z.boolean(),
	billingAnchorMode: z.enum(BILLING_ANCHOR_MODES),
	billingAnchorDay: z.number().int().min(1).max(28).nullable(),
	prorateFirstTerm: z.boolean(),
	cancelRefundStrategy: z.enum(CANCEL_REFUND_STRATEGIES),
	prorationRounding: z.enum(PRORATION_ROUNDINGS),
});

type MembershipPreferences = z.infer<typeof membershipPreferencesSchema>;

// Defaults mirror the client's DEFAULT_PREFERENCES so a club with no stored bag
// (or a partial one predating a field) reads back a fully-populated object.
const DEFAULT_PREFERENCES: MembershipPreferences = {
	requireRemarkForFreeze: true,
	requireRemarkForSuspend: true,
	requireRemarkForCancel: true,
	autoGenerateMemberNumbers: false,
	billingAnchorMode: "signup",
	billingAnchorDay: null,
	prorateFirstTerm: false,
	cancelRefundStrategy: "manual",
	prorationRounding: "nearest",
};

/**
 * Read + normalize the club's membership preferences. Tolerates a null bag or a
 * partial bag (a field added after the bag was first written) by layering the
 * stored JSON over the defaults, then validating. Invalid stored data falls back
 * to defaults rather than throwing — a bad bag shouldn't brick freeze/cancel.
 */
async function loadPreferences(
	db: PrismaClient | Prisma.TransactionClient,
	clubShortName: string,
): Promise<MembershipPreferences> {
	const club = await db.club.findUnique({
		where: { clubShortName },
		select: { membershipPreferences: true },
	});
	const stored =
		club?.membershipPreferences &&
		typeof club.membershipPreferences === "object" &&
		!Array.isArray(club.membershipPreferences)
			? (club.membershipPreferences as Record<string, unknown>)
			: {};
	const parsed = membershipPreferencesSchema.safeParse({
		...DEFAULT_PREFERENCES,
		...stored,
	});
	return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
}

// ============================================================
// TYPE CRUD SCHEMAS
// ============================================================

const listTypesSchema = z.object({
	isActive: z.boolean().optional(),
});

const createTypeSchema = z.object({
	name: z.string().min(1).max(200).trim(),
	revenueCategoryId: z.string().optional().nullable(),
});

const updateTypeSchema = z.object({
	membershipTypeId: z.string(),
	name: z.string().min(1).max(200).trim().optional(),
	revenueCategoryId: z.string().optional().nullable(),
});

const archiveTypeSchema = z.object({
	membershipTypeId: z.string(),
});

// ============================================================
// PLAN CRUD SCHEMAS
// ============================================================

const billingUnitSchema = z.enum(["day", "week", "month", "year"]);

const listPlansSchema = z.object({
	isActive: z.boolean().optional(),
});

// Shared shape for create/update plan. `billingCycles` is null = indefinite.
const planFieldsSchema = z.object({
	membershipTypeId: z.string(),
	description: z.string().min(1).max(500).trim(),
	billingFrequency: z.string().min(1).max(20),
	billingInterval: z.number().int().min(1).max(1000),
	billingUnit: billingUnitSchema,
	billingCycles: z.number().int().min(1).max(1000).nullable(),
	feePerTermInCents: z.number().int().min(0),
});

const createPlanSchema = planFieldsSchema;

const updatePlanSchema = planFieldsSchema.extend({
	membershipPlanId: z.string(),
	isActive: z.boolean().optional(),
});

const archivePlanSchema = z.object({
	membershipPlanId: z.string(),
});

// ============================================================
// SELL + STATUS SCHEMAS
// ============================================================

// `startDate` arrives as a yyyy-mm-dd string from SellMembershipModal; the
// server interprets it in the member's facility timezone.
const sellSchema = z.object({
	userId: z.string(),
	membershipPlanId: z.string(),
	startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd"),
	notes: z.string().max(2000).optional(),
	billToUserId: z.string().min(1).optional(),
});

const listForMemberSchema = z.object({
	userId: z.string(),
});

const memberMembershipIdSchema = z.object({
	memberMembershipId: z.string(),
});

const reasonActionSchema = z.object({
	memberMembershipId: z.string(),
	reason: z.string().max(2000).optional(),
});

const cancelSchema = z.object({
	memberMembershipId: z.string(),
	reason: z.string().max(2000).optional(),
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Member's facility timezone for calendar-term math (mirrors packages.ts
 * `getFacilityTimezoneForUser` / #49). Falls back to the active facility, then
 * any club-membership facility, then null (the term helper defaults sanely).
 */
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
 * Parse a yyyy-mm-dd input into a Date anchored at the START of that calendar day
 * in the given timezone. Start-of-day (not noon) so a membership sold with
 * `startDate = today` reads as Active immediately — `membershipStatus.ts` derives
 * "upcoming" only while `now < startDate`, and now is always ≥ the day's start.
 * The resulting Date is the term's anchor (periodStart); periodEnd stays
 * end-of-day via `computeMembershipTerm`.
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
// ROUTER
// ============================================================

export const membershipsRouter = createTRPCRouter({
	// ------------------------------------------------------------------
	// MembershipType CRUD
	// ------------------------------------------------------------------

	/**
	 * List membership types for the club. FACILITY may view (sell pickers); the
	 * page gates edit/archive behind isAnyAdmin client-side. Returns the revenue
	 * category (label) + a `_count.plans` for the admin table.
	 */
	listTypes: facilityProcedure
		.input(listTypesSchema)
		.query(async ({ ctx, input }) => {
			const types = await ctx.db.membershipType.findMany({
				where: {
					clubShortName: ctx.user.clubShortName,
					...(input.isActive !== undefined && { isActive: input.isActive }),
				},
				include: {
					revenueCategory: { select: { revenueCategoryId: true, label: true } },
					_count: { select: { plans: true } },
				},
				orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
			});
			return { types };
		}),

	/** Create a membership type (club admin). */
	createType: clubAdminProcedure
		.input(createTypeSchema)
		.mutation(async ({ ctx, input }) => {
			if (input.revenueCategoryId) {
				await assertRevenueCategoryInClub(
					ctx.db,
					input.revenueCategoryId,
					ctx.user.clubShortName,
				);
			}
			try {
				const type = await ctx.db.membershipType.create({
					data: {
						clubShortName: ctx.user.clubShortName,
						name: input.name,
						revenueCategoryId: input.revenueCategoryId ?? null,
					},
				});
				return { type };
			} catch (error) {
				throw mapDuplicateNameError(error);
			}
		}),

	/** Update a membership type (club admin). */
	updateType: clubAdminProcedure
		.input(updateTypeSchema)
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.membershipType.findFirst({
				where: {
					membershipTypeId: input.membershipTypeId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { membershipTypeId: true },
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Membership type not found",
				});
			}
			if (input.revenueCategoryId) {
				await assertRevenueCategoryInClub(
					ctx.db,
					input.revenueCategoryId,
					ctx.user.clubShortName,
				);
			}
			try {
				const type = await ctx.db.membershipType.update({
					where: { membershipTypeId: input.membershipTypeId },
					data: {
						...(input.name !== undefined && { name: input.name }),
						...(input.revenueCategoryId !== undefined && {
							revenueCategoryId: input.revenueCategoryId,
						}),
					},
				});
				return { type };
			} catch (error) {
				throw mapDuplicateNameError(error);
			}
		}),

	/** Archive a membership type (club admin) — soft disable (isActive=false). */
	archiveType: clubAdminProcedure
		.input(archiveTypeSchema)
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.membershipType.findFirst({
				where: {
					membershipTypeId: input.membershipTypeId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { membershipTypeId: true },
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Membership type not found",
				});
			}
			await ctx.db.membershipType.update({
				where: { membershipTypeId: input.membershipTypeId },
				data: { isActive: false },
			});
			return { success: true };
		}),

	// ------------------------------------------------------------------
	// MembershipPlan CRUD
	// ------------------------------------------------------------------

	/**
	 * List membership plans for the club. Returns the joined `membershipType`
	 * (name) + a `_count.memberMemberships` of ACTIVE sales for the admin table,
	 * and is also consumed by SellMembershipModal + MembershipPlanForm.
	 */
	listPlans: facilityProcedure
		.input(listPlansSchema)
		.query(async ({ ctx, input }) => {
			const plans = await ctx.db.membershipPlan.findMany({
				where: {
					clubShortName: ctx.user.clubShortName,
					...(input.isActive !== undefined && { isActive: input.isActive }),
				},
				include: {
					membershipType: {
						select: { membershipTypeId: true, name: true },
					},
					_count: {
						select: {
							memberMemberships: { where: { status: "active" } },
						},
					},
				},
				orderBy: [{ createdAt: "desc" }],
			});
			return { plans };
		}),

	/** Create a membership plan (club admin). */
	createPlan: clubAdminProcedure
		.input(createPlanSchema)
		.mutation(async ({ ctx, input }) => {
			await assertTypeInClub(
				ctx.db,
				input.membershipTypeId,
				ctx.user.clubShortName,
			);
			const plan = await ctx.db.membershipPlan.create({
				data: {
					clubShortName: ctx.user.clubShortName,
					membershipTypeId: input.membershipTypeId,
					description: input.description,
					billingFrequency: input.billingFrequency,
					billingInterval: input.billingInterval,
					billingUnit: input.billingUnit,
					billingCycles: input.billingCycles,
					feePerTermInCents: input.feePerTermInCents,
				},
			});
			return { plan };
		}),

	/** Update a membership plan (club admin). */
	updatePlan: clubAdminProcedure
		.input(updatePlanSchema)
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.membershipPlan.findFirst({
				where: {
					membershipPlanId: input.membershipPlanId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { membershipPlanId: true },
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Membership plan not found",
				});
			}
			await assertTypeInClub(
				ctx.db,
				input.membershipTypeId,
				ctx.user.clubShortName,
			);
			const plan = await ctx.db.membershipPlan.update({
				where: { membershipPlanId: input.membershipPlanId },
				data: {
					membershipTypeId: input.membershipTypeId,
					description: input.description,
					billingFrequency: input.billingFrequency,
					billingInterval: input.billingInterval,
					billingUnit: input.billingUnit,
					billingCycles: input.billingCycles,
					feePerTermInCents: input.feePerTermInCents,
					...(input.isActive !== undefined && { isActive: input.isActive }),
				},
			});
			return { plan };
		}),

	/** Archive a membership plan (club admin) — soft disable (isActive=false). */
	archivePlan: clubAdminProcedure
		.input(archivePlanSchema)
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.membershipPlan.findFirst({
				where: {
					membershipPlanId: input.membershipPlanId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { membershipPlanId: true },
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Membership plan not found",
				});
			}
			await ctx.db.membershipPlan.update({
				where: { membershipPlanId: input.membershipPlanId },
				data: { isActive: false },
			});
			return { success: true };
		}),

	// ------------------------------------------------------------------
	// Membership Preferences (Club JSON bag)
	// ------------------------------------------------------------------

	/** Read the club's membership preferences (defaults-filled). */
	getPreferences: clubAdminProcedure.query(async ({ ctx }) => {
		const preferences = await loadPreferences(ctx.db, ctx.user.clubShortName);
		return { preferences };
	}),

	/** Write the club's membership preferences (validated JSON bag). */
	updatePreferences: clubAdminProcedure
		.input(membershipPreferencesSchema)
		.mutation(async ({ ctx, input }) => {
			// 10a only implements signup-anchored billing; reject the inert future
			// "calendar" mode so a bad write can't silently change billing behavior.
			if (input.billingAnchorMode !== "signup") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only signup-anchored billing is supported in this release.",
				});
			}
			await ctx.db.club.update({
				where: { clubShortName: ctx.user.clubShortName },
				data: { membershipPreferences: input },
			});
			return { preferences: input };
		}),

	// ------------------------------------------------------------------
	// Sell a membership
	// ------------------------------------------------------------------

	/**
	 * Sell a membership — creates a `MemberMembership` (status "active",
	 * `endDate` from the calendar-term helper) and appends ONE full-term
	 * `MEMBERSHIP_FEE` line to the (beneficiary, payer) running-tab invoice.
	 *
	 * Reuses sellPackage's find-or-create + `pg_advisory_xact_lock` keyed
	 * `invoice-payer-${effectivePayer}-${club}`, wrapped in `writeAuditedMutation`
	 * with `buildPartyAuditEntries` / `AUDIT_ACTIONS.MEMBERSHIP_SOLD`. No
	 * proration — a full term is billed at sale even when the start is future
	 * (future start → derived "Upcoming"). Backdating disallowed (start ≥ today).
	 */
	sell: facilityProcedure.input(sellSchema).mutation(async ({ ctx, input }) => {
		// Verify the beneficiary is in this club.
		const member = await ctx.db.user.findFirst({
			where: { userId: input.userId, clubShortName: ctx.user.clubShortName },
			select: { userId: true, activeFacilityId: true },
		});
		if (!member) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Member not found in this club",
			});
		}

		// Validate bill-to (when provided + different from the consumer). Same
		// club; the userId === billToUserId case is accepted as self-pay.
		if (input.billToUserId && input.billToUserId !== input.userId) {
			const billTo = await ctx.db.user.findFirst({
				where: {
					userId: input.billToUserId,
					clubShortName: ctx.user.clubShortName,
				},
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

		// Verify the plan is active + in this club; pull the type's revenue
		// category to snapshot onto the fee line.
		const plan = await ctx.db.membershipPlan.findFirst({
			where: {
				membershipPlanId: input.membershipPlanId,
				clubShortName: ctx.user.clubShortName,
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

		// Compute the calendar term in the member's facility tz. Backdating is
		// disallowed (start ≥ today, decision 10a) — compare on calendar day.
		const timezone = await getFacilityTimezoneForUser(ctx.db, input.userId);
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
		const lineTotalInCents = unitPriceInCents; // qty 1, no discount/tax in 10a

		const result = await writeAuditedMutation(
			{
				db: ctx.db,
				actorUserId: ctx.user.userId,
				clubShortName: ctx.user.clubShortName,
				source: AUDIT_SOURCES.ADMIN_DASHBOARD,
			},
			async (tx) => {
				// Advisory lock FIRST (mirrors sellPackage). Serializes invoice
				// mutations for this (effectivePayer, club) so concurrent sales land
				// on the same running tab instead of each opening a fresh invoice.
				const lockKey = `invoice-payer-${effectivePayerUserId}-${ctx.user.clubShortName}`;
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

				// Find the running tab for THIS (consumer, payer) pair — self-pay =
				// billedToUserId null; bill-to = the payer. (Option-3, mirrors
				// sellPackage.) Credit carry-forward is OFF for new invoices here,
				// matching sellPackage's AUTO_APPLY_CREDIT_ON_NEW_INVOICE = false.
				const runningTabBilledToUserId =
					effectivePayerUserId === input.userId ? null : effectivePayerUserId;
				let invoice = await tx.invoice.findFirst({
					where: {
						clubShortName: ctx.user.clubShortName,
						userId: input.userId,
						billedToUserId: runningTabBilledToUserId,
						status: { in: ["draft", "open", "partially_paid"] },
						closedAt: null,
					},
					orderBy: { issueDate: "asc" },
				});

				if (!invoice) {
					const club = await tx.club.update({
						where: { clubShortName: ctx.user.clubShortName },
						data: { nextInvoiceNumber: { increment: 1 } },
						select: { nextInvoiceNumber: true },
					});
					const seq = club.nextInvoiceNumber - 1;
					const invoiceNumber = `INV-${String(seq).padStart(6, "0")}`;
					invoice = await tx.invoice.create({
						data: {
							clubShortName: ctx.user.clubShortName,
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
							createdBy: ctx.user.userId,
						},
					});
				}

				// Determine the next sort order on this invoice (append last).
				const existingLineCount = await tx.invoiceLineItem.count({
					where: { invoiceId: invoice.invoiceId },
				});

				const membership = await tx.memberMembership.create({
					data: {
						clubShortName: ctx.user.clubShortName,
						userId: input.userId,
						membershipPlanId: plan.membershipPlanId,
						facilityId: member.activeFacilityId,
						status: "active",
						startDate: periodStart,
						endDate: periodEnd,
						soldBy: ctx.user.userId,
						notes: input.notes ?? null,
					},
				});

				// Append the full-term MEMBERSHIP_FEE line, stamping the provenance
				// FK + the calendar period it covers. Guarded for kind consistency.
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

				// Recompute the invoice totals + status (a positive line can flip
				// open → partially_paid, or partially_paid → paid if already paid up).
				const newSubtotal = invoice.subtotalInCents + unitPriceInCents;
				const newTotal = invoice.totalInCents + lineTotalInCents;
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
							? { closedAt: new Date(), closedBy: ctx.user.userId }
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
							amountInCents: lineTotalInCents,
						},
					}),
				};
			},
		);

		return result;
	}),

	// ------------------------------------------------------------------
	// List a member's memberships (excludes voided)
	// ------------------------------------------------------------------

	/**
	 * List a member's memberships (newest first), EXCLUDING voided rows. Returns
	 * exactly the fields MemberMembershipsCard / AdminCheckinClient consume —
	 * status, dates, the paused/terminal reasons, and the joined plan + type.
	 * Effective status (upcoming/active/expired) is derived client-side in
	 * `membershipStatus.ts` (no cron, #27).
	 */
	listForMember: facilityProcedure
		.input(listForMemberSchema)
		.query(async ({ ctx, input }) => {
			const member = await ctx.db.user.findFirst({
				where: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { userId: true },
			});
			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found in this club",
				});
			}
			const memberships = await ctx.db.memberMembership.findMany({
				where: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
					status: { not: "voided" },
				},
				select: {
					memberMembershipId: true,
					status: true,
					startDate: true,
					endDate: true,
					freezeReason: true,
					suspendReason: true,
					cancelReason: true,
					membershipPlan: {
						select: {
							description: true,
							membershipType: { select: { name: true } },
						},
					},
				},
				orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
			});
			return { memberships };
		}),

	// ------------------------------------------------------------------
	// Status changes (each audited; required remarks per preferences)
	// ------------------------------------------------------------------

	/**
	 * Freeze an active membership. Records the freeze start; the freeze duration
	 * extends `endDate` on unfreeze. Remark required when the club preference is
	 * on (`requireRemarkForFreeze`).
	 */
	freeze: facilityProcedure
		.input(reasonActionSchema)
		.mutation(async ({ ctx, input }) => {
			const { membership, prefs } = await loadMembershipForStatusChange(
				ctx.db,
				input.memberMembershipId,
				ctx.user.clubShortName,
			);
			if (membership.status !== "active") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Only an active membership can be frozen",
				});
			}
			// Reject when the term has already lapsed (derived "expired"): a stored
			// "active" row past its endDate has nothing left to freeze.
			if (membership.endDate && new Date() >= membership.endDate) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Cannot freeze an expired membership",
				});
			}
			const reason = requireReasonIf(
				prefs.requireRemarkForFreeze,
				input.reason,
				"A remark is required to freeze this membership",
			);
			return runStatusChange(ctx, {
				membershipId: membership.memberMembershipId,
				consumerUserId: membership.userId,
				action: AUDIT_ACTIONS.MEMBERSHIP_FROZEN,
				reason,
				data: {
					status: "frozen",
					freezeStartDate: new Date(),
					freezeEndDate: null,
					freezeReason: reason,
				},
			});
		}),

	/**
	 * Unfreeze a frozen membership → back to active, EXTENDING `endDate` by the
	 * freeze duration (the paused days are added back to the contract). Indefinite
	 * memberships (endDate null) just resume.
	 */
	unfreeze: facilityProcedure
		.input(memberMembershipIdSchema)
		.mutation(async ({ ctx, input }) => {
			const { membership } = await loadMembershipForStatusChange(
				ctx.db,
				input.memberMembershipId,
				ctx.user.clubShortName,
			);
			if (membership.status !== "frozen") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Only a frozen membership can be unfrozen",
				});
			}
			// Extend endDate by the freeze duration (now − freezeStartDate). Null
			// endDate (indefinite) never extends.
			const now = new Date();
			let newEndDate = membership.endDate;
			if (membership.endDate && membership.freezeStartDate) {
				const frozenMs = now.getTime() - membership.freezeStartDate.getTime();
				if (frozenMs > 0) {
					newEndDate = new Date(membership.endDate.getTime() + frozenMs);
				}
			}
			return runStatusChange(ctx, {
				membershipId: membership.memberMembershipId,
				consumerUserId: membership.userId,
				action: AUDIT_ACTIONS.MEMBERSHIP_UNFROZEN,
				reason: null,
				data: {
					status: "active",
					endDate: newEndDate,
					freezeEndDate: now,
				},
			});
		}),

	/** Suspend an active membership (disciplinary/admin). No date extension. */
	suspend: facilityProcedure
		.input(reasonActionSchema)
		.mutation(async ({ ctx, input }) => {
			const { membership, prefs } = await loadMembershipForStatusChange(
				ctx.db,
				input.memberMembershipId,
				ctx.user.clubShortName,
			);
			if (membership.status !== "active") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Only an active membership can be suspended",
				});
			}
			// Reject when the term has already lapsed (derived "expired"): a stored
			// "active" row past its endDate has nothing left to suspend.
			if (membership.endDate && new Date() >= membership.endDate) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Cannot suspend an expired membership",
				});
			}
			const reason = requireReasonIf(
				prefs.requireRemarkForSuspend,
				input.reason,
				"A remark is required to suspend this membership",
			);
			return runStatusChange(ctx, {
				membershipId: membership.memberMembershipId,
				consumerUserId: membership.userId,
				action: AUDIT_ACTIONS.MEMBERSHIP_SUSPENDED,
				reason,
				data: { status: "suspended", suspendReason: reason },
			});
		}),

	/** Reinstate a suspended membership → active. */
	reinstate: facilityProcedure
		.input(memberMembershipIdSchema)
		.mutation(async ({ ctx, input }) => {
			const { membership } = await loadMembershipForStatusChange(
				ctx.db,
				input.memberMembershipId,
				ctx.user.clubShortName,
			);
			if (membership.status !== "suspended") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Only a suspended membership can be reinstated",
				});
			}
			return runStatusChange(ctx, {
				membershipId: membership.memberMembershipId,
				consumerUserId: membership.userId,
				action: AUDIT_ACTIONS.MEMBERSHIP_REINSTATED,
				reason: null,
				data: { status: "active" },
			});
		}),

	/**
	 * Cancel a membership (terminal — staff sell a new one to restart). Remark
	 * required per preference. Cancel does NOT touch billing: any refund is issued
	 * separately through the existing billing UI (BillingPanel / RecordPayment),
	 * so this mutation only flips the membership lifecycle to "cancelled".
	 */
	cancel: facilityProcedure
		.input(cancelSchema)
		.mutation(async ({ ctx, input }) => {
			const { membership, prefs } = await loadMembershipForStatusChange(
				ctx.db,
				input.memberMembershipId,
				ctx.user.clubShortName,
			);
			if (membership.status === "cancelled") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Membership is already cancelled",
				});
			}
			if (membership.status === "voided") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Cannot cancel a voided membership",
				});
			}
			const reason = requireReasonIf(
				prefs.requireRemarkForCancel,
				input.reason,
				"A remark is required to cancel this membership",
			);

			return writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					const updated = await tx.memberMembership.update({
						where: { memberMembershipId: membership.memberMembershipId },
						data: {
							status: "cancelled",
							cancelReason: reason,
							cancelDate: new Date(),
						},
					});

					return {
						result: { membership: updated },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.MEMBERSHIP_CANCELLED,
							consumerUserId: membership.userId,
							payerUserId: null,
							entityType: "MemberMembership",
							entityId: membership.memberMembershipId,
							metadata: { reason },
						}),
					};
				},
			);
		}),

	/**
	 * Void a membership (admin soft-delete of a mistake — wrong member /
	 * duplicate). Sets voidedAt/voidedBy/voidReason and hides the row. Voids the
	 * UNPAID `MEMBERSHIP_FEE` line off the running tab (removes the line +
	 * recomputes the invoice). If the fee has ANY payment against the invoice →
	 * reject (refund + cancel instead, per spec). Remark always required.
	 */
	void: clubAdminProcedure
		.input(reasonActionSchema)
		.mutation(async ({ ctx, input }) => {
			const { membership } = await loadMembershipForStatusChange(
				ctx.db,
				input.memberMembershipId,
				ctx.user.clubShortName,
			);
			if (membership.status === "voided") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Membership is already voided",
				});
			}
			const reason = requireReasonIf(
				true,
				input.reason,
				"A remark is required to void this membership",
			);

			// Find the membership-fee line(s) + the owning invoice. The fee can only
			// be voided off the tab while UNPAID — if the invoice has any payment,
			// reject (the spec routes paid mistakes through refund + cancel).
			const feeLines = await ctx.db.invoiceLineItem.findMany({
				where: {
					memberMembershipId: membership.memberMembershipId,
					kind: "MEMBERSHIP_FEE",
				},
				select: {
					lineItemId: true,
					totalInCents: true,
					invoiceId: true,
					invoice: {
						select: {
							invoiceId: true,
							subtotalInCents: true,
							totalInCents: true,
							amountPaidInCents: true,
							status: true,
						},
					},
				},
			});
			const paidInvoice = feeLines.find(
				(l) => l.invoice.amountPaidInCents > 0 || l.invoice.status === "paid",
			);
			if (paidInvoice) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This membership's fee has been paid. Refund the payment and cancel instead of voiding.",
				});
			}

			return writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					// Remove each unpaid fee line + recompute its invoice (mirrors the
					// invoice-void pattern, but at the line granularity since one tab
					// may carry other charges).
					for (const line of feeLines) {
						await tx.invoiceLineItem.delete({
							where: { lineItemId: line.lineItemId },
						});
						const newSubtotal =
							line.invoice.subtotalInCents - line.totalInCents;
						const newTotal = line.invoice.totalInCents - line.totalInCents;
						// Void only reaches here when the invoice has NO payment (the
						// paid-invoice guard above rejects amountPaidInCents > 0), so the
						// remaining tab is always unpaid → status resolves to "open".
						await tx.invoice.update({
							where: { invoiceId: line.invoiceId },
							data: {
								subtotalInCents: newSubtotal,
								totalInCents: newTotal,
								status: "open",
							},
						});
					}

					const updated = await tx.memberMembership.update({
						where: { memberMembershipId: membership.memberMembershipId },
						data: {
							status: "voided",
							voidedAt: new Date(),
							voidedBy: ctx.user.userId,
							voidReason: reason,
						},
					});

					return {
						result: { membership: updated },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.MEMBERSHIP_VOIDED,
							consumerUserId: membership.userId,
							payerUserId: null,
							entityType: "MemberMembership",
							entityId: membership.memberMembershipId,
							metadata: { reason },
						}),
					};
				},
			);
		}),
});

// ============================================================
// SHARED VALIDATION + STATUS-CHANGE HELPERS
// ============================================================

/** Assert a revenue category exists in the club (FK + cross-tenant guard). */
async function assertRevenueCategoryInClub(
	db: PrismaClient | Prisma.TransactionClient,
	revenueCategoryId: string,
	clubShortName: string,
): Promise<void> {
	const cat = await db.revenueCategory.findFirst({
		where: { revenueCategoryId, clubShortName },
		select: { revenueCategoryId: true },
	});
	if (!cat) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Revenue category not found in this club",
		});
	}
}

/** Assert a membership type exists in the club (FK + cross-tenant guard). */
async function assertTypeInClub(
	db: PrismaClient | Prisma.TransactionClient,
	membershipTypeId: string,
	clubShortName: string,
): Promise<void> {
	const type = await db.membershipType.findFirst({
		where: { membershipTypeId, clubShortName },
		select: { membershipTypeId: true },
	});
	if (!type) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Membership type not found in this club",
		});
	}
}

/** Map a unique-constraint violation on (clubShortName, name) to a 409. */
function mapDuplicateNameError(error: unknown): unknown {
	if (
		error &&
		typeof error === "object" &&
		"code" in error &&
		(error as { code?: string }).code === "P2002"
	) {
		return new TRPCError({
			code: "CONFLICT",
			message: "A membership type with this name already exists",
		});
	}
	return error;
}

/** Require a non-empty reason when the club preference demands it. */
function requireReasonIf(
	required: boolean,
	reason: string | undefined,
	message: string,
): string | null {
	const trimmed = reason?.trim() ?? "";
	if (required && trimmed.length === 0) {
		throw new TRPCError({ code: "BAD_REQUEST", message });
	}
	return trimmed.length > 0 ? trimmed : null;
}

/** Load a membership (cross-tenant guarded) + the club's preferences. */
async function loadMembershipForStatusChange(
	db: PrismaClient | Prisma.TransactionClient,
	memberMembershipId: string,
	clubShortName: string,
) {
	const membership = await db.memberMembership.findFirst({
		where: { memberMembershipId, clubShortName },
		select: {
			memberMembershipId: true,
			userId: true,
			status: true,
			startDate: true,
			endDate: true,
			freezeStartDate: true,
		},
	});
	if (!membership) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Membership not found in this club",
		});
	}
	const prefs = await loadPreferences(db, clubShortName);
	return { membership, prefs };
}

/**
 * Apply a simple status-change update inside an audited transaction. Used by the
 * transitions that only mutate the membership row (freeze/unfreeze/suspend/
 * reinstate); cancel + void carry extra invoice work and are inlined.
 */
async function runStatusChange(
	ctx: {
		db: PrismaClient;
		user: { userId: string; clubShortName: string };
	},
	args: {
		membershipId: string;
		consumerUserId: string;
		action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
		reason: string | null;
		data: Prisma.MemberMembershipUpdateInput;
	},
) {
	return writeAuditedMutation(
		{
			db: ctx.db,
			actorUserId: ctx.user.userId,
			clubShortName: ctx.user.clubShortName,
			source: AUDIT_SOURCES.ADMIN_DASHBOARD,
		},
		async (tx) => {
			const updated = await tx.memberMembership.update({
				where: { memberMembershipId: args.membershipId },
				data: args.data,
			});
			return {
				result: { membership: updated },
				audit: buildPartyAuditEntries({
					action: args.action,
					consumerUserId: args.consumerUserId,
					payerUserId: null,
					entityType: "MemberMembership",
					entityId: args.membershipId,
					metadata: args.reason ? { reason: args.reason } : {},
				}),
			};
		},
	);
}
