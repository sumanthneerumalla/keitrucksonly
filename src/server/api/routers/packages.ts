import type { PrismaClient } from "@prisma/client";
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
import { getOrCreateOpenInvoice } from "~/server/utils/invoiceTab";

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
			// Verify member is in this club
			const member = await ctx.db.user.findFirst({
				where: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { userId: true, activeFacilityId: true },
			});

			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found in this club",
				});
			}

			// Phase 9a Round 5 — validate bill-to user (when provided and not the
			// same as the consumer). Must exist in the SAME club; no
			// family-group restriction (any club member can be the payer). The
			// `billToUserId === userId` case is accepted (treated as self-pay) for
			// UX simplicity — the frontend can leave the field populated without
			// having to scrub it back to undefined.
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

			// Effective payer for running-tab routing, credit pulls, and the
			// advisory lock. Collapses to `userId` when billToUserId is absent
			// or equals userId (preserves Round-4 self-pay behavior unchanged).
			const effectivePayerUserId =
				input.billToUserId && input.billToUserId !== input.userId
					? input.billToUserId
					: input.userId;

			// Verify plan is active + in this club
			const plan = await ctx.db.packagePlan.findFirst({
				where: {
					packagePlanId: input.packagePlanId,
					clubShortName: ctx.user.clubShortName,
					isActive: true,
				},
				// Phase 9a line-item hardening — pull the product's revenue category
				// so we can SNAPSHOT it onto the package line. `product` is null for
				// isGeneralDropIn plans (no productId) → revenueCategoryId stays null.
				include: { product: { select: { revenueCategoryId: true } } },
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

			// Snapshot the price at sale time onto the line item.
			const unitPriceInCents = plan.priceInCents;
			const lineTotalInCents = unitPriceInCents; // qty 1, no discount, no tax in 9-EOD

			const result = await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					// Phase 9a Round 4 — advisory lock first, BEFORE any reads or
					// writes. Two staff selling packages to the same member at the
					// same instant would otherwise (a) both fail to find an open
					// running tab and each create a fresh invoice (the original
					// backlog A7 race), and (b) both load the same unconsumed credit
					// sources and stamp them consumed twice — credit double-counted
					// across two new invoices, a real money bug.
					//
					// `pg_advisory_xact_lock` serializes sellPackage calls for this
					// (effectivePayer, clubShortName); other payers' sales proceed in
					// parallel. The lock is released when the transaction commits or
					// rolls back. The md5 → bit(64) → bigint conversion mirrors
					// `rentals.ts:37`. Phase 9a Round 5 follow-up — the
					// `invoice-payer-` lock-key prefix is now SHARED with
					// `recordPayment` and `closeInvoice`, so all three invoice
					// mutations serialize per `(payer, club)`. This closes the
					// cross-class race where a concurrent payment/close could
					// stomp on a sale's status update (and vice versa).
					//
					// Phase 9a Round 5 — lock keyed off the EFFECTIVE PAYER, not the
					// consumer. The race that matters here is "two staff sales
					// racing on the same payer's running tab" (e.g., two staff
					// selling packages for two different kids of the same parent
					// — both should land on the parent's one tab, not duplicate
					// fresh invoices). Locking on the consumer would let those
					// two sales proceed in parallel and clobber each other.
					const lockKey = `invoice-payer-${effectivePayerUserId}-${ctx.user.clubShortName}`;
					await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

					// Find/create the (consumer, payer) running tab and carry forward any
					// available credit (gated OFF by AUTO_APPLY_CREDIT_ON_NEW_INVOICE).
					// Shared with the ad-hoc + event-registration charge sources so every
					// charge routes to the SAME tab with identical numbering, Option-3
					// (consumer,payer) keying, and credit handling. The advisory lock
					// acquired above is the required precondition (see getOrCreateOpenInvoice).
					const { invoice, totalCreditPulledCents, creditLineCount } =
						await getOrCreateOpenInvoice(tx, {
							clubShortName: ctx.user.clubShortName,
							consumerUserId: input.userId,
							effectivePayerUserId,
							facilityId: member.activeFacilityId,
							createdByUserId: ctx.user.userId,
						});

					const memberPackage = await tx.memberPackage.create({
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
							invoiceId: invoice.invoiceId,
						},
					});

					// Append the line item to the running tab. On a new invoice with
					// credit lines, this sorts AFTER the credit lines so the timeline
					// reads: credits applied → new charge.
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
							// Snapshot the revenue category at sale time (null when the
							// plan has no product, e.g. isGeneralDropIn).
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

					// Phase 9a Round 4 — status recompute + auto-close on full payment.
					// We now compute the FINAL subtotal/total from scratch (instead of
					// `increment`) because:
					//   1) Credit lines can drive the new invoice's total negative.
					//   2) Even on the append path, adding a positive line can flip
					//      status (open → partially_paid if amountPaid > 0, or
					//      partially_paid → paid if amountPaid now ≥ new total).
					//      Round 4 fixes this latent bug.
					// Inline recompute (not a shared helper) — the inputs differ enough
					// from `recordPayment`'s path (delta-style here, aggregate-style
					// there) that a shared helper would be more abstraction than reuse.
					const subtotalDelta = unitPriceInCents - totalCreditPulledCents;
					const totalDelta = lineTotalInCents - totalCreditPulledCents;
					const newSubtotal = invoice.subtotalInCents + subtotalDelta;
					const newTotal = invoice.totalInCents + totalDelta;
					const amountPaid = invoice.amountPaidInCents;

					// Phase 9a Round 4 fix — check `amountPaid >= newTotal` FIRST so
					// the credit-overrun case correctly lands at "paid" + auto-close.
					// Example: $30 credit pulled - $25 package → newTotal -$5, with
					// amountPaid $0. The previous ordering short-circuited on
					// `amountPaid <= 0` and left the invoice "open" with a negative
					// balance, breaking the credit-chain design (the credit would
					// never become an eligible source for a later invoice).
					// `recordPayment`'s mirror block isn't affected in practice
					// because its `totalInCents` is frozen positive from the start
					// of the transaction.
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
						result: { memberPackage, invoice: updatedInvoice },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.PACKAGE_SOLD,
							consumerUserId: input.userId,
							// Bill-to payer, or null for self-pay (same expression the
							// invoice's `billedToUserId` is created with above).
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

			return result;
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
