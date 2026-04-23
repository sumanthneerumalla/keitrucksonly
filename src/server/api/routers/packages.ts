import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import dayjs from "~/lib/dayjs-config";
import {
	clubAdminProcedure,
	createTRPCRouter,
	facilityProcedure,
} from "~/server/api/trpc";

// ============================================================
// INPUT SCHEMAS
// ============================================================

const durationUnitSchema = z.enum(["days", "weeks", "months", "years"]);

const createPackagePlanSchema = z
	.object({
		name: z.string().min(1).max(200).trim(),
		description: z.string().max(2000).trim().optional(),
		productId: z.string().optional(),
		isGeneralDropIn: z.boolean().default(false),
		sessionCount: z.number().int().min(1).max(10000), // null deferred to 8b
		priceInCents: z.number().int().min(0),
		durationValue: z.number().int().min(1).max(1000).nullable(),
		durationUnit: durationUnitSchema.nullable(),
		sortOrder: z.number().int().min(0).default(0),
	})
	.refine(
		(data) => {
			// Exactly one of productId or isGeneralDropIn must be set (decision #11)
			const hasProduct = !!data.productId;
			const hasGeneral = data.isGeneralDropIn === true;
			return hasProduct !== hasGeneral; // XOR
		},
		{
			message:
				"Exactly one of productId or isGeneralDropIn=true must be set. Not both, not neither.",
		},
	)
	.refine(
		(data) => {
			// durationValue and durationUnit must be set together or both null
			return (
				(data.durationValue === null && data.durationUnit === null) ||
				(data.durationValue !== null && data.durationUnit !== null)
			);
		},
		{
			message: "durationValue and durationUnit must both be set or both be null",
		},
	);

const updatePackagePlanSchema = z.object({
	packagePlanId: z.string(),
	name: z.string().min(1).max(200).trim().optional(),
	description: z.string().max(2000).trim().nullable().optional(),
	productId: z.string().nullable().optional(),
	isGeneralDropIn: z.boolean().optional(),
	sessionCount: z.number().int().min(1).max(10000).optional(),
	priceInCents: z.number().int().min(0).optional(),
	durationValue: z.number().int().min(1).max(1000).nullable().optional(),
	durationUnit: durationUnitSchema.nullable().optional(),
	sortOrder: z.number().int().min(0).optional(),
	isActive: z.boolean().optional(),
});

const archivePackagePlanSchema = z.object({
	packagePlanId: z.string(),
});

const listPackagePlansSchema = z.object({
	isActive: z.boolean().optional(),
});

const sellPackageSchema = z.object({
	userId: z.string(),
	packagePlanId: z.string(),
	startDate: z.date().optional(), // defaults to now
	notes: z.string().max(2000).optional(),
});

const getMemberPackagesSchema = z.object({
	userId: z.string(),
});

const reverseCreditSchema = z.object({
	usageId: z.string(),
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Calculate endDate for a MemberPackage given a start date and duration.
 * Uses facility timezone if provided (decision #34). Sets the end time to
 * end-of-day (23:59:59.999) in that timezone.
 * Returns null if durationValue or durationUnit is null (no expiry).
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

	// dayjs add() accepts these unit strings directly
	const unit = durationUnit as "days" | "weeks" | "months" | "years";
	const end = start.add(durationValue, unit).endOf("day");

	return end.toDate();
}

/**
 * Get a user's default facility timezone — uses the user's activeFacility if available.
 * Falls back to the user's first facility, then to the club default.
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
// ROUTER
// ============================================================

export const packagesRouter = createTRPCRouter({
	// ------------------------------------------------------------------
	// PackagePlan CRUD
	// ------------------------------------------------------------------

	/** List all package plans for the club */
	listPackagePlans: facilityProcedure
		.input(listPackagePlansSchema)
		.query(async ({ ctx, input }) => {
			const plans = await ctx.db.packagePlan.findMany({
				where: {
					clubShortName: ctx.user.clubShortName,
					...(input.isActive !== undefined && { isActive: input.isActive }),
				},
				include: {
					product: {
						select: {
							productId: true,
							name: true,
							priceInCents: true,
						},
					},
					_count: {
						select: {
							memberPackages: {
								where: { status: "active" },
							},
						},
					},
				},
				orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
			});

			return { plans };
		}),

	/** Create a new package plan */
	createPackagePlan: clubAdminProcedure
		.input(createPackagePlanSchema)
		.mutation(async ({ ctx, input }) => {
			// If productId is set, verify it belongs to this club
			if (input.productId) {
				const product = await ctx.db.product.findFirst({
					where: {
						productId: input.productId,
						clubShortName: ctx.user.clubShortName,
					},
					select: { productId: true },
				});
				if (!product) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Linked product not found in this club",
					});
				}
			}

			const plan = await ctx.db.packagePlan.create({
				data: {
					clubShortName: ctx.user.clubShortName,
					productId: input.productId ?? null,
					isGeneralDropIn: input.isGeneralDropIn,
					name: input.name,
					description: input.description,
					sessionCount: input.sessionCount,
					priceInCents: input.priceInCents,
					durationValue: input.durationValue,
					durationUnit: input.durationUnit,
					sortOrder: input.sortOrder,
				},
			});

			return { plan };
		}),

	/** Update an existing package plan */
	updatePackagePlan: clubAdminProcedure
		.input(updatePackagePlanSchema)
		.mutation(async ({ ctx, input }) => {
			const { packagePlanId, ...data } = input;

			const existing = await ctx.db.packagePlan.findFirst({
				where: {
					packagePlanId,
					clubShortName: ctx.user.clubShortName,
				},
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Package plan not found",
				});
			}

			// If productId is being changed, verify it belongs to this club (mirrors createPackagePlan check)
			if (data.productId !== undefined && data.productId !== null) {
				const product = await ctx.db.product.findFirst({
					where: {
						productId: data.productId,
						clubShortName: ctx.user.clubShortName,
					},
					select: { productId: true },
				});
				if (!product) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Linked product not found in this club",
					});
				}
			}

			// Verify business rule: exactly one of productId or isGeneralDropIn
			const finalProductId =
				data.productId !== undefined ? data.productId : existing.productId;
			const finalIsGeneral =
				data.isGeneralDropIn !== undefined
					? data.isGeneralDropIn
					: existing.isGeneralDropIn;

			if (!!finalProductId === finalIsGeneral) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Exactly one of productId or isGeneralDropIn=true must be set",
				});
			}

			const plan = await ctx.db.packagePlan.update({
				where: { packagePlanId },
				data,
			});

			return { plan };
		}),

	/** Archive a package plan (soft disable — existing sold packages are unaffected) */
	archivePackagePlan: clubAdminProcedure
		.input(archivePackagePlanSchema)
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.packagePlan.findFirst({
				where: {
					packagePlanId: input.packagePlanId,
					clubShortName: ctx.user.clubShortName,
				},
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Package plan not found",
				});
			}

			await ctx.db.packagePlan.update({
				where: { packagePlanId: input.packagePlanId },
				data: { isActive: false },
			});

			return { success: true };
		}),

	// ------------------------------------------------------------------
	// Sell / manage MemberPackage
	// ------------------------------------------------------------------

	/** Sell a package to a member — creates a MemberPackage */
	sellPackage: facilityProcedure
		.input(sellPackageSchema)
		.mutation(async ({ ctx, input }) => {
			// Verify member is in this club
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

			// Verify plan is active + in this club
			const plan = await ctx.db.packagePlan.findFirst({
				where: {
					packagePlanId: input.packagePlanId,
					clubShortName: ctx.user.clubShortName,
					isActive: true,
				},
			});

			if (!plan) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Package plan not found or inactive",
				});
			}

			// Calculate endDate using facility timezone (decision #34)
			const startDate = input.startDate ?? new Date();
			const timezone = await getFacilityTimezoneForUser(ctx.db, input.userId);
			const endDate = calculateEndDate(
				startDate,
				plan.durationValue,
				plan.durationUnit,
				timezone,
			);

			const memberPackage = await ctx.db.memberPackage.create({
				data: {
					clubShortName: ctx.user.clubShortName,
					userId: input.userId,
					packagePlanId: input.packagePlanId,
					startDate,
					endDate,
					creditsTotal: plan.sessionCount,
					creditsUsed: 0,
					status: "active",
					soldBy: ctx.user.userId,
					notes: input.notes ?? null,
				},
			});

			return { memberPackage };
		}),

	/** Get a member's packages (all statuses) with usage stats */
	getMemberPackages: facilityProcedure
		.input(getMemberPackagesSchema)
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
					message: "Member not found",
				});
			}

			const packages = await ctx.db.memberPackage.findMany({
				where: { userId: input.userId, clubShortName: ctx.user.clubShortName },
				include: {
					packagePlan: {
						select: {
							packagePlanId: true,
							name: true,
							description: true,
							isGeneralDropIn: true,
							product: { select: { productId: true, name: true } },
						},
					},
					soldByUser: {
						select: { userId: true, firstName: true, lastName: true },
					},
				},
				orderBy: [{ status: "asc" }, { endDate: "asc" }, { createdAt: "desc" }],
			});

			// Compute effective status (always check endDate — decision #56)
			const now = new Date();
			return {
				packages: packages.map((p) => {
					let effectiveStatus = p.status;
					if (p.status === "active" && p.endDate && p.endDate <= now) {
						effectiveStatus = "expired";
					}
					return {
						memberPackageId: p.memberPackageId,
						planName: p.packagePlan.name,
						planDescription: p.packagePlan.description,
						isGeneralDropIn: p.packagePlan.isGeneralDropIn,
						productName: p.packagePlan.product?.name ?? null,
						startDate: p.startDate,
						endDate: p.endDate,
						creditsTotal: p.creditsTotal,
						creditsUsed: p.creditsUsed,
						creditsRemaining:
							p.creditsTotal !== null
								? Math.max(0, p.creditsTotal - p.creditsUsed)
								: null,
						status: effectiveStatus,
						soldBy: p.soldByUser,
						soldAt: p.soldAt,
						notes: p.notes,
					};
				}),
			};
		}),

	/** Reverse a credit usage (staff correction) — decrements creditsUsed, deletes usage */
	reverseCredit: facilityProcedure
		.input(reverseCreditSchema)
		.mutation(async ({ ctx, input }) => {
			const usage = await ctx.db.packageCreditUsage.findUnique({
				where: { usageId: input.usageId },
				include: {
					memberPackage: {
						select: {
							memberPackageId: true,
							clubShortName: true,
							creditsTotal: true,
							creditsUsed: true,
							status: true,
							endDate: true,
						},
					},
				},
			});

			if (!usage) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Credit usage not found",
				});
			}

			if (usage.memberPackage.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Not in your club",
				});
			}

			await ctx.db.$transaction(async (tx) => {
				// Decrement creditsUsed and delete usage record
				await tx.memberPackage.update({
					where: { memberPackageId: usage.memberPackage.memberPackageId },
					data: { creditsUsed: { decrement: usage.creditsConsumed } },
				});

				await tx.packageCreditUsage.delete({
					where: { usageId: input.usageId },
				});

				// If the package was depleted, it may revert to active — or expired if endDate has passed
				if (usage.memberPackage.status === "depleted") {
					const now = new Date();
					const isExpired =
						usage.memberPackage.endDate !== null &&
						usage.memberPackage.endDate <= now;
					await tx.memberPackage.update({
						where: { memberPackageId: usage.memberPackage.memberPackageId },
						data: { status: isExpired ? "expired" : "active" },
					});
				}
			});

			return { success: true };
		}),
});
