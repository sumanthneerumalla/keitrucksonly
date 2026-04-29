/**
 * Public-shop tRPC router (public-shop.md, Phases A + B).
 *
 * - All listings procedures are `publicProcedure` — unauthenticated reads.
 * - `guestRegisterForFreeEvent` creates a User account on the fly via
 *   `findOrCreateClerkUserId` + `findOrCreateLocalUserAccount` (decision #24,
 *   Option A — Clerk-first split), then registers the new user for the event
 *   using the shared `assertRegistrable` + `createRegistrationTx` pipeline
 *   (TD-2 cleanup).
 *
 * Decision references: #2 (opt-in visibility), #3 (events reuse `isPublic`),
 * #6 (no hero image on listing cards), #14 (default facility = first active
 * alphabetically), #22 (unlisted shows 404).
 */

import { EventType, RegistrationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
	findOrCreateClerkUserId,
	findOrCreateLocalUserAccount,
} from "~/server/utils/createUserAccount";
import {
	assertRegistrable,
	createRegistrationTx,
} from "~/server/utils/eventRegistration";

// ============================================================
// HELPERS
// ============================================================

/**
 * Rebuild a base64 data URL from raw image bytes + MIME type.
 * Returns null if either is missing.
 */
function bytesToDataUrl(
	bytes: Buffer | Uint8Array | null,
	mime: string | null,
): string | null {
	if (!bytes || !mime) return null;
	return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

// ============================================================
// INPUT SCHEMAS
// ============================================================

const listPublicProductsSchema = z.object({
	clubShortName: z.string().min(1),
});

const listPublicPackagePlansSchema = z.object({
	clubShortName: z.string().min(1),
});

const listPublicBookableEventsSchema = z.object({
	clubShortName: z.string().min(1),
	facilityId: z.string().optional(),
});

const getPublicProductSchema = z.object({
	clubShortName: z.string().min(1),
	productId: z.string().min(1),
});

const getPublicPackagePlanSchema = z.object({
	clubShortName: z.string().min(1),
	packagePlanId: z.string().min(1),
});

const guestRegisterSchema = z.object({
	clubShortName: z.string().min(1),
	eventId: z.string().min(1),
	email: z.string().email(),
	firstName: z.string().min(1).max(100).trim(),
	lastName: z.string().min(1).max(100).trim(),
});

// ============================================================
// ROUTER
// ============================================================

export const shopRouter = createTRPCRouter({
	/**
	 * List products that are opted-in to the public shop. Listings do NOT
	 * include `publicImageData` (decision #6 — no hero on listings, prevents
	 * ~130MB-per-page base64 blowup).
	 */
	listPublicProducts: publicProcedure
		.input(listPublicProductsSchema)
		.query(async ({ ctx, input }) => {
			const products = await ctx.db.product.findMany({
				where: {
					clubShortName: input.clubShortName,
					isPubliclyListed: true,
					isActive: true,
				},
				select: {
					productId: true,
					name: true,
					publicDescription: true,
					priceInCents: true,
					currency: true,
				},
				orderBy: { createdAt: "desc" },
			});

			return { products };
		}),

	/**
	 * List package plans that are opted-in to the public shop.
	 * No image data on listings (decision #6).
	 */
	listPublicPackagePlans: publicProcedure
		.input(listPublicPackagePlansSchema)
		.query(async ({ ctx, input }) => {
			const plans = await ctx.db.packagePlan.findMany({
				where: {
					clubShortName: input.clubShortName,
					isPubliclyListed: true,
					isActive: true,
				},
				select: {
					packagePlanId: true,
					name: true,
					publicDescription: true,
					priceInCents: true,
					sessionCount: true,
					durationValue: true,
					durationUnit: true,
					isGeneralDropIn: true,
					product: {
						select: {
							productId: true,
							name: true,
						},
					},
				},
				orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
			});

			return { plans };
		}),

	/**
	 * Public bookable events filter — mirrors `calendar.getPublicEvents`
	 * but with the shop's "bookable right now" filter:
	 *   - not deleted
	 *   - public
	 *   - not BLOCK
	 *   - in the future
	 *   - has remaining capacity (or no cap)
	 *
	 * If `facilityId` is provided, filter via the resource's facility.
	 */
	listPublicBookableEvents: publicProcedure
		.input(listPublicBookableEventsSchema)
		.query(async ({ ctx, input }) => {
			const now = new Date();

			const events = await ctx.db.calendarEvent.findMany({
				where: {
					clubShortName: input.clubShortName,
					isDeleted: false,
					isPublic: true,
					eventType: { not: EventType.BLOCK },
					start: { gt: now },
					...(input.facilityId
						? { resource: { facilityId: input.facilityId } }
						: {}),
				},
				select: {
					eventId: true,
					title: true,
					description: true,
					start: true,
					end: true,
					eventType: true,
					maxParticipants: true,
					productId: true,
					product: {
						select: {
							name: true,
							priceInCents: true,
							currency: true,
						},
					},
					resource: {
						select: {
							facility: {
								select: {
									facilityId: true,
									name: true,
								},
							},
						},
					},
					_count: {
						select: {
							registrations: {
								where: {
									status: {
										in: [
											RegistrationStatus.REGISTERED,
											RegistrationStatus.CHECKED_IN,
										],
									},
								},
							},
						},
					},
				},
				orderBy: { start: "asc" },
			});

			// Filter out fully-booked events (Prisma can't express
			// "registrations < maxParticipants" cleanly in the where clause).
			const bookable = events.filter(
				(e) =>
					e.maxParticipants === null ||
					e._count.registrations < e.maxParticipants,
			);

			return { events: bookable };
		}),

	/**
	 * Single product detail. Includes a base64 data URL for the hero image
	 * (rebuilt from `publicImageData` + `publicImageType`).
	 *
	 * Throws NOT_FOUND if the product is missing OR is not publicly listed
	 * (decision #22 — unlisting shows 404, not "available but hidden").
	 */
	getPublicProduct: publicProcedure
		.input(getPublicProductSchema)
		.query(async ({ ctx, input }) => {
			const product = await ctx.db.product.findFirst({
				where: {
					productId: input.productId,
					clubShortName: input.clubShortName,
					isPubliclyListed: true,
					isActive: true,
				},
				select: {
					productId: true,
					name: true,
					publicDescription: true,
					priceInCents: true,
					currency: true,
					publicImageData: true,
					publicImageType: true,
				},
			});

			if (!product) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Product not found",
				});
			}

			return {
				productId: product.productId,
				name: product.name,
				publicDescription: product.publicDescription,
				priceInCents: product.priceInCents,
				currency: product.currency,
				publicImageDataUrl: bytesToDataUrl(
					product.publicImageData,
					product.publicImageType,
				),
			};
		}),

	/**
	 * Single package-plan detail. Includes a base64 data URL for the hero
	 * image. NOT_FOUND on unlisted (decision #22).
	 */
	getPublicPackagePlan: publicProcedure
		.input(getPublicPackagePlanSchema)
		.query(async ({ ctx, input }) => {
			const plan = await ctx.db.packagePlan.findFirst({
				where: {
					packagePlanId: input.packagePlanId,
					clubShortName: input.clubShortName,
					isPubliclyListed: true,
					isActive: true,
				},
				select: {
					packagePlanId: true,
					name: true,
					publicDescription: true,
					priceInCents: true,
					sessionCount: true,
					durationValue: true,
					durationUnit: true,
					isGeneralDropIn: true,
					publicImageData: true,
					publicImageType: true,
					product: {
						select: {
							productId: true,
							name: true,
						},
					},
				},
			});

			if (!plan) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Package plan not found",
				});
			}

			return {
				packagePlanId: plan.packagePlanId,
				name: plan.name,
				publicDescription: plan.publicDescription,
				priceInCents: plan.priceInCents,
				sessionCount: plan.sessionCount,
				durationValue: plan.durationValue,
				durationUnit: plan.durationUnit,
				isGeneralDropIn: plan.isGeneralDropIn,
				product: plan.product,
				publicImageDataUrl: bytesToDataUrl(
					plan.publicImageData,
					plan.publicImageType,
				),
			};
		}),

	/**
	 * Phase B — guest register for a FREE event.
	 *
	 * Validates the event is genuinely free (productId null, OR linked product
	 * has priceInCents=0, OR creditCost null/0), then:
	 *   1. Clerk find-or-create via `findOrCreateClerkUserId` (no DB tx).
	 *   2. inside a `$transaction`: local User + UserClub via
	 *      `findOrCreateLocalUserAccount`, then assertRegistrable +
	 *      createRegistrationTx.
	 *
	 * Tier-1 email rollout: caller surfaces "We created an account for you"
	 * banner; user clicks /sign-in and Clerk sends the OTP.
	 */
	guestRegisterForFreeEvent: publicProcedure
		.input(guestRegisterSchema)
		.mutation(async ({ ctx, input }) => {
			// Validate event exists in this club + is registrable.
			const event = await ctx.db.calendarEvent.findFirst({
				where: {
					eventId: input.eventId,
					clubShortName: input.clubShortName,
					isDeleted: false,
				},
				select: {
					eventId: true,
					productId: true,
					creditCost: true,
					isPublic: true,
					eventType: true,
					product: { select: { priceInCents: true } },
				},
			});

			if (!event) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Event not found",
				});
			}

			if (!event.isPublic || event.eventType === EventType.BLOCK) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Event is not open for public registration",
				});
			}

			// Free check: productId is null, OR linked product priceInCents
			// is 0, AND creditCost is null/0.
			const priceIsZero =
				event.productId === null || event.product?.priceInCents === 0;
			const creditFree = event.creditCost === null || event.creditCost === 0;
			if (!priceIsZero || !creditFree) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"This event is not free — guest register only supports free events.",
				});
			}

			// Clerk runs first, outside the tx (decision #24 Option A). If the
			// DB tx fails after Clerk succeeded, the brand-new Clerk user
			// persists as an orphan. Recovery: next attempt with the same
			// email finds the orphan via getUserList. Future cleanup path =
			// extend OrphanedPurchase (Phase C) with a `clerk_no_local_user`
			// reason.
			const { clerkUserId } = await findOrCreateClerkUserId({
				email: input.email,
				firstName: input.firstName,
				lastName: input.lastName,
			});

			// Single outer transaction wraps local user creation + registration
			// so a late failure (e.g., "fully booked" in assertRegistrable)
			// rolls back the local User + UserClub rows too. (B1/I1 review fix.)
			const { userId, isNewUser } = await ctx.db.$transaction(async (tx) => {
				const account = await findOrCreateLocalUserAccount({
					db: tx,
					clerkUserId,
					email: input.email,
					firstName: input.firstName,
					lastName: input.lastName,
					clubShortName: input.clubShortName,
					role: "STUDENT",
				});

				const calEvent = await assertRegistrable({
					db: tx,
					eventId: input.eventId,
					userId: account.userId,
					selfServe: true,
				});
				await createRegistrationTx({
					tx,
					event: calEvent,
					userId: account.userId,
					source: "self_service",
					changedByUserId: account.userId,
				});

				return account;
			});

			return {
				userId,
				email: input.email,
				isNewUser,
			};
		}),
});
