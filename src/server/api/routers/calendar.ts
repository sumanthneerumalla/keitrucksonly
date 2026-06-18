import {
	EventType,
	RegistrationStatus,
	RegistrationType,
	RentalBookingStatus,
	type User,
	UserType,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { RRule } from "rrule";
import { z } from "zod";
import { operatingHoursSchema } from "~/lib/clubProfile";
import {
	createTRPCRouter,
	facilityProcedure, // user must be FACILITY or ADMIN
	protectedProcedure,
	publicProcedure,
	staffProcedure, // user must be FACILITY, ADMIN, or COACH
} from "~/server/api/trpc";
import { revalidateClub } from "~/server/revalidateClub";
import { validateDateRange } from "~/server/utils/dateUtils";
import {
	formatEventTimeInZone,
	getDayRangeInZone,
} from "~/server/utils/dateUtils";
import {
	assertRegistrable,
	createRegistrationTx,
} from "~/server/utils/eventRegistration";
import { sendRegistrationConfirmationEmail } from "~/server/utils/registrationEmail";
import {
	checkRecurringEventConflicts,
	checkResourceConflicts,
	formatRecurringConflictsMessage,
} from "~/server/utils/resourceConflicts";
import { buildRuleSetFromEvent } from "~/server/utils/rrule";
import {
	getCurrentUser,
	isAnyAdmin,
	isFacilityOrAbove,
	isPlatformAdmin,
	isSameClub,
} from "~/server/utils/utils";

// ============================================================
// SHARED HELPERS
// ============================================================

/**
 * Helper to verify the current user belongs to the specified club
 * Used by read procedures to scope data to the user's club
 */
function requireSameClub(user: User, clubShortName: string): void {
	if (!isSameClub(user, { clubShortName }) && !isPlatformAdmin(user)) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You can only access your own club's calendar",
		});
	}
}

// ============================================================
// INPUT SCHEMAS
// ============================================================

const dayOfWeekEnum = z.enum([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

const businessHoursSchema = z.object({
	daysOfWeek: z.array(dayOfWeekEnum).min(1),
	startTime: z.number().int().min(0).max(23),
	endTime: z.number().int().min(0).max(23),
});

const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

// ============================================================
// RESOURCE TYPE PROCEDURES
// ============================================================

const createResourceTypeSchema = z.object({
	name: z.string().min(1).max(100).trim(),
	color: z.string().regex(hexColorRegex).optional(),
	backgroundColor: z.string().regex(hexColorRegex).optional(),
});

const getResourceTypesSchema = z.object({});

const updateResourceTypeSchema = z.object({
	resourceTypeId: z.string(),
	name: z.string().min(1).max(100).trim().optional(),
	color: z.string().regex(hexColorRegex).nullable().optional(),
	backgroundColor: z.string().regex(hexColorRegex).nullable().optional(),
});

const deleteResourceTypeSchema = z.object({
	resourceTypeId: z.string(),
});

// ============================================================
// FACILITY PROCEDURES
// ============================================================

const createFacilitySchema = z.object({
	name: z.string().min(1).max(200).trim(),
	streetAddress: z.string().max(500).trim().optional(),
	city: z.string().max(100).trim().optional(),
	state: z.string().max(100).trim().optional(),
	zipCode: z.string().max(20).trim().optional(),
	phone: z.string().max(30).trim().optional(),
	email: z.string().max(255).email().trim().optional(),
	// IANA timezone (e.g. "America/New_York"). Schema default kicks in if omitted —
	// no need to validate against the curated TIMEZONE_OPTIONS list here; staff who
	// know IANA codes can pass anything Postgres + dayjs accept.
	timezone: z.string().max(100).trim().optional(),
});

const updateFacilitySchema = z.object({
	facilityId: z.string(),
	name: z.string().min(1).max(200).trim().optional(),
	streetAddress: z.string().max(500).trim().nullable().optional(),
	city: z.string().max(100).trim().nullable().optional(),
	state: z.string().max(100).trim().nullable().optional(),
	zipCode: z.string().max(20).trim().nullable().optional(),
	phone: z.string().max(30).trim().nullable().optional(),
	email: z.string().max(255).email().nullable().optional(),
	position: z.number().int().min(0).optional(),
	isActive: z.boolean().optional(),
	// Not nullable: the field has a non-null default at the schema layer. Allowing
	// null here would let staff blank out the timezone, which would break date
	// math elsewhere (consumeCredit, dashboard ranges). Pass a value or omit.
	timezone: z.string().max(100).trim().optional(),
	// Phase 16 Step 2 (D4): facility-level hours + public blurb for the club
	// landing page. null clears (→ landing hides the section).
	operatingHours: operatingHoursSchema.nullable().optional(),
	description: z.string().trim().max(2000).nullable().optional(),
});

const deleteFacilitySchema = z.object({
	facilityId: z.string(),
});

// ============================================================
// RESOURCE PROCEDURES
// ============================================================

const createResourceSchema = z.object({
	resourceTypeId: z.string(),
	facilityId: z.string().optional(),
	title: z.string().min(1).max(200).trim(),
	description: z.string().max(1000).trim().optional(),
	color: z.string().regex(hexColorRegex).optional(),
	backgroundColor: z.string().regex(hexColorRegex).optional(),
	position: z.number().int().min(0).optional(),
	businessHours: z.array(businessHoursSchema).optional(),
});

const getResourcesSchema = z.object({
	facilityId: z.string().optional(), // When set, return only resources at this facility. Omit for all club resources.
});

const updateResourceSchema = z.object({
	resourceId: z.string(),
	title: z.string().min(1).max(200).trim().optional(),
	description: z.string().max(1000).trim().nullable().optional(),
	resourceTypeId: z.string().optional(),
	facilityId: z.string().nullable().optional(),
	color: z.string().regex(hexColorRegex).nullable().optional(),
	backgroundColor: z.string().regex(hexColorRegex).nullable().optional(),
	position: z.number().int().min(0).optional(),
	isActive: z.boolean().optional(),
});

const updateResourceBusinessHoursSchema = z
	.object({
		resourceId: z.string(),
		businessHours: z.array(businessHoursSchema),
	})
	.refine(
		(data) => data.businessHours.every((bh) => bh.startTime < bh.endTime),
		{ message: "startTime must be less than endTime" },
	);

const deleteResourceSchema = z.object({
	resourceId: z.string(),
});

// ============================================================
// EVENT PROCEDURES
// ============================================================

const createEventSchema = z.object({
	resourceId: z.string().optional(),
	resourceIds: z.array(z.string()).optional(),
	facilityId: z.string().optional(), // Defaults to user's activeFacilityId if not provided
	title: z.string().min(1).max(500).trim(),
	description: z.string().max(2000).trim().optional(),
	start: z.date(),
	end: z.date(),
	allDay: z.boolean().optional(),
	color: z.string().optional(),
	backgroundColor: z.string().optional(),
	rrule: z.string().max(500).optional(),
	eventType: z
		.enum(["BLOCK", "BOOKABLE", "COACHING_SLOT", "DROP_IN"])
		.default("BLOCK"),
	isPublic: z.boolean().default(false),
	maxParticipants: z.number().int().positive().optional(),
	registrationType: z.enum(["PER_INSTANCE", "PER_SERIES"]).optional(),
	productId: z.string().optional(),
	creditCost: z.number().int().nonnegative().optional(),
});

const getEventsSchema = z.object({
	startDate: z.date(),
	endDate: z.date(),
	facilityId: z.string().optional(), // Filter events by facility; defaults to user's activeFacilityId
});

const updateEventSchema = z.object({
	eventId: z.string(),
	title: z.string().min(1).max(500).trim().optional(),
	description: z.string().max(2000).trim().nullable().optional(),
	resourceId: z.string().nullable().optional(),
	resourceIds: z.array(z.string()).optional(),
	start: z.date().optional(),
	end: z.date().optional(),
	allDay: z.boolean().optional(),
	color: z.string().nullable().optional(),
	backgroundColor: z.string().nullable().optional(),
	rrule: z.string().max(500).nullable().optional(),
	exdates: z.array(z.date()).optional(),
	productId: z.string().nullable().optional(),
	creditCost: z.number().int().nonnegative().nullable().optional(),
	scope: z.enum(["THIS", "THIS_AND_FUTURE", "ALL"]).optional(),
	instanceDate: z.date().optional(), // Required when scope is THIS or THIS_AND_FUTURE
});

const getEventByIdSchema = z.object({
	eventId: z.string(),
});

const updateEventDetailsSchema = z.object({
	eventId: z.string(),
	description: z.string().max(2000).trim().nullable().optional(),
	isPublic: z.boolean().optional(),
	maxParticipants: z.number().int().positive().nullable().optional(),
	registrationType: z
		.enum(["PER_INSTANCE", "PER_SERIES"])
		.nullable()
		.optional(),
	showRegistrantNames: z.boolean().optional(),
});

const deleteEventSchema = z.object({
	eventId: z.string(),
	scope: z.enum(["THIS", "THIS_AND_FUTURE", "ALL"]).optional(),
	instanceDate: z.date().optional(), // Required when scope is THIS or THIS_AND_FUTURE
});

const checkConflictsSchema = z.object({
	resourceId: z.string(),
	start: z.date(),
	end: z.date(),
	excludeEventId: z.string().optional(),
});

const registerForEventSchema = z.object({
	eventId: z.string(),
	instanceDate: z.date().optional(), // Required for PER_INSTANCE recurring events
});

// Staff registering another member — same shape as registerForEvent plus target userId
const staffRegisterSchema = z.object({
	eventId: z.string(),
	userId: z.string(),
	instanceDate: z.date().optional(), // Required for PER_INSTANCE recurring events
});

const cancelRegistrationSchema = z.object({
	registrationId: z.string(),
});

const updateRegistrationStatusSchema = z.object({
	registrationId: z.string(),
	action: z.enum(["CANCEL", "NO_SHOW", "RESCHEDULE", "CHECK_IN"]),
	newEventId: z.string().optional(), // Required when action === "RESCHEDULE"
	newInstanceDate: z.date().optional(),
});

const getEventRegistrationsSchema = z.object({
	eventId: z.string(),
	// When true, also return inactive registrations (NO_SHOW / cancelled) so a
	// staff roster can show them greyed-out. Default false (active only).
	includeInactive: z.boolean().optional(),
});

// ============================================================
// PUBLIC PROCEDURES (Phase 2.5+)
// ============================================================

const getPublicEventsSchema = z.object({
	clubShortName: z.string(),
	startDate: z.date(),
	endDate: z.date(),
	facilityId: z.string().optional(),
});

const getPublicResourcesSchema = z.object({
	clubShortName: z.string(),
	facilityId: z.string().optional(),
});

const getPublicFacilitiesSchema = z.object({
	clubShortName: z.string(),
});

// ============================================================
// ROUTER
// ============================================================

export const calendarRouter = createTRPCRouter({
	// ============ RESOURCE TYPES ============

	createResourceType: facilityProcedure
		.input(createResourceTypeSchema)
		.mutation(async ({ ctx, input }) => {
			try {
				const resourceType = await ctx.db.clubResourceType.create({
					data: {
						clubShortName: ctx.user.clubShortName,
						name: input.name,
						color: input.color,
						backgroundColor: input.backgroundColor,
					},
				});
				return resourceType;
			} catch (error) {
				// Handle unique constraint violation (duplicate name)
				if (error instanceof Error && error.message.includes("unique")) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "A resource type with this name already exists",
					});
				}
				throw error;
			}
		}),

	getResourceTypes: protectedProcedure
		.input(getResourceTypesSchema)
		.query(async ({ ctx }) => {
			const user = await getCurrentUser(ctx);
			const resourceTypes = await ctx.db.clubResourceType.findMany({
				where: {
					clubShortName: user.clubShortName,
				},
				include: {
					_count: {
						select: { resources: true },
					},
				},
				orderBy: {
					name: "asc",
				},
			});

			return {
				resourceTypes: resourceTypes.map((rt) => ({
					resourceTypeId: rt.resourceTypeId,
					name: rt.name,
					color: rt.color,
					backgroundColor: rt.backgroundColor,
					_count: { resources: rt._count.resources },
				})),
			};
		}),

	updateResourceType: facilityProcedure
		.input(updateResourceTypeSchema)
		.mutation(async ({ ctx, input }) => {
			const { resourceTypeId, ...data } = input;

			// Verify ownership
			const existing = await ctx.db.clubResourceType.findUnique({
				where: { resourceTypeId },
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Resource type not found",
				});
			}

			requireSameClub(ctx.user, existing.clubShortName);

			try {
				const updated = await ctx.db.clubResourceType.update({
					where: { resourceTypeId },
					data,
				});
				return updated;
			} catch (error) {
				// Handle unique constraint on name change
				if (error instanceof Error && error.message.includes("unique")) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "A resource type with this name already exists",
					});
				}
				throw error;
			}
		}),

	deleteResourceType: facilityProcedure
		.input(deleteResourceTypeSchema)
		.mutation(async ({ ctx, input }) => {
			const { resourceTypeId } = input;

			// Verify ownership
			const existing = await ctx.db.clubResourceType.findUnique({
				where: { resourceTypeId },
				include: {
					_count: { select: { resources: { where: { isActive: true } } } },
				},
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Resource type not found",
				});
			}

			requireSameClub(ctx.user, existing.clubShortName);

			// Block if any active resources still use this type
			if (existing._count.resources > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Cannot delete resource type with active resources. Deactivate all resources of this type first.",
				});
			}

			await ctx.db.clubResourceType.delete({
				where: { resourceTypeId },
			});

			return { success: true };
		}),

	// ============ FACILITIES ============

	createFacility: facilityProcedure
		.input(createFacilitySchema)
		.mutation(async ({ ctx, input }) => {
			try {
				// Auto-assign next position
				const maxPos = await ctx.db.clubFacility.aggregate({
					where: { clubShortName: ctx.user.clubShortName },
					_max: { position: true },
				});

				const {
					name,
					streetAddress,
					city,
					state,
					zipCode,
					phone,
					email,
					timezone,
				} = input;
				const facility = await ctx.db.clubFacility.create({
					data: {
						clubShortName: ctx.user.clubShortName,
						name,
						streetAddress,
						city,
						state,
						zipCode,
						phone,
						email,
						// `timezone` omitted from data block when undefined so the schema's
						// default ("America/New_York") applies.
						...(timezone ? { timezone } : {}),
						position: (maxPos._max.position ?? -1) + 1,
					},
				});
				return facility;
			} catch (error) {
				if (error instanceof Error && error.message.includes("unique")) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "A facility with this name already exists in this club",
					});
				}
				throw error;
			}
		}),

	getFacilities: protectedProcedure.query(async ({ ctx }) => {
		const user = await getCurrentUser(ctx);

		// Lazy-init: ensure the club has at least one facility (idempotent via unique constraint)
		const count = await ctx.db.clubFacility.count({
			where: { clubShortName: user.clubShortName },
		});
		if (count === 0) {
			await ctx.db.clubFacility.upsert({
				where: {
					clubShortName_name: {
						clubShortName: user.clubShortName,
						name: "Main",
					},
				},
				create: {
					clubShortName: user.clubShortName,
					name: "Main",
					position: 0,
				},
				update: {},
			});
		}

		const facilities = await ctx.db.clubFacility.findMany({
			where: { clubShortName: user.clubShortName },
			include: {
				_count: {
					select: {
						resources: { where: { isActive: true } },
						calendarEvents: { where: { isDeleted: false } },
					},
				},
			},
			orderBy: { position: "asc" },
		});

		return facilities.map((f) => ({
			facilityId: f.facilityId,
			name: f.name,
			streetAddress: f.streetAddress,
			city: f.city,
			state: f.state,
			zipCode: f.zipCode,
			phone: f.phone,
			email: f.email,
			timezone: f.timezone,
			operatingHours: f.operatingHours,
			description: f.description,
			isActive: f.isActive,
			position: f.position,
			resourceCount: f._count.resources,
			eventCount: f._count.calendarEvents,
		}));
	}),

	updateFacility: facilityProcedure
		.input(updateFacilitySchema)
		.mutation(async ({ ctx, input }) => {
			const { facilityId, ...data } = input;

			const existing = await ctx.db.clubFacility.findUnique({
				where: { facilityId },
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Facility not found",
				});
			}

			requireSameClub(ctx.user, existing.clubShortName);

			try {
				const { operatingHours, ...rest } = data;
				const updated = await ctx.db.clubFacility.update({
					where: { facilityId },
					data: {
						...rest,
						// Prisma Json null semantics: DbNull clears the column.
						...(operatingHours !== undefined
							? { operatingHours: operatingHours ?? { set: null } }
							: {}),
					},
				});
				// Hours/blurb/address show on the public club landing page.
				revalidateClub(existing.clubShortName);
				return updated;
			} catch (error) {
				if (error instanceof Error && error.message.includes("unique")) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "A facility with this name already exists in this club",
					});
				}
				throw error;
			}
		}),

	deactivateFacility: facilityProcedure
		.input(deleteFacilitySchema)
		.mutation(async ({ ctx, input }) => {
			const { facilityId } = input;

			const existing = await ctx.db.clubFacility.findUnique({
				where: { facilityId },
				include: {
					_count: {
						select: {
							resources: { where: { isActive: true } },
							calendarEvents: { where: { isDeleted: false } },
						},
					},
				},
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Facility not found",
				});
			}

			requireSameClub(ctx.user, existing.clubShortName);

			if (existing._count.resources > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Cannot deactivate facility with ${existing._count.resources} active resource(s). Reassign or deactivate them first.`,
				});
			}

			// Block on any future confirmed rental bookings. The calendarEvents _count above
			// would also catch these (they create a blocking CalendarEvent), but a specific
			// message here makes the fix obvious: staff need to cancel the booking, not just
			// delete a calendar row. Historical cancelled bookings don't block.
			const futureConfirmedBookings = await ctx.db.rentalBooking.count({
				where: {
					facilityId,
					status: RentalBookingStatus.CONFIRMED,
					endTime: { gt: new Date() },
				},
			});
			if (futureConfirmedBookings > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Cannot deactivate facility with ${futureConfirmedBookings} future rental booking(s). Cancel them first.`,
				});
			}

			await ctx.db.clubFacility.update({
				where: { facilityId },
				data: { isActive: false },
			});

			return { success: true };
		}),

	// ============ RESOURCES ============

	createResource: facilityProcedure
		.input(createResourceSchema)
		.mutation(async ({ ctx, input }) => {
			const { businessHours, resourceTypeId, ...resourceData } = input;

			// Verify resourceType belongs to user's club
			const resourceType = await ctx.db.clubResourceType.findUnique({
				where: { resourceTypeId },
			});

			if (!resourceType) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Resource type not found",
				});
			}

			requireSameClub(ctx.user, resourceType.clubShortName);

			// Verify facilityId belongs to user's club if provided
			if (input.facilityId) {
				const facility = await ctx.db.clubFacility.findUnique({
					where: { facilityId: input.facilityId },
				});
				if (!facility || facility.clubShortName !== ctx.user.clubShortName) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid facility",
					});
				}
			}

			// Auto-assign position if not provided
			let position = input.position;
			if (position === undefined) {
				const maxPosition = await ctx.db.clubResource.aggregate({
					where: { clubShortName: ctx.user.clubShortName },
					_max: { position: true },
				});
				position = (maxPosition._max.position ?? -1) + 1;
			}

			// Create resource with business hours in a transaction
			const resource = await ctx.db.$transaction(async (tx) => {
				const newResource = await tx.clubResource.create({
					data: {
						...resourceData,
						position,
						clubShortName: ctx.user.clubShortName,
						resourceTypeId,
					},
				});

				if (businessHours && businessHours.length > 0) {
					await tx.resourceBusinessHours.createMany({
						data: businessHours.map((bh) => ({
							resourceId: newResource.resourceId,
							daysOfWeek: bh.daysOfWeek,
							startTime: bh.startTime,
							endTime: bh.endTime,
						})),
					});
				}

				return tx.clubResource.findUnique({
					where: { resourceId: newResource.resourceId },
					include: { businessHours: true },
				});
			});

			return resource;
		}),

	getResources: protectedProcedure
		.input(getResourcesSchema)
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const resources = await ctx.db.clubResource.findMany({
				where: {
					clubShortName: user.clubShortName,
					isActive: true,
					...(input.facilityId && { facilityId: input.facilityId }),
				},
				include: {
					resourceType: {
						select: {
							resourceTypeId: true,
							name: true,
						},
					},
					businessHours: true,
				},
				orderBy: {
					position: "asc",
				},
			});

			return {
				resources: resources.map((r) => ({
					resourceId: r.resourceId,
					title: r.title,
					description: r.description,
					color: r.color,
					backgroundColor: r.backgroundColor,
					position: r.position,
					facilityId: r.facilityId,
					resourceType: r.resourceType,
					businessHours: r.businessHours.map((bh) => ({
						daysOfWeek: bh.daysOfWeek,
						startTime: bh.startTime,
						endTime: bh.endTime,
					})),
				})),
			};
		}),

	updateResource: facilityProcedure
		.input(updateResourceSchema)
		.mutation(async ({ ctx, input }) => {
			const { resourceId, ...data } = input;

			// Verify ownership
			const existing = await ctx.db.clubResource.findUnique({
				where: { resourceId },
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Resource not found",
				});
			}

			requireSameClub(ctx.user, existing.clubShortName);

			// If resourceTypeId changing, verify new type belongs to same club
			if (data.resourceTypeId) {
				const newType = await ctx.db.clubResourceType.findUnique({
					where: { resourceTypeId: data.resourceTypeId },
				});

				if (!newType || newType.clubShortName !== ctx.user.clubShortName) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid resource type",
					});
				}
			}

			// If facilityId changing, verify new facility belongs to same club
			if (data.facilityId) {
				const newFacility = await ctx.db.clubFacility.findUnique({
					where: { facilityId: data.facilityId },
				});

				if (
					!newFacility ||
					newFacility.clubShortName !== ctx.user.clubShortName
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid facility",
					});
				}
			}

			const updated = await ctx.db.clubResource.update({
				where: { resourceId },
				data,
			});

			return updated;
		}),

	updateResourceBusinessHours: facilityProcedure
		.input(updateResourceBusinessHoursSchema)
		.mutation(async ({ ctx, input }) => {
			const { resourceId, businessHours } = input;

			// Verify ownership
			const existing = await ctx.db.clubResource.findUnique({
				where: { resourceId },
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Resource not found",
				});
			}

			requireSameClub(ctx.user, existing.clubShortName);

			// Replace-all strategy in transaction
			await ctx.db.$transaction(async (tx) => {
				await tx.resourceBusinessHours.deleteMany({
					where: { resourceId },
				});

				if (businessHours.length > 0) {
					await tx.resourceBusinessHours.createMany({
						data: businessHours.map((bh) => ({
							resourceId,
							daysOfWeek: bh.daysOfWeek,
							startTime: bh.startTime,
							endTime: bh.endTime,
						})),
					});
				}
			});

			return { success: true };
		}),

	deleteResource: facilityProcedure
		.input(deleteResourceSchema)
		.mutation(async ({ ctx, input }) => {
			const { resourceId } = input;

			// Verify ownership
			const existing = await ctx.db.clubResource.findUnique({
				where: { resourceId },
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Resource not found",
				});
			}

			requireSameClub(ctx.user, existing.clubShortName);

			// Soft deactivate
			await ctx.db.clubResource.update({
				where: { resourceId },
				data: { isActive: false },
			});

			return { success: true };
		}),

	// ============ EVENTS ============

	createEvent: staffProcedure
		.input(createEventSchema)
		.mutation(async ({ ctx, input }) => {
			const {
				resourceId,
				resourceIds,
				title,
				description,
				start,
				end,
				allDay,
				color,
				backgroundColor,
				rrule,
				eventType,
				isPublic,
				maxParticipants,
				registrationType,
				productId,
				creditCost,
			} = input;

			const user = ctx.user;
			const isFacilityOrAdmin = isFacilityOrAbove(user);
			const isCoach = user.userType === UserType.COACH;

			// BOOKABLE and COACHING_SLOT events are always public by default
			// prior private events will be marked as public again next time they're
			// saved or updated if this the event is bookable or a coaching slot
			const effectiveIsPublic =
				eventType === "BOOKABLE" ||
				eventType === "COACHING_SLOT" ||
				eventType === "DROP_IN"
					? true
					: isPublic;

			// Role-based event type enforcement
			if (isCoach && eventType !== "COACHING_SLOT") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Coaches can only create COACHING_SLOT events",
				});
			}
			if (
				user.userType === UserType.FACILITY &&
				eventType === "COACHING_SLOT"
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Facility users cannot create COACHING_SLOT events",
				});
			}

			// Validate end > start (unless allDay)
			if (!allDay) {
				try {
					validateDateRange(start, end);
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "End time must be after start time",
					});
				}
			}

			// Verify resourceId belongs to user's club and is active
			if (resourceId) {
				const resource = await ctx.db.clubResource.findUnique({
					where: { resourceId },
				});

				if (!resource) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Resource not found",
					});
				}

				requireSameClub(user, resource.clubShortName);

				if (!resource.isActive) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Resource is not active",
					});
				}
			}

			// Verify all resourceIds belong to user's club and are active
			if (resourceIds && resourceIds.length > 0) {
				const resources = await ctx.db.clubResource.findMany({
					where: {
						resourceId: { in: resourceIds },
					},
				});

				for (const resource of resources) {
					requireSameClub(user, resource.clubShortName);
					if (!resource.isActive) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Resource ${resource.title} is not active`,
						});
					}
				}
			}

			// Validate productId: must belong to same club and match category
			if (productId) {
				const product = await ctx.db.product.findUnique({
					where: { productId },
				});
				if (!product) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Product not found",
					});
				}
				if (product.clubShortName !== user.clubShortName) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Product does not belong to your club",
					});
				}
				// Product category validation removed — old enum-based check replaced by
				// hierarchical ProductCategory model (Phase 5a). Any product can link to any event.
			}

			// Validate RRULE if provided
			if (rrule) {
				try {
					RRule.fromString(rrule);
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid recurrence rule format",
					});
				}
			}

			// Check for conflicts if a resource is assigned. Post-CR-c Tier A this also
			// surfaces recurring-event occurrences that overlap the slot. Error message
			// names the conflict and includes the date when the conflict is a recurring
			// occurrence (CR-c.2), so staff aren't left guessing which Tuesday the
			// existing weekly class was on.
			// A BOOKABLE event can reserve multiple courts (primary `resourceId` +
			// additional `resourceIds`). Check each court for conflicts. QUICK version
			// (see designFiles/drop-in/multi-court-conflict-TODO.md): this catches
			// overlaps against any event holding a court as its PRIMARY resourceId, but
			// `checkResourceConflicts` does NOT match existing events by their
			// `resourceIds` array — so two multi-court events sharing an extra court
			// won't conflict-detect. Tracked as a known gap.
			const courtsToCheck = Array.from(
				new Set(
					[resourceId, ...(resourceIds ?? [])].filter(
						(id): id is string => !!id,
					),
				),
			);
			if (courtsToCheck.length > 0 && !allDay) {
				for (const court of courtsToCheck) {
					// Tier A: single-occurrence check. Surfaces both non-recurring overlaps
					// and existing recurring-event occurrences that fall in [start, end].
					const conflicts = await checkResourceConflicts({
						db: ctx.db,
						resourceId: court,
						start,
						end,
					});
					if (conflicts.length > 0) {
						// Lazy timezone lookup — only fires on the unhappy path. Use the user's
						// effective facility (the one this event would belong to) so the error
						// renders in the same zone the calendar is showing.
						const facilityIdForTz = input.facilityId ?? user.activeFacilityId;
						const facility = facilityIdForTz
							? await ctx.db.clubFacility.findUnique({
									where: { facilityId: facilityIdForTz },
									select: { timezone: true },
								})
							: null;
						const c = conflicts[0]!;
						const timeStr = formatEventTimeInZone(
							c.start,
							c.end,
							facility?.timezone ?? null,
							{ includeDate: c.isRecurringOccurrence },
						);
						throw new TRPCError({
							code: "CONFLICT",
							message: `Blocked by "${c.title}" (${timeStr})`,
						});
					}

					// Tier B: if the new event is itself recurring, expand its rrule and
					// check each occurrence against existing events on the resource. Catches
					// the "weekly class for 6 months conflicts with existing weekly class on
					// 4 Tuesdays" case that Tier A's single-slot check would miss.
					if (rrule) {
						const recurringConflicts = await checkRecurringEventConflicts({
							db: ctx.db,
							resourceId: court,
							rruleString: rrule,
							dtstart: start,
							durationMs: end.getTime() - start.getTime(),
						});
						if (recurringConflicts.length > 0) {
							const facilityIdForTz = input.facilityId ?? user.activeFacilityId;
							const facility = facilityIdForTz
								? await ctx.db.clubFacility.findUnique({
										where: { facilityId: facilityIdForTz },
										select: { timezone: true },
									})
								: null;
							throw new TRPCError({
								code: "CONFLICT",
								message: formatRecurringConflictsMessage(
									recurringConflicts,
									facility?.timezone ?? null,
								),
							});
						}
					}
				}
			}

			// Pre-generate eventId so uid can be set in a single create call
			const eventId = crypto.randomUUID();
			const uid = `${eventId}@facilitypresence.com`;

			// Use provided facilityId, or default to user's active facility
			const effectiveFacilityId = input.facilityId ?? user.activeFacilityId;
			if (!effectiveFacilityId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"A facility must be selected. Please set your active facility in profile settings.",
				});
			}

			// Verify the resolved facility belongs to the user's club and is active.
			// Without this guard a stale activeFacilityId pointing to a different club
			// (legacy data, deactivated facility, manual DB edit) would silently create
			// orphan rows where CalendarEvent.clubShortName != ClubFacility.clubShortName.
			const facility = await ctx.db.clubFacility.findUnique({
				where: { facilityId: effectiveFacilityId },
				select: { clubShortName: true, isActive: true },
			});
			if (!facility || facility.clubShortName !== user.clubShortName) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Selected facility does not belong to your club.",
				});
			}
			if (!facility.isActive) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Selected facility is inactive.",
				});
			}

			const event = await ctx.db.calendarEvent.create({
				data: {
					eventId,
					clubShortName: user.clubShortName,
					resourceId,
					facilityId: effectiveFacilityId,
					resourceIds: resourceIds ?? [],
					title,
					description,
					start,
					end,
					allDay: allDay ?? false,
					color,
					backgroundColor,
					uid,
					rrule,
					eventType,
					isBlocking: eventType !== "COACHING_SLOT", // COACHING_SLOT is non-blocking availability, block and bookable are blocking
					isPublic: effectiveIsPublic,
					maxParticipants,
					registrationType,
					productId,
					creditCost: productId ? (creditCost ?? 1) : null,
					createdByUserId: user.userId,
				},
			});

			return event;
		}),

	getEvents: protectedProcedure
		.input(getEventsSchema)
		.query(async ({ ctx, input }) => {
			const { startDate, endDate, facilityId } = input;
			const user = await getCurrentUser(ctx);

			// Use provided facilityId, fall back to user's active facility
			const effectiveFacilityId = facilityId ?? user.activeFacilityId;

			const isStudent = user.userType === "STUDENT";

			// Student visibility filters — applied inside each OR branch so they don't
			// accidentally AND with OR clauses (which would break modified-instance lookup)
			const studentVisibility = isStudent
				? {
						isPublic: true as const,
						eventType: { in: ["BOOKABLE" as const, "COACHING_SLOT" as const] },
					}
				: {};

			const events = await ctx.db.calendarEvent.findMany({
				where: {
					clubShortName: user.clubShortName,
					isDeleted: false,
					// Filter by facility when set
					...(effectiveFacilityId ? { facilityId: effectiveFacilityId } : {}),
					OR: [
						// Non-recurring base events that overlap with view range
						{
							...studentVisibility,
							rrule: null,
							parentEventId: null,
							start: { lt: endDate },
							end: { gt: startDate },
						},
						// Recurring base events (client expands via rrule.js)
						{
							...studentVisibility,
							rrule: { not: null },
							parentEventId: null,
							start: { lt: endDate },
						},
						// Modified instances whose parent base event overlaps the range
						{
							...studentVisibility,
							parentEventId: { not: null },
							start: { lt: endDate },
							end: { gt: startDate },
						},
					],
				},
				include: {
					resource: {
						select: {
							title: true,
							color: true,
						},
					},
					product: {
						select: {
							priceInCents: true,
						},
					},
					createdByUser: {
						select: {
							firstName: true,
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
			});

			// Filter recurring events: only include if series hasn't expired
			const filteredEvents = events.filter((event) => {
				if (!event.rrule) return true;

				// Parse RRULE to check if series is still active
				try {
					const rule = RRule.fromString(event.rrule);
					const options = rule.origOptions;

					// If no until, or until >= startDate, include it
					if (!options.until) return true;
					return options.until >= startDate;
				} catch {
					return false;
				}
			});

			return {
				events: filteredEvents.map((e) => ({
					eventId: e.eventId,
					resourceId: e.resourceId,
					resourceIds: e.resourceIds,
					title: e.title,
					description: e.description,
					start: e.start,
					end: e.end,
					allDay: e.allDay,
					color: e.color,
					backgroundColor: e.backgroundColor,
					uid: e.uid,
					rrule: e.rrule,
					exdates: e.exdates,
					recurrenceId: e.recurrenceId,
					parentEventId: e.parentEventId,
					eventType: e.eventType,
					isBlocking: e.isBlocking,
					isPublic: e.isPublic,
					maxParticipants: e.maxParticipants,
					productId: e.productId,
					product: e.product,
					_count: { registrations: e._count.registrations },
					createdByUserId: e.createdByUserId,
					createdByUser: e.createdByUser,
				})),
			};
		}),

	updateEvent: staffProcedure
		.input(updateEventSchema)
		.mutation(async ({ ctx, input }) => {
			const { eventId, ...data } = input;
			const user = ctx.user;
			const isFacilityOrAdmin = isFacilityOrAbove(user);
			const isCoach = user.userType === UserType.COACH;

			// Verify ownership and not deleted. Include facility timezone so any later
			// conflict error message can render in the right zone without an extra query
			// (CR-c Tier A).
			const existing = await ctx.db.calendarEvent.findUnique({
				where: { eventId },
				include: { facility: { select: { timezone: true } } },
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Event not found",
				});
			}

			requireSameClub(user, existing.clubShortName);

			// Guard: rental events must be managed through the rentals router
			if (
				existing.eventType === "RENTAL_WINDOW" ||
				existing.eventType === "RENTAL_BOOKING"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Rental events must be managed from the Court Rentals page.",
				});
			}

			// Coaches can only update their own events
			if (isCoach && existing.createdByUserId !== user.userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Coaches can only edit their own events",
				});
			}

			if (existing.isDeleted) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot update deleted event",
				});
			}

			// Validate end > start if times are changing
			const newStart = data.start ?? existing.start;
			const newEnd = data.end ?? existing.end;
			const isAllDay = data.allDay ?? existing.allDay;
			if (!isAllDay && (data.start !== undefined || data.end !== undefined)) {
				try {
					validateDateRange(newStart, newEnd);
				} catch {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "End time must be after start time",
					});
				}
			}

			// If resourceId changing, verify new resource belongs to same club
			if (data.resourceId !== undefined && data.resourceId !== null) {
				const resource = await ctx.db.clubResource.findUnique({
					where: { resourceId: data.resourceId },
				});

				if (!resource) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Resource not found",
					});
				}

				requireSameClub(user, resource.clubShortName);
			}

			// Validate productId if changing: must belong to same club and match event's category
			if (data.productId) {
				const product = await ctx.db.product.findUnique({
					where: { productId: data.productId },
				});
				if (!product) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Product not found",
					});
				}
				if (product.clubShortName !== user.clubShortName) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Product does not belong to your club",
					});
				}
				// Product category validation removed — old enum-based check replaced by
				// hierarchical ProductCategory model (Phase 5a). Any product can link to any event.
			}

			// Validate RRULE if changing
			if (data.rrule !== undefined && data.rrule !== null) {
				try {
					RRule.fromString(data.rrule);
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid recurrence rule format",
					});
				}
			}

			// Check for conflicts if resource or time is changing. A BOOKABLE event may
			// hold multiple courts (primary + additional resourceIds) — check each.
			// QUICK version, same known gap as createEvent (see designFiles TODO).
			const newResourceId = data.resourceId ?? existing.resourceId;
			const newResourceIds = data.resourceIds ?? existing.resourceIds;
			const courtsToCheck = Array.from(
				new Set(
					[newResourceId, ...(newResourceIds ?? [])].filter(
						(id): id is string => !!id,
					),
				),
			);

			if (courtsToCheck.length > 0 && !isAllDay) {
				// Tier B: if the event remains (or becomes) recurring after this update,
				// expand the new rrule and check each occurrence. CR-c.13: if the update
				// clears rrule (recurring → non-recurring), the Tier A check below is
				// sufficient and we skip Tier B.
				const newRrule = data.rrule !== undefined ? data.rrule : existing.rrule;
				for (const court of courtsToCheck) {
					// Tier A: single-occurrence check, see comment in createEvent.
					const conflicts = await checkResourceConflicts({
						db: ctx.db,
						resourceId: court,
						start: newStart,
						end: newEnd,
						excludeEventId: eventId,
					});
					if (conflicts.length > 0) {
						// `existing.facility.timezone` was joined above (CR-c Tier A) — no
						// extra query needed for the error formatter.
						const c = conflicts[0]!;
						const timeStr = formatEventTimeInZone(
							c.start,
							c.end,
							existing.facility?.timezone ?? null,
							{ includeDate: c.isRecurringOccurrence },
						);
						throw new TRPCError({
							code: "CONFLICT",
							message: `Blocked by "${c.title}" (${timeStr})`,
						});
					}

					if (newRrule) {
						const recurringConflicts = await checkRecurringEventConflicts({
							db: ctx.db,
							resourceId: court,
							rruleString: newRrule,
							dtstart: newStart,
							durationMs: newEnd.getTime() - newStart.getTime(),
							exdates: existing.exdates,
							excludeEventId: eventId,
						});
						if (recurringConflicts.length > 0) {
							throw new TRPCError({
								code: "CONFLICT",
								message: formatRecurringConflictsMessage(
									recurringConflicts,
									existing.facility?.timezone ?? null,
								),
							});
						}
					}
				}
			}

			const { scope = "ALL", instanceDate, ...eventData } = data;

			// ALL (default): update the whole series / non-recurring event
			if (scope === "ALL" || !existing.rrule) {
				const updated = await ctx.db.calendarEvent.update({
					where: { eventId },
					data: eventData,
				});
				return updated;
			}

			if (!instanceDate) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "instanceDate is required for THIS or THIS_AND_FUTURE scope",
				});
			}

			// THIS: exclude just this occurrence via exdate, no changes to series
			if (scope === "THIS") {
				if (
					existing.eventType === "BOOKABLE" ||
					existing.eventType === "COACHING_SLOT"
				) {
					const instanceRegs = await ctx.db.eventRegistration.count({
						where: {
							eventId,
							instanceDate,
							status: {
								in: [
									RegistrationStatus.REGISTERED,
									RegistrationStatus.CHECKED_IN,
								],
							},
						},
					});
					if (instanceRegs > 0) {
						// TODO: instead of blocking, migrate these registrations to a new detached occurrence
						// event (parentEventId = eventId) and cancel the originals on the base series.
						throw new TRPCError({
							code: "BAD_REQUEST",
							message:
								"Cannot remove this occurrence — it has active registrations. Cancel them first.",
						});
					}
				}
				const currentExdates: Date[] =
					(existing.exdates as Date[] | null) ?? [];
				await ctx.db.calendarEvent.update({
					where: { eventId },
					data: { exdates: [...currentExdates, instanceDate] },
				});
				return existing;
			}

			// THIS_AND_FUTURE is blocked for registerable event types until registration migration is implemented
			// TODO: when unblocked, re-point forward registrations (instanceDate >= split point) from
			// the old eventId to the newly created series eventId, preserving status and instanceDate.
			if (
				existing.eventType === "BOOKABLE" ||
				existing.eventType === "COACHING_SLOT"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"'This and following' edits are not yet supported for events with registrations. Use 'All events' or edit instances individually.",
				});
			}

			// THIS_AND_FUTURE: truncate existing series and create new series from instanceDate
			const existingRule = RRule.fromString(existing.rrule);
			const truncateUntil = new Date(
				instanceDate.getTime() - 24 * 60 * 60 * 1000,
			); // day before
			const truncatedOptions = {
				...existingRule.origOptions,
				until: truncateUntil,
			};
			delete truncatedOptions.count; // prefer UNTIL over COUNT
			const truncatedRRule = new RRule(truncatedOptions).toString();

			// Truncate the original series
			await ctx.db.calendarEvent.update({
				where: { eventId },
				data: { rrule: truncatedRRule },
			});

			// Build new series options — same rule but starting from instanceDate, no UNTIL
			const newRRuleOptions = { ...existingRule.origOptions };
			delete newRRuleOptions.until;
			delete newRRuleOptions.count;
			const newRRule = new RRule(newRRuleOptions).toString();

			const duration = existing.end.getTime() - existing.start.getTime();
			const seriesStart = instanceDate;
			const seriesEnd = new Date(instanceDate.getTime() + duration);

			const newEventId = crypto.randomUUID();
			const created = await ctx.db.calendarEvent.create({
				data: {
					eventId: newEventId,
					uid: `${newEventId}@facilitypresence.com`,
					clubShortName: existing.clubShortName,
					facilityId: existing.facilityId,
					createdByUserId: existing.createdByUserId,
					eventType: existing.eventType,
					title: eventData.title ?? existing.title,
					description: eventData.description ?? existing.description,
					start: seriesStart,
					end: seriesEnd,
					allDay: eventData.allDay ?? existing.allDay,
					rrule: newRRule,
					color: eventData.color ?? existing.color,
					backgroundColor:
						eventData.backgroundColor ?? existing.backgroundColor,
					resourceId: eventData.resourceId ?? existing.resourceId,
					productId: eventData.productId ?? existing.productId,
					isPublic: existing.isPublic,
					maxParticipants: existing.maxParticipants,
					registrationType: existing.registrationType,
					showRegistrantNames: existing.showRegistrantNames,
					isBlocking: existing.isBlocking,
				},
			});

			return created;
		}),

	deleteEvent: staffProcedure
		.input(deleteEventSchema)
		.mutation(async ({ ctx, input }) => {
			const { eventId } = input;
			const user = ctx.user;
			const isFacilityOrAdmin = isFacilityOrAbove(user);
			const isCoach = user.userType === UserType.COACH;

			// Verify ownership
			const existing = await ctx.db.calendarEvent.findUnique({
				where: { eventId },
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Event not found",
				});
			}

			requireSameClub(user, existing.clubShortName);

			// Guard: rental events must be managed through the rentals router
			if (
				existing.eventType === "RENTAL_WINDOW" ||
				existing.eventType === "RENTAL_BOOKING"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Rental events must be managed from the Court Rentals page.",
				});
			}

			// Coaches can only delete their own events
			if (isCoach && existing.createdByUserId !== user.userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Coaches can only delete their own events",
				});
			}

			const { scope = "ALL", instanceDate } = input;
			const now = new Date();

			// ALL (default): soft-delete the whole series / non-recurring event
			if (scope === "ALL" || !existing.rrule) {
				await ctx.db.calendarEvent.update({
					where: { eventId },
					data: { isDeleted: true, deletedAt: now },
				});
				if (!existing.parentEventId) {
					await ctx.db.calendarEvent.updateMany({
						where: { parentEventId: eventId },
						data: { isDeleted: true, deletedAt: now },
					});
				}
				return { success: true };
			}

			if (!instanceDate) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "instanceDate is required for THIS or THIS_AND_FUTURE scope",
				});
			}

			// THIS: add instanceDate to exdates (exclude this occurrence only)
			if (scope === "THIS") {
				if (
					existing.eventType === "BOOKABLE" ||
					existing.eventType === "COACHING_SLOT"
				) {
					const instanceRegs = await ctx.db.eventRegistration.count({
						where: {
							eventId,
							instanceDate,
							status: {
								in: [
									RegistrationStatus.REGISTERED,
									RegistrationStatus.CHECKED_IN,
								],
							},
						},
					});
					if (instanceRegs > 0) {
						// TODO: instead of blocking, migrate these registrations to a new detached occurrence
						// event (parentEventId = eventId) and cancel the originals on the base series.
						throw new TRPCError({
							code: "BAD_REQUEST",
							message:
								"Cannot delete this occurrence — it has active registrations. Cancel them first.",
						});
					}
				}
				const currentExdates: Date[] =
					(existing.exdates as Date[] | null) ?? [];
				await ctx.db.calendarEvent.update({
					where: { eventId },
					data: { exdates: [...currentExdates, instanceDate] },
				});
				return { success: true };
			}

			// THIS_AND_FUTURE is blocked for registerable event types until registration migration is implemented
			// TODO: when unblocked, re-point forward registrations (instanceDate >= split point) from
			// the old eventId to the newly created series eventId, preserving status and instanceDate.
			if (
				existing.eventType === "BOOKABLE" ||
				existing.eventType === "COACHING_SLOT"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"'This and following' edits are not yet supported for events with registrations. Use 'All events' or edit instances individually.",
				});
			}

			// THIS_AND_FUTURE: truncate series UNTIL to day before instanceDate
			const existingRule = RRule.fromString(existing.rrule);
			const truncateUntil = new Date(
				instanceDate.getTime() - 24 * 60 * 60 * 1000,
			);
			const truncatedOptions = {
				...existingRule.origOptions,
				until: truncateUntil,
			};
			delete truncatedOptions.count;
			const truncatedRRule = new RRule(truncatedOptions).toString();

			await ctx.db.calendarEvent.update({
				where: { eventId },
				data: { rrule: truncatedRRule },
			});

			return { success: true };
		}),

	getEventById: protectedProcedure
		.input(getEventByIdSchema)
		.query(async ({ ctx, input }) => {
			const { eventId } = input;
			const user = await getCurrentUser(ctx);

			const event = await ctx.db.calendarEvent.findUnique({
				where: { eventId, isDeleted: false },
				include: {
					resource: { select: { title: true, color: true } },
					product: {
						select: {
							productId: true,
							name: true,
							priceInCents: true,
							currency: true,
						},
					},
					createdByUser: { select: { firstName: true, lastName: true } },
					bookingBlockEvent: {
						select: { rentalWindowEventId: true },
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
			});

			if (!event) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
			}

			requireSameClub(user, event.clubShortName);

			return event;
		}),

	getPublicEventById: publicProcedure
		.input(getEventByIdSchema)
		.query(async ({ ctx, input }) => {
			const { eventId } = input;

			const event = await ctx.db.calendarEvent.findUnique({
				where: { eventId, isDeleted: false },
				include: {
					resource: { select: { title: true, color: true } },
					product: {
						select: {
							productId: true,
							name: true,
							priceInCents: true,
							currency: true,
						},
					},
					createdByUser: {
						select: {
							firstName: true,
							lastName: true,
							coachProfile: { select: { displayUsername: true } },
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
			});

			if (!event) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
			}

			// Private events are only visible to authenticated members of the same club
			if (!event.isPublic) {
				const clerkUserId = ctx.auth.userId;
				if (!clerkUserId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "Sign in to view this event",
					});
				}
				const viewer = await ctx.db.user.findUnique({ where: { clerkUserId } });
				if (!viewer || viewer.clubShortName !== event.clubShortName) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You do not have access to this event",
					});
				}
			}

			if (event.showRegistrantNames) {
				const registrants = await ctx.db.eventRegistration.findMany({
					where: {
						eventId,
						status: {
							in: [
								RegistrationStatus.REGISTERED,
								RegistrationStatus.CHECKED_IN,
							],
						},
					},
					include: { user: { select: { firstName: true, lastName: true } } },
					orderBy: { createdAt: "asc" },
				});
				return {
					...event,
					registrants: registrants.map((r) => ({
						firstName: r.user.firstName,
						lastInitial: r.user.lastName ? r.user.lastName[0] + "." : "",
					})),
				};
			}
			return { ...event, registrants: [] };
		}),

	updateEventDetails: facilityProcedure
		.input(updateEventDetailsSchema)
		.mutation(async ({ ctx, input }) => {
			const { eventId, ...data } = input;

			const existing = await ctx.db.calendarEvent.findUnique({
				where: { eventId, isDeleted: false },
			});

			if (!existing) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
			}

			requireSameClub(ctx.user, existing.clubShortName);

			const updated = await ctx.db.calendarEvent.update({
				where: { eventId },
				data,
			});

			return updated;
		}),

	checkConflicts: protectedProcedure
		.input(checkConflictsSchema)
		.query(async ({ ctx, input }) => {
			const { resourceId, start, end, excludeEventId } = input;
			const user = await getCurrentUser(ctx);

			// Verify resource belongs to user's club
			const resource = await ctx.db.clubResource.findUnique({
				where: { resourceId },
			});

			if (!resource) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Resource not found",
				});
			}

			requireSameClub(user, resource.clubShortName);

			// Find non-recurring, blocking events that overlap
			const nonRecurringConflicts = await ctx.db.calendarEvent.findMany({
				where: {
					resourceId,
					isDeleted: false,
					isBlocking: true,
					rrule: null,
					eventId: excludeEventId ? { not: excludeEventId } : undefined,
					start: { lt: end },
					end: { gt: start },
				},
				select: {
					eventId: true,
					title: true,
					start: true,
					end: true,
				},
			});

			// Find recurring, blocking events and expand them
			const recurringEvents = await ctx.db.calendarEvent.findMany({
				where: {
					resourceId,
					isDeleted: false,
					isBlocking: true,
					rrule: { not: null },
					eventId: excludeEventId ? { not: excludeEventId } : undefined,
				},
			});

			const recurringConflicts: Array<{
				eventId: string;
				title: string;
				start: Date;
				end: Date;
			}> = [];

			for (const event of recurringEvents) {
				if (!event.rrule) continue;

				try {
					const rule = RRule.fromString(event.rrule);
					const duration = event.end.getTime() - event.start.getTime();
					const exdateSet = new Set(event.exdates.map((d) => d.toISOString()));

					// Get instances in the conflict range
					const instances = rule.between(start, end, true);

					for (const instanceStart of instances) {
						// Skip exdated instances
						if (exdateSet.has(instanceStart.toISOString())) continue;

						const instanceEnd = new Date(instanceStart.getTime() + duration);

						// Check if this instance overlaps with the input range
						if (instanceStart < end && instanceEnd > start) {
							recurringConflicts.push({
								eventId: event.eventId,
								title: event.title,
								start: instanceStart,
								end: instanceEnd,
							});
						}
					}
				} catch {
					// Invalid RRULE, skip
				}
			}

			const allConflicts = [...nonRecurringConflicts, ...recurringConflicts];

			return {
				hasConflicts: allConflicts.length > 0,
				conflicts: allConflicts,
			};
		}),

	// ============ PUBLIC PROCEDURES (Phase 2.5+) ============

	getPublicEvents: publicProcedure
		.input(getPublicEventsSchema)
		.query(async ({ ctx, input }) => {
			const { clubShortName, startDate, endDate, facilityId } = input;

			const events = await ctx.db.calendarEvent.findMany({
				where: {
					clubShortName,
					isDeleted: false,
					isPublic: true,
					eventType: { in: [EventType.BOOKABLE, EventType.COACHING_SLOT] },
					...(facilityId ? { facilityId } : {}),
					OR: [
						{
							rrule: null,
							start: { lt: endDate },
							end: { gt: startDate },
						},
						{
							rrule: { not: null },
							start: { lt: endDate },
						},
					],
				},
				include: {
					resource: {
						select: {
							title: true,
							color: true,
						},
					},
					product: {
						select: {
							priceInCents: true,
						},
					},
					createdByUser: {
						select: {
							firstName: true,
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
			});

			// Filter recurring events
			const filteredEvents = events.filter((event) => {
				if (!event.rrule) return true;
				try {
					const rule = RRule.fromString(event.rrule);
					const options = rule.origOptions;
					if (!options.until) return true;
					return options.until >= startDate;
				} catch {
					return false;
				}
			});

			return {
				events: filteredEvents.map((e) => ({
					eventId: e.eventId,
					resourceId: e.resourceId,
					eventType: e.eventType,
					title: e.title,
					description: e.description,
					start: e.start,
					end: e.end,
					maxParticipants: e.maxParticipants,
					currentRegistrations: e._count.registrations,
					priceInCents: e.product?.priceInCents ?? null,
					productId: e.productId,
					coachName: e.createdByUser?.firstName ?? null,
					rrule: e.rrule,
					uid: e.uid,
					color: e.color ?? null,
					backgroundColor: e.backgroundColor ?? null,
				})),
			};
		}),

	// Public "next N upcoming events" for a club (optionally a single facility) —
	// the home page's UpcomingEventsCard, but for logged-out club landing pages.
	// Recurrence-aware: expands each series to its next occurrence (honoring
	// exdates + modified instances), mirroring getMyUpcomingEvents but sourced
	// from public events rather than the viewer's registrations (so no status).
	getPublicUpcomingEvents: publicProcedure
		.input(
			z.object({
				clubShortName: z.string(),
				facilityId: z.string().optional(),
				limit: z.number().int().min(1).max(20).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const limit = input.limit ?? 5;
			const now = new Date();

			const events = await ctx.db.calendarEvent.findMany({
				where: {
					clubShortName: input.clubShortName,
					isDeleted: false,
					isPublic: true,
					eventType: { in: [EventType.BOOKABLE, EventType.COACHING_SLOT] },
					...(input.facilityId ? { facilityId: input.facilityId } : {}),
					// Base/standalone events only — modified series instances are folded
					// into their parent below so they don't appear twice.
					parentEventId: null,
				},
				select: {
					eventId: true,
					title: true,
					start: true,
					end: true,
					eventType: true,
					rrule: true,
					exdates: true,
					maxParticipants: true,
					color: true,
					backgroundColor: true,
					productId: true,
					product: { select: { priceInCents: true } },
					resource: { select: { title: true } },
					facility: { select: { name: true } },
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
			});

			type PublicUpcomingEvent = {
				eventId: string;
				title: string;
				eventType: EventType;
				start: Date;
				end: Date;
				maxParticipants: number | null;
				currentRegistrations: number;
				priceInCents: number | null;
				productId: string | null;
				color: string | null;
				backgroundColor: string | null;
				resourceTitle: string | null;
				facilityName: string | null;
			};

			const shape = (
				e: (typeof events)[number],
				occStart: Date,
			): PublicUpcomingEvent => {
				const durationMs = e.end.getTime() - e.start.getTime();
				return {
					eventId: e.eventId,
					title: e.title,
					eventType: e.eventType,
					start: occStart,
					end: new Date(occStart.getTime() + durationMs),
					maxParticipants: e.maxParticipants,
					currentRegistrations: e._count.registrations,
					priceInCents: e.product?.priceInCents ?? null,
					productId: e.productId,
					color: e.color,
					backgroundColor: e.backgroundColor,
					resourceTitle: e.resource?.title ?? null,
					facilityName: e.facility?.name ?? null,
				};
			};

			// Batch-fetch modified instances for recurring base events (avoid N+1).
			const recurringIds = events.filter((e) => e.rrule).map((e) => e.eventId);
			const children = recurringIds.length
				? await ctx.db.calendarEvent.findMany({
						where: {
							parentEventId: { in: recurringIds },
							isDeleted: false,
						},
						select: { parentEventId: true, recurrenceId: true, start: true },
					})
				: [];
			const childrenByParent = new Map<string, typeof children>();
			for (const child of children) {
				if (!child.parentEventId) continue;
				const list = childrenByParent.get(child.parentEventId) ?? [];
				list.push(child);
				childrenByParent.set(child.parentEventId, list);
			}

			const items: PublicUpcomingEvent[] = [];
			for (const e of events) {
				if (e.rrule) {
					const eventChildren = childrenByParent.get(e.eventId) ?? [];
					const childExdates = eventChildren
						.map((c) => (c.recurrenceId ? new Date(c.recurrenceId) : null))
						.filter((d): d is Date => d !== null);
					let nextRrule: Date | null = null;
					try {
						nextRrule = buildRuleSetFromEvent(
							e.rrule,
							[...e.exdates, ...childExdates],
							e.start,
						).after(now, true);
					} catch {
						nextRrule = null;
					}
					const futureChildStarts = eventChildren
						.filter((c) => c.start.getTime() >= now.getTime())
						.map((c) => c.start);
					const nextChild =
						futureChildStarts.length > 0
							? futureChildStarts.reduce((a, d) => (d < a ? d : a))
							: null;
					const candidates = [nextRrule, nextChild].filter(
						(d): d is Date => d !== null,
					);
					if (candidates.length === 0) continue;
					items.push(
						shape(
							e,
							candidates.reduce((a, d) => (d < a ? d : a)),
						),
					);
				} else {
					const item = shape(e, e.start);
					// Keep events that haven't ended yet (in-progress or future).
					if (item.end.getTime() >= now.getTime()) items.push(item);
				}
			}

			items.sort((a, b) => a.start.getTime() - b.start.getTime());

			return { events: items.slice(0, limit) };
		}),

	getPublicResources: publicProcedure
		.input(getPublicResourcesSchema)
		.query(async ({ ctx, input }) => {
			const { clubShortName, facilityId } = input;

			const resources = await ctx.db.clubResource.findMany({
				where: {
					clubShortName,
					isActive: true,
					...(facilityId ? { facilityId } : {}),
				},
				include: {
					businessHours: true,
				},
				orderBy: {
					position: "asc",
				},
			});

			return {
				resources: resources.map((r) => ({
					resourceId: r.resourceId,
					title: r.title,
					description: r.description,
					color: r.color,
					backgroundColor: r.backgroundColor,
					position: r.position,
					businessHours: r.businessHours.map((bh) => ({
						daysOfWeek: bh.daysOfWeek,
						startTime: bh.startTime,
						endTime: bh.endTime,
					})),
				})),
			};
		}),

	getPublicFacilities: publicProcedure
		.input(getPublicFacilitiesSchema)
		.query(async ({ ctx, input }) => {
			const facilities = await ctx.db.clubFacility.findMany({
				where: { clubShortName: input.clubShortName, isActive: true },
				orderBy: { position: "asc" },
				select: { facilityId: true, name: true },
			});
			return facilities.map((f) => ({
				facilityId: f.facilityId,
				facilityName: f.name,
			}));
		}),

	// ============ REGISTRATION ============

	registerForEvent: protectedProcedure
		.input(registerForEventSchema)
		.mutation(async ({ ctx, input }) => {
			const { eventId, instanceDate } = input;
			const user = await getCurrentUser(ctx);

			// Only students can self-register
			if (user.userType !== UserType.STUDENT) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only students can register for events",
				});
			}

			// Validate event + capacity + no-duplicate (shared with staffRegister)
			const event = await assertRegistrable({
				db: ctx.db,
				eventId,
				userId: user.userId,
				instanceDate,
				selfServe: true,
			});

			// Private events: registrant must be a member of the same club.
			// (This gate is self-serve only — staffRegister already same-club-scopes.)
			if (!event.isPublic && user.clubShortName !== event.clubShortName) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "This event is not open for registration",
				});
			}

			const registration = await ctx.db.$transaction((tx) =>
				createRegistrationTx({
					tx,
					event,
					userId: user.userId,
					instanceDate,
					source: "self_service",
					changedByUserId: user.userId,
				}),
			);

		// Fire-and-forget: confirm registration by email. Failure must not roll back.
		void sendRegistrationConfirmationEmail(
			ctx.db,
			registration.registrationId,
		).catch((err: unknown) => {
			console.error(
				`[registerForEvent] confirmation email failed for registration ${registration.registrationId}:`,
				err,
			);
		});

			return { registrationId: registration.registrationId };
		}),

	// Staff registering another member for an event. Shares capacity /
	// duplicate / credit-deduction logic with `registerForEvent` via
	// `~/server/utils/eventRegistration`. This procedure only layers on the
	// staff-specific scope check (target must be in the staff's club).
	staffRegister: facilityProcedure
		.input(staffRegisterSchema)
		.mutation(async ({ ctx, input }) => {
			const { eventId, userId, instanceDate } = input;
			const staffUser = ctx.user;

			// Target must belong to the same club as the acting staff
			const target = await ctx.db.user.findUnique({
				where: { userId },
				select: { userId: true, clubShortName: true },
			});

			if (!target || target.clubShortName !== staffUser.clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found in your club",
				});
			}

			// Validate event + capacity + no-duplicate (shared with registerForEvent)
			const event = await assertRegistrable({
				db: ctx.db,
				eventId,
				userId: target.userId,
				instanceDate,
				selfServe: false,
			});

			// Staff can only register members for events in their own club
			requireSameClub(staffUser, event.clubShortName);

			const registration = await ctx.db.$transaction((tx) =>
				createRegistrationTx({
					tx,
					event,
					userId: target.userId,
					instanceDate,
					source: "admin_dashboard",
					changedByUserId: staffUser.userId,
				}),
			);

		// Fire-and-forget: confirm registration by email. Failure must not roll back.
		void sendRegistrationConfirmationEmail(
			ctx.db,
			registration.registrationId,
		).catch((err: unknown) => {
			console.error(
				`[staffRegister] confirmation email failed for registration ${registration.registrationId}:`,
				err,
			);
		});

			return { registration };
		}),

	cancelRegistration: protectedProcedure
		.input(cancelRegistrationSchema)
		.mutation(async ({ ctx, input }) => {
			const { registrationId } = input;
			const user = await getCurrentUser(ctx);

			const registration = await ctx.db.eventRegistration.findUnique({
				where: { registrationId },
				include: {
					event: {
						select: {
							clubShortName: true,
						},
					},
				},
			});

			if (!registration) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Registration not found",
				});
			}

			requireSameClub(user, registration.event.clubShortName);

			// Students can only cancel their own; facility/admin can cancel any in their club
			const isFacilityOrAdmin = isFacilityOrAbove(user);
			if (!isFacilityOrAdmin && registration.userId !== user.userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only cancel your own registration",
				});
			}

			if (registration.status !== RegistrationStatus.REGISTERED) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only registered (active) registrations can be cancelled",
				});
			}

			await ctx.db.$transaction(async (tx) => {
				await tx.eventRegistration.update({
					where: { registrationId },
					data: { status: RegistrationStatus.LATE_CANCEL },
				});

				await tx.registrationStatusLog.create({
					data: {
						clubShortName: user.clubShortName,
						registrationId,
						userId: registration.userId,
						changedByUserId: user.userId,
						oldStatus: RegistrationStatus.REGISTERED,
						newStatus: RegistrationStatus.LATE_CANCEL,
						source: isFacilityOrAbove(user)
							? "admin_dashboard"
							: "self_service",
					},
				});
			});

			return { success: true };
		}),

	getMyRegistrations: protectedProcedure.query(async ({ ctx }) => {
		const user = await getCurrentUser(ctx);

		const registrations = await ctx.db.eventRegistration.findMany({
			where: {
				userId: user.userId,
				status: RegistrationStatus.REGISTERED,
			},
			include: {
				event: {
					select: {
						eventId: true,
						title: true,
						start: true,
						end: true,
						eventType: true,
						resource: { select: { title: true } },
					},
				},
			},
			orderBy: { createdAt: "desc" },
		});

		return { registrations };
	}),

	// Member dashboard: public, registrable events happening on a given day (today
	// by default, in the member's timezone) at the member's *active facility*.
	// Returns recurring occurrences expanded to that day and each event's
	// registration state, so the dashboard can render registration-aware badges
	// (reusing CalendarEventBadge) that link to the event page.
	getMemberTodayEvents: protectedProcedure
		.input(
			z
				.object({
					date: z.date().optional(),
					// Home events period filter (Today/Tomorrow/This Week/This Month/
					// Custom): an explicit instant range computed client-side on the
					// member's local day boundaries. Takes precedence over `date`.
					rangeStart: z.date().optional(),
					rangeEnd: z.date().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const facilityId = user.activeFacilityId;
			if (!facilityId) {
				return { facility: null, events: [] };
			}

			const facility = await ctx.db.clubFacility.findFirst({
				where: {
					facilityId,
					clubShortName: user.clubShortName,
					isActive: true,
				},
				select: { facilityId: true, name: true, timezone: true },
			});
			if (!facility) {
				return { facility: null, events: [] };
			}

			// "Today" is the member's local day (their timezone), so the dashboard
			// matches what they'd consider today regardless of facility/server tz.
			// An explicit rangeStart/rangeEnd (period filter) overrides the single
			// day; capped at 62 days to bound rrule expansion cost.
			const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;
			let startOfDay: Date;
			let endOfDay: Date;
			if (input?.rangeStart && input?.rangeEnd) {
				const spanMs = input.rangeEnd.getTime() - input.rangeStart.getTime();
				if (spanMs <= 0 || spanMs > MAX_RANGE_MS) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid date range (must be 1–62 days)",
					});
				}
				startOfDay = input.rangeStart;
				endOfDay = input.rangeEnd;
			} else {
				({ startOfDay, endOfDay } = getDayRangeInZone(
					user.timeZone,
					input?.date,
				));
			}

			const candidates = await ctx.db.calendarEvent.findMany({
				where: {
					clubShortName: user.clubShortName,
					facilityId,
					isDeleted: false,
					isPublic: true,
					eventType: {
						in: [
							EventType.BOOKABLE,
							EventType.COACHING_SLOT,
							EventType.DROP_IN,
						],
					},
					OR: [
						{ rrule: null, start: { lt: endOfDay }, end: { gt: startOfDay } },
						{ rrule: { not: null }, start: { lte: endOfDay } },
					],
				},
				include: {
					resource: { select: { title: true, color: true } },
					product: { select: { priceInCents: true } },
					modifiedInstances: {
						where: { isDeleted: false },
						select: { recurrenceId: true },
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
			});

			// My active registrations for these events — to mark badges "registered".
			const myRegs = await ctx.db.eventRegistration.findMany({
				where: {
					userId: user.userId,
					eventId: { in: candidates.map((e) => e.eventId) },
					status: {
						in: [RegistrationStatus.REGISTERED, RegistrationStatus.CHECKED_IN],
					},
				},
				select: { eventId: true, instanceDate: true },
			});
			// PER_SERIES (instanceDate null) covers every occurrence; PER_INSTANCE
			// matches a single occurrence by its start.
			const seriesReg = new Set(
				myRegs.filter((r) => r.instanceDate === null).map((r) => r.eventId),
			);
			const instanceReg = new Set(
				myRegs
					.filter((r) => r.instanceDate !== null)
					.map((r) => `${r.eventId}|${r.instanceDate?.toISOString()}`),
			);

			type DayEvent = {
				eventId: string;
				title: string;
				description: string | null;
				eventType: EventType;
				start: Date;
				end: Date;
				instanceDate: Date | null;
				maxParticipants: number | null;
				currentRegistrations: number;
				priceInCents: number | null;
				productId: string | null;
				creditCost: number | null;
				isFree: boolean;
				isFull: boolean;
				isRegistered: boolean;
				color: string | null;
				backgroundColor: string | null;
				resourceTitle: string | null;
			};

			const toDayEvent = (
				e: (typeof candidates)[number],
				start: Date,
				end: Date,
				instanceDate: Date | null,
			): DayEvent => {
				const currentRegistrations = e._count.registrations;
				const isFree =
					(e.productId === null || e.product?.priceInCents === 0) &&
					(e.creditCost === null || e.creditCost === 0);
				const instanceKey = instanceDate
					? `${e.eventId}|${instanceDate.toISOString()}`
					: null;
				const isRegistered =
					seriesReg.has(e.eventId) ||
					(instanceKey !== null && instanceReg.has(instanceKey));
				return {
					eventId: e.eventId,
					title: e.title,
					description: e.description,
					eventType: e.eventType,
					start,
					end,
					instanceDate,
					maxParticipants: e.maxParticipants,
					currentRegistrations,
					priceInCents: e.product?.priceInCents ?? null,
					productId: e.productId,
					creditCost: e.creditCost,
					isFree,
					isFull:
						e.maxParticipants !== null &&
						currentRegistrations >= e.maxParticipants,
					isRegistered,
					color: e.color,
					backgroundColor: e.backgroundColor,
					resourceTitle: e.resource?.title ?? null,
				};
			};

			const events: DayEvent[] = [];
			for (const e of candidates) {
				if (!e.rrule) {
					events.push(toDayEvent(e, e.start, e.end, null));
					continue;
				}
				// Recurring: expand today's occurrences, honoring exdates and
				// modified-instance overrides (those render as their own rows).
				const durationMs = e.end.getTime() - e.start.getTime();
				const childExdates = e.modifiedInstances
					.map((c) => c.recurrenceId)
					.filter((r): r is string => r !== null)
					.map((r) => new Date(r));
				const ruleSet = buildRuleSetFromEvent(
					e.rrule,
					[...e.exdates, ...childExdates],
					e.start,
				);
				for (const occStart of ruleSet.between(startOfDay, endOfDay, true)) {
					const occEnd = new Date(occStart.getTime() + durationMs);
					events.push(toDayEvent(e, occStart, occEnd, occStart));
				}
			}

			events.sort((a, b) => a.start.getTime() - b.start.getTime());

			return {
				facility: { facilityId: facility.facilityId, name: facility.name },
				events,
			};
		}),

	// Member dashboard: the caller's next N upcoming registered occurrences across
	// all facilities. Mirrors getEventRegistrationsForUser's occurrence logic
	// (PER_INSTANCE/single → instanceDate ?? start; PER_SERIES → next rrule
	// occurrence honoring exdates + modified-instance overrides) but for the
	// current user, merged into one chronological list for the "Your upcoming
	// events" card. Reuses CalendarEventBadge, so returns capacity/price/colors.
	getMyUpcomingEvents: protectedProcedure
		.input(z.object({ limit: z.number().int().min(1).max(20).optional() }))
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const limit = input?.limit ?? 5;
			const now = new Date();

			const registrations = await ctx.db.eventRegistration.findMany({
				where: {
					userId: user.userId,
					status: {
						in: [RegistrationStatus.REGISTERED, RegistrationStatus.CHECKED_IN],
					},
					event: { isDeleted: false },
				},
				include: {
					event: {
						select: {
							eventId: true,
							title: true,
							start: true,
							end: true,
							eventType: true,
							registrationType: true,
							rrule: true,
							exdates: true,
							maxParticipants: true,
							color: true,
							backgroundColor: true,
							productId: true,
							product: { select: { priceInCents: true } },
							resource: { select: { title: true } },
							facility: { select: { name: true } },
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
					},
				},
			});

			type UpcomingEvent = {
				eventId: string;
				title: string;
				eventType: EventType;
				start: Date;
				end: Date;
				status: RegistrationStatus;
				maxParticipants: number | null;
				currentRegistrations: number;
				priceInCents: number | null;
				productId: string | null;
				color: string | null;
				backgroundColor: string | null;
				resourceTitle: string | null;
				facilityName: string | null;
			};

			const shape = (
				r: (typeof registrations)[number],
				occStart: Date,
			): UpcomingEvent => {
				const durationMs = r.event.end.getTime() - r.event.start.getTime();
				return {
					eventId: r.event.eventId,
					title: r.event.title,
					eventType: r.event.eventType,
					start: occStart,
					end: new Date(occStart.getTime() + durationMs),
					status: r.status,
					maxParticipants: r.event.maxParticipants,
					currentRegistrations: r.event._count.registrations,
					priceInCents: r.event.product?.priceInCents ?? null,
					productId: r.event.productId,
					color: r.event.color,
					backgroundColor: r.event.backgroundColor,
					resourceTitle: r.event.resource?.title ?? null,
					facilityName: r.event.facility?.name ?? null,
				};
			};

			const seriesRegs = registrations.filter(
				(r) => r.event.registrationType === RegistrationType.PER_SERIES,
			);

			// Batch-fetch modified instances for series base events (avoid N+1).
			const baseEventIds = seriesRegs.map((r) => r.event.eventId);
			const children = baseEventIds.length
				? await ctx.db.calendarEvent.findMany({
						where: { parentEventId: { in: baseEventIds }, isDeleted: false },
						select: { parentEventId: true, recurrenceId: true, start: true },
					})
				: [];
			const childrenByParent = new Map<string, typeof children>();
			for (const child of children) {
				if (!child.parentEventId) continue;
				const list = childrenByParent.get(child.parentEventId) ?? [];
				list.push(child);
				childrenByParent.set(child.parentEventId, list);
			}

			const items: UpcomingEvent[] = [];
			for (const r of registrations) {
				if (r.event.registrationType === RegistrationType.PER_SERIES) {
					if (!r.event.rrule) continue;
					const eventChildren = childrenByParent.get(r.event.eventId) ?? [];
					const childExdates = eventChildren
						.map((c) => (c.recurrenceId ? new Date(c.recurrenceId) : null))
						.filter((d): d is Date => d !== null);
					let nextRrule: Date | null = null;
					try {
						nextRrule = buildRuleSetFromEvent(
							r.event.rrule,
							[...r.event.exdates, ...childExdates],
							r.event.start,
						).after(now, true);
					} catch {
						nextRrule = null;
					}
					const futureChildStarts = eventChildren
						.filter((c) => c.start.getTime() >= now.getTime())
						.map((c) => c.start);
					const nextChild =
						futureChildStarts.length > 0
							? futureChildStarts.reduce((a, d) => (d < a ? d : a))
							: null;
					const candidates = [nextRrule, nextChild].filter(
						(d): d is Date => d !== null,
					);
					if (candidates.length === 0) continue;
					items.push(
						shape(
							r,
							candidates.reduce((a, d) => (d < a ? d : a)),
						),
					);
				} else {
					const occStart = r.instanceDate ?? r.event.start;
					const item = shape(r, occStart);
					// Keep events that haven't ended yet (in-progress or future).
					if (item.end.getTime() >= now.getTime()) items.push(item);
				}
			}

			items.sort((a, b) => a.start.getTime() - b.start.getTime());

			return { events: items.slice(0, limit) };
		}),

	// Admin-facing: return one user's active EventRegistrations, split by
	// PER_INSTANCE (one occurrence) vs PER_SERIES (whole series). Series rows
	// include the next upcoming session date computed from the rrule plus any
	// modified-instance overrides. PER_INSTANCE rows in the past are filtered
	// out; series with no remaining sessions are filtered out.
	getEventRegistrationsForUser: facilityProcedure
		.input(z.object({ userId: z.string() }))
		.query(async ({ ctx, input }) => {
			const target = await ctx.db.user.findFirst({
				where: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { userId: true },
			});
			if (!target) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User not found in your club.",
				});
			}

			const registrations = await ctx.db.eventRegistration.findMany({
				where: {
					userId: input.userId,
					status: RegistrationStatus.REGISTERED,
				},
				include: {
					event: {
						select: {
							eventId: true,
							title: true,
							start: true,
							end: true,
							eventType: true,
							registrationType: true,
							rrule: true,
							exdates: true,
							resource: { select: { title: true } },
						},
					},
				},
			});

			const now = new Date();

			const eventSignups = registrations
				.filter((r) => r.event.registrationType !== RegistrationType.PER_SERIES)
				.map((r) => ({
					registrationId: r.registrationId,
					createdAt: r.createdAt,
					instanceDate: r.instanceDate,
					occurrenceDate: r.instanceDate ?? r.event.start,
					event: {
						eventId: r.event.eventId,
						title: r.event.title,
						start: r.event.start,
						end: r.event.end,
						eventType: r.event.eventType,
						resource: r.event.resource,
					},
				}))
				.filter((s) => s.occurrenceDate.getTime() >= now.getTime())
				.sort(
					(a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime(),
				);

			const seriesRegs = registrations.filter(
				(r) => r.event.registrationType === RegistrationType.PER_SERIES,
			);

			// Batch-fetch modified instances for all series base events to avoid N+1.
			// See rrule.ts: combined exdates = base.exdates ∪ child.recurrenceId.
			const baseEventIds = seriesRegs.map((r) => r.event.eventId);
			const children = baseEventIds.length
				? await ctx.db.calendarEvent.findMany({
						where: {
							parentEventId: { in: baseEventIds },
							isDeleted: false,
						},
						select: {
							parentEventId: true,
							recurrenceId: true,
							start: true,
						},
					})
				: [];

			const childrenByParent = new Map<string, typeof children>();
			for (const child of children) {
				if (!child.parentEventId) continue;
				const list = childrenByParent.get(child.parentEventId) ?? [];
				list.push(child);
				childrenByParent.set(child.parentEventId, list);
			}

			const seriesSignups = seriesRegs
				.map((r) => {
					const event = r.event;
					if (!event.rrule) return null;

					const eventChildren = childrenByParent.get(event.eventId) ?? [];
					const childExdates = eventChildren
						.map((c) => (c.recurrenceId ? new Date(c.recurrenceId) : null))
						.filter((d): d is Date => d !== null);
					const combinedExdates = [...event.exdates, ...childExdates];

					let nextRrule: Date | null = null;
					try {
						const ruleset = buildRuleSetFromEvent(
							event.rrule,
							combinedExdates,
							event.start,
						);
						nextRrule = ruleset.after(now, true);
					} catch {
						nextRrule = null;
					}

					const futureChildStarts = eventChildren
						.filter((c) => c.start.getTime() >= now.getTime())
						.map((c) => c.start);
					const nextChild =
						futureChildStarts.length > 0
							? futureChildStarts.reduce((earliest, d) =>
									d.getTime() < earliest.getTime() ? d : earliest,
								)
							: null;

					const candidates = [nextRrule, nextChild].filter(
						(d): d is Date => d !== null,
					);
					if (candidates.length === 0) return null;
					const nextSession = candidates.reduce((earliest, d) =>
						d.getTime() < earliest.getTime() ? d : earliest,
					);

					return {
						registrationId: r.registrationId,
						createdAt: r.createdAt,
						nextSession,
						event: {
							eventId: event.eventId,
							title: event.title,
							start: event.start,
							end: event.end,
							eventType: event.eventType,
							resource: event.resource,
						},
					};
				})
				.filter((s): s is NonNullable<typeof s> => s !== null)
				.sort((a, b) => a.nextSession.getTime() - b.nextSession.getTime());

			return { eventSignups, seriesSignups };
		}),

	// Admin-managed status transitions: CANCEL, NO_SHOW, RESCHEDULE
	// Students use cancelRegistration; staff use this for all status changes
	updateRegistrationStatus: protectedProcedure
		.input(updateRegistrationStatusSchema)
		.mutation(async ({ ctx, input }) => {
			const { registrationId, action, newEventId, newInstanceDate } = input;
			const user = await getCurrentUser(ctx);
			const isFacilityOrAdmin = isFacilityOrAbove(user);
			const isCoach = user.userType === UserType.COACH;

			const registration = await ctx.db.eventRegistration.findUnique({
				where: { registrationId },
				include: {
					event: { select: { clubShortName: true, createdByUserId: true } },
				},
			});

			if (!registration) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Registration not found",
				});
			}

			// CANCEL: students can cancel their own; staff can cancel any in their club
			if (action === "CANCEL") {
				const isOwn = registration.userId === user.userId;
				if (!isFacilityOrAdmin && !isCoach && !isOwn) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You can only cancel your own registration",
					});
				}
				if (isCoach && !isOwn) {
					// Coaches can cancel registrations for their own events only
					if (registration.event.createdByUserId !== user.userId) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message:
								"Coaches can only manage registrations on their own events",
						});
					}
				}
				requireSameClub(user, registration.event.clubShortName);
				if (registration.status !== RegistrationStatus.REGISTERED) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Only registered (active) registrations can be cancelled",
					});
				}
				await ctx.db.$transaction(async (tx) => {
					await tx.eventRegistration.update({
						where: { registrationId },
						data: { status: RegistrationStatus.LATE_CANCEL },
					});
					await tx.registrationStatusLog.create({
						data: {
							clubShortName: registration.event.clubShortName,
							registrationId,
							userId: registration.userId,
							changedByUserId: user.userId,
							oldStatus: RegistrationStatus.REGISTERED,
							newStatus: RegistrationStatus.LATE_CANCEL,
							source: isFacilityOrAdmin ? "admin_dashboard" : "self_service",
						},
					});
				});
				return { success: true };
			}

			// CHECK_IN: facility/admin/coach — transition from REGISTERED → CHECKED_IN
			if (action === "CHECK_IN") {
				if (!isFacilityOrAdmin && !isCoach) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Only staff can check in attendees",
					});
				}
				if (isCoach && registration.event.createdByUserId !== user.userId) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Coaches can only check in attendees on their own events",
					});
				}
				requireSameClub(user, registration.event.clubShortName);
				if (registration.status !== RegistrationStatus.REGISTERED) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Only registered attendees can be checked in",
					});
				}
				await ctx.db.$transaction(async (tx) => {
					await tx.eventRegistration.update({
						where: { registrationId },
						data: { status: RegistrationStatus.CHECKED_IN },
					});
					await tx.registrationStatusLog.create({
						data: {
							clubShortName: registration.event.clubShortName,
							registrationId,
							userId: registration.userId,
							changedByUserId: user.userId,
							oldStatus: RegistrationStatus.REGISTERED,
							newStatus: RegistrationStatus.CHECKED_IN,
							source: "admin_dashboard",
						},
					});
				});
				return { success: true };
			}
			// NO_SHOW and RESCHEDULE: facility/admin only
			if (!isFacilityOrAdmin) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only facility staff can mark no-shows or reschedule",
				});
			}

			requireSameClub(user, registration.event.clubShortName);

			if (registration.status !== RegistrationStatus.REGISTERED) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only registered (active) registrations can be updated",
				});
			}

			if (action === "NO_SHOW") {
				await ctx.db.$transaction(async (tx) => {
					await tx.eventRegistration.update({
						where: { registrationId },
						data: { status: RegistrationStatus.NO_SHOW },
					});
					await tx.registrationStatusLog.create({
						data: {
							clubShortName: registration.event.clubShortName,
							registrationId,
							userId: registration.userId,
							changedByUserId: user.userId,
							oldStatus: RegistrationStatus.REGISTERED,
							newStatus: RegistrationStatus.NO_SHOW,
							source: "admin_dashboard",
						},
					});
				});
				return { success: true };
			}

			// RESCHEDULE: mark old as RESCHEDULED, create new REGISTERED on target event
			if (action === "RESCHEDULE") {
				if (!newEventId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "newEventId is required for RESCHEDULE",
					});
				}

				const targetEvent = await ctx.db.calendarEvent.findUnique({
					where: { eventId: newEventId, isDeleted: false },
					include: {
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
				});

				if (!targetEvent) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Target event not found",
					});
				}

				requireSameClub(user, targetEvent.clubShortName);

				if (
					targetEvent.maxParticipants !== null &&
					targetEvent._count.registrations >= targetEvent.maxParticipants
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Target event is fully booked",
					});
				}

				// Free events (productId=null) are allowed as reschedule targets
				await ctx.db.$transaction(async (tx) => {
					await tx.eventRegistration.update({
						where: { registrationId },
						data: { status: RegistrationStatus.RESCHEDULED },
					});

					const newReg = await tx.eventRegistration.create({
						data: {
							eventId: newEventId,
							userId: registration.userId,
							productId: targetEvent.productId ?? null,
							instanceDate: newInstanceDate ?? null,
							status: RegistrationStatus.REGISTERED,
						},
					});

					// Phase 8a: transfer credit usage to new registration.
					// The original credit "transfers" — no new deduction needed.
					await tx.packageCreditUsage.updateMany({
						where: { registrationId },
						data: { registrationId: newReg.registrationId },
					});

					// Audit log: old registration rescheduled
					await tx.registrationStatusLog.create({
						data: {
							clubShortName: registration.event.clubShortName,
							registrationId,
							userId: registration.userId,
							changedByUserId: user.userId,
							oldStatus: RegistrationStatus.REGISTERED,
							newStatus: RegistrationStatus.RESCHEDULED,
							source: "admin_dashboard",
							metadata: {
								newEventId,
								newRegistrationId: newReg.registrationId,
							},
						},
					});

					// Audit log: new registration created
					await tx.registrationStatusLog.create({
						data: {
							clubShortName: targetEvent.clubShortName,
							registrationId: newReg.registrationId,
							userId: registration.userId,
							changedByUserId: user.userId,
							oldStatus: null,
							newStatus: RegistrationStatus.REGISTERED,
							source: "admin_dashboard",
							metadata: { rescheduledFrom: registrationId },
						},
					});
				});

				return { success: true };
			}

			return { success: false };
		}),

	getEventRegistrations: staffProcedure
		.input(getEventRegistrationsSchema)
		.query(async ({ ctx, input }) => {
			const { eventId } = input;
			const user = ctx.user;
			const isFacilityOrAdmin = isFacilityOrAbove(user);
			const isCoach = user.userType === UserType.COACH;

			const event = await ctx.db.calendarEvent.findUnique({
				where: { eventId, isDeleted: false },
				select: { clubShortName: true, createdByUserId: true },
			});

			if (!event) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
			}

			requireSameClub(user, event.clubShortName);

			// Coaches can only view registrations for their own events
			if (isCoach && event.createdByUserId !== user.userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Coaches can only view registrations on their own events",
				});
			}

			const activeStatuses = [
				RegistrationStatus.REGISTERED,
				RegistrationStatus.CHECKED_IN,
			];
			const inactiveStatuses = [
				RegistrationStatus.NO_SHOW,
				RegistrationStatus.LATE_CANCEL,
				RegistrationStatus.EARLY_CANCEL,
			];
			const registrations = await ctx.db.eventRegistration.findMany({
				where: {
					eventId,
					status: {
						in: input.includeInactive
							? [...activeStatuses, ...inactiveStatuses]
							: activeStatuses,
					},
				},
				include: {
					user: {
						select: {
							userId: true,
							firstName: true,
							lastName: true,
							email: true,
							// profilePicture intentionally omitted for now; add here when avatar support is added (phase later)
						},
					},
				},
				orderBy: { createdAt: "asc" },
			});

			return {
				registrations: registrations.map((r) => ({
					registrationId: r.registrationId,
					userId: r.userId,
					status: r.status,
					instanceDate: r.instanceDate,
					createdAt: r.createdAt,
					firstName: r.user.firstName,
					lastInitial: r.user.lastName ? r.user.lastName[0] + "." : "",
					// FACILITY+ callers get full lastName + email for the detail-page
					// click-through + "Add student" flows (sprint F3 / TD-2).
					// COACH callers see only the stripped shape above.
					lastName: isFacilityOrAdmin ? r.user.lastName : null,
					email: isFacilityOrAdmin ? r.user.email : null,
				})),
			};
		}),

	/**
	 * Phase 9a (Event Activity tab) — registration status-log timeline for a
	 * single event. Returns RegistrationStatusLog rows for every registration
	 * on this event (status changes: REGISTERED / CHECKED_IN / NO_SHOW /
	 * LATE_CANCEL / RESCHEDULED), newest first, with the affected member and
	 * the staff/system actor who made the change.
	 *
	 * Audience: staffProcedure (facility / club_admin / platform_admin AND
	 * coach) — coaches teaching an event can review what happened. Students
	 * are NOT in scope; they have their own self-service surfaces.
	 *
	 * No pagination in v1 — typical event has well under the 200 cap; we'll
	 * paginate when a class produces long historical chains (rescheduling
	 * loops, repeat bookings).
	 */
	listEventStatusLog: staffProcedure
		.input(
			z.object({
				eventId: z.string().min(1),
				limit: z.number().int().min(1).max(200).default(100),
			}),
		)
		.query(async ({ ctx, input }) => {
			const event = await ctx.db.calendarEvent.findFirst({
				where: {
					eventId: input.eventId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { eventId: true },
			});
			if (!event) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Event not found in this club",
				});
			}

			const rows = await ctx.db.registrationStatusLog.findMany({
				where: {
					clubShortName: ctx.user.clubShortName,
					registration: { eventId: input.eventId },
				},
				orderBy: { createdAt: "desc" },
				take: input.limit,
				select: {
					logId: true,
					oldStatus: true,
					newStatus: true,
					source: true,
					reason: true,
					createdAt: true,
					user: {
						select: { userId: true, firstName: true, lastName: true },
					},
					changedByUser: {
						select: { userId: true, firstName: true, lastName: true },
					},
				},
			});

			return { items: rows };
		}),
});
