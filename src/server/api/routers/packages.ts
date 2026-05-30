import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	clubAdminProcedure,
	createTRPCRouter,
	facilityProcedure,
} from "~/server/api/trpc";
import { AUDIT_SOURCES } from "~/server/utils/auditedMutation";
import { sellPackageInternal } from "~/server/utils/sellPackage";

// ============================================================
// HELPERS
// ============================================================

/**
 * Image storage bridge (public-shop.md D2 / I2). `ProfileImageUploader`
 * returns a `data:image/png;base64,...` string; our schema stores raw bytes
 * + MIME separately. Splits the data URL on the first comma.
 */
function parseDataUrl(dataUrl: string): {
	bytes: Uint8Array<ArrayBuffer>;
	mime: string;
} {
	const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
	if (!match) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid image data URL",
		});
	}
	const buf = Buffer.from(match[2]!, "base64");
	// Copy into a fresh Uint8Array<ArrayBuffer> so Prisma's `Bytes` typing accepts it.
	const ab = new ArrayBuffer(buf.byteLength);
	const bytes = new Uint8Array(ab);
	bytes.set(buf);
	return { mime: match[1]!, bytes };
}

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
		// Public shop fields (decisions #2 + #5 + #17). Stripe IDs accepted
		// but unvalidated — Phase C populates them.
		isPubliclyListed: z.boolean().optional(),
		publicDescription: z.string().max(2000).optional().nullable(),
		publicImageDataUrl: z.string().optional().nullable(),
		stripeProductId: z.string().optional().nullable(),
		stripePriceId: z.string().optional().nullable(),
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
			message:
				"durationValue and durationUnit must both be set or both be null",
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
	// Public shop fields (decisions #2 + #5 + #17).
	isPubliclyListed: z.boolean().optional(),
	publicDescription: z.string().max(2000).optional().nullable(),
	publicImageDataUrl: z.string().optional().nullable(),
	stripeProductId: z.string().optional().nullable(),
	stripePriceId: z.string().optional().nullable(),
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
	// Phase 9a Round 5 — optional "Bill to" override. When set + different from
	// `userId`, the resulting invoice is OWED by `billToUserId` (the payer) but
	// the MemberPackage + line-item consumer remains `userId`. When null,
	// undefined, or equal to `userId`, behavior is unchanged from Round 4
	// (consumer == payer, self-pay). See HANDOFF #106 and phase9-invoicing.md.
	billToUserId: z.string().min(1).optional(),
});

const getMemberPackagesSchema = z.object({
	userId: z.string(),
	// Wave 2 backfill (public-shop.md §"New tRPC Endpoints" → Modified, decisions #15
	// + D7). Default true so existing callers (`MemberPackagesCard`, etc.) pick up
	// family-shared packages without prop changes.
	includeFamily: z.boolean().optional().default(true),
});

const reverseCreditSchema = z.object({
	usageId: z.string(),
});

// ============================================================
// HELPERS
// ============================================================
//
// Phase 12a — `calculateEndDate` + `getFacilityTimezoneForUser` were moved into
// `src/server/utils/sellPackage.ts` (mirrored privately there) so the webhook
// path doesn't reach back into a tRPC router file. The mutation now calls
// `sellPackageInternal`; no other code in this router needs them.

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

			// Public shop image: parse data URL → bytes + mime (D2).
			let publicImageData: Uint8Array<ArrayBuffer> | null | undefined;
			let publicImageType: string | null | undefined;
			if (typeof input.publicImageDataUrl === "string") {
				const parsed = parseDataUrl(input.publicImageDataUrl);
				publicImageData = parsed.bytes;
				publicImageType = parsed.mime;
			} else if (input.publicImageDataUrl === null) {
				publicImageData = null;
				publicImageType = null;
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
					isPubliclyListed: input.isPubliclyListed ?? false,
					publicDescription: input.publicDescription ?? null,
					...(publicImageData !== undefined ? { publicImageData } : {}),
					...(publicImageType !== undefined ? { publicImageType } : {}),
					stripeProductId: input.stripeProductId ?? null,
					stripePriceId: input.stripePriceId ?? null,
				},
			});

			return { plan };
		}),

	/** Update an existing package plan */
	updatePackagePlan: clubAdminProcedure
		.input(updatePackagePlanSchema)
		.mutation(async ({ ctx, input }) => {
			const { packagePlanId, publicImageDataUrl, ...rest } = input;

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
			if (rest.productId !== undefined && rest.productId !== null) {
				const product = await ctx.db.product.findFirst({
					where: {
						productId: rest.productId,
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
				rest.productId !== undefined ? rest.productId : existing.productId;
			const finalIsGeneral =
				rest.isGeneralDropIn !== undefined
					? rest.isGeneralDropIn
					: existing.isGeneralDropIn;

			if (!!finalProductId === finalIsGeneral) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Exactly one of productId or isGeneralDropIn=true must be set",
				});
			}

			// Public shop image: parse data URL → bytes + mime, or clear both
			// columns when explicitly null (D2 — image storage bridge).
			const data: Record<string, unknown> = { ...rest };
			if (typeof publicImageDataUrl === "string") {
				const parsed = parseDataUrl(publicImageDataUrl);
				data.publicImageData = parsed.bytes;
				data.publicImageType = parsed.mime;
			} else if (publicImageDataUrl === null) {
				data.publicImageData = null;
				data.publicImageType = null;
			}

			// I3 save-handler guard: archiving (isActive=false) auto-unlists
			// from the public shop. Prevents the "archived but listed"
			// inconsistency (decision #22).
			if (data.isActive === false) {
				data.isPubliclyListed = false;
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

	/**
	 * Sell a package to a member — creates a MemberPackage and appends a line
	 * item to the member's running-tab Invoice (Phase 9-EOD, 2026-05-02).
	 *
	 * Running tab semantics: charges accumulate on the member's open invoice
	 * (status in `draft` | `open` | `partially_paid`) until they pay it down.
	 * If no such invoice exists, one is created with the next sequential
	 * invoice number for the club. The line item snapshots the plan's
	 * `priceInCents` at sale time so historical totals are immune to later
	 * plan-price edits.
	 *
	 * Phase 9a Round 5 — optional `billToUserId`. The CONSUMER (input.userId)
	 * still owns the MemberPackage and accrues line-item charges; the PAYER
	 * (the "effective payer") is `billToUserId ?? userId`. The running-tab
	 * find, credit-source pull, and advisory lock are all keyed off the
	 * effective payer so the parent's tab/credit travels with the parent
	 * across charges for any of their kids. When billToUserId is null /
	 * undefined / equals userId, the effective payer collapses to userId and
	 * behavior matches Round 4 (self-pay). See HANDOFF #106 and
	 * designFiles/roadmap/phase9-invoicing.md.
	 */
	sellPackage: facilityProcedure
		.input(sellPackageSchema)
		.mutation(async ({ ctx, input }) => {
			// Phase 12a — body extracted to `sellPackageInternal` so the future
			// Stripe webhook (Round 2) can mint MemberPackage rows via the same
			// path. Choice B composition (phase12 §9.3.1): the helper OWNS its
			// `writeAuditedMutation` + the full pre-validation chain (member /
			// plan / bill-to FK / timezone-aware endDate). The Zod input + tRPC
			// signature are UNCHANGED — this is a pure refactor.
			return await sellPackageInternal({
				db: ctx.db,
				clubShortName: ctx.user.clubShortName,
				actorUserId: ctx.user.userId,
				source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				soldByUserId: ctx.user.userId,
				input: {
					userId: input.userId,
					packagePlanId: input.packagePlanId,
					startDate: input.startDate,
					notes: input.notes,
					billToUserId: input.billToUserId,
				},
			});
		}),

	/**
	 * Get a member's packages (all statuses) with usage stats.
	 *
	 * Wave 2 backfill (public-shop.md decisions #15 + D7): when `includeFamily`
	 * is true (default) and the target user is in a `FamilyGroup`, also returns
	 * packages owned by other family members in the *same club*. This closes
	 * the display gap that Wave 1 missed: `consumeCredit` already deducts from
	 * a parent's pack when a kid checks in, but without this widening the
	 * check-in card showed "No packages" and the deduction was invisible.
	 *
	 * Each row carries `ownedBy: { userId, firstName, lastName, isCurrentUser }`
	 * so the UI can label shared packages ("Owned by Jane Doe"). The shape is
	 * always present — even when `includeFamily=false` or the user has no
	 * family group, every row gets `ownedBy` with `isCurrentUser: true`. This
	 * keeps client code free of optional handling.
	 */
	getMemberPackages: facilityProcedure
		.input(getMemberPackagesSchema)
		.query(async ({ ctx, input }) => {
			const member = await ctx.db.user.findFirst({
				where: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
				},
				select: {
					userId: true,
					firstName: true,
					lastName: true,
					familyGroupId: true,
				},
			});

			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found",
				});
			}

			// Build the (userId → name) lookup. Always seed with the input user so
			// `ownedBy` resolves cleanly for the single-user path too.
			const ownerLookup = new Map<
				string,
				{ firstName: string | null; lastName: string | null }
			>();
			ownerLookup.set(member.userId, {
				firstName: member.firstName,
				lastName: member.lastName,
			});

			// Decide which userIds the package query should cover.
			let userIdsForQuery: string[] = [member.userId];
			if (input.includeFamily && member.familyGroupId) {
				// D7: hard cross-club guard — only family members who are in the
				// SAME club as the calling staff. We do not trust the registrant's
				// `familyGroupId` to scope clubs; we filter explicitly.
				const familyMembers = await ctx.db.user.findMany({
					where: {
						familyGroupId: member.familyGroupId,
						clubShortName: ctx.user.clubShortName,
					},
					select: { userId: true, firstName: true, lastName: true },
				});
				for (const fm of familyMembers) {
					ownerLookup.set(fm.userId, {
						firstName: fm.firstName,
						lastName: fm.lastName,
					});
				}
				userIdsForQuery = Array.from(ownerLookup.keys());
			}

			const packages = await ctx.db.memberPackage.findMany({
				where:
					userIdsForQuery.length > 1
						? {
								userId: { in: userIdsForQuery },
								clubShortName: ctx.user.clubShortName,
							}
						: {
								userId: input.userId,
								clubShortName: ctx.user.clubShortName,
							},
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

			// Sort-order tie-break (per task spec): within each status, prefer the
			// input user's own packs above family-shared ones at the same status
			// level. Stable client-side resort — keeps the DB orderBy untouched and
			// avoids a Prisma raw-SQL escape hatch.
			const sortedPackages = [...packages].sort((a, b) => {
				const aMine = a.userId === input.userId ? 0 : 1;
				const bMine = b.userId === input.userId ? 0 : 1;
				return aMine - bMine; // stable: ties keep DB orderBy (status/endDate/createdAt)
			});

			// Compute effective status (always check endDate — decision #56)
			const now = new Date();
			return {
				packages: sortedPackages.map((p) => {
					let effectiveStatus = p.status;
					if (p.status === "active" && p.endDate && p.endDate <= now) {
						effectiveStatus = "expired";
					}
					const owner = ownerLookup.get(p.userId);
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
						ownedBy: {
							userId: p.userId,
							firstName: owner?.firstName ?? null,
							lastName: owner?.lastName ?? null,
							isCurrentUser: p.userId === input.userId,
						},
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
