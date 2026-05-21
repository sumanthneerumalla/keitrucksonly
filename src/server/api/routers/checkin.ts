import { RegistrationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import { consumeCredit } from "~/server/utils/consumeCredit";
import { getCurrentUser } from "~/server/utils/utils";

// ============================================================
// INPUT SCHEMAS
// ============================================================

const getMemberCheckinDashboardSchema = z.object({
	clubShortName: z.string(),
	facilityId: z.string(),
});

const selfCheckinSchema = z.object({
	registrationId: z.string(),
	facilityId: z.string(),
});

const getMemberCheckinCardSchema = z.object({
	userId: z.string(),
	facilityId: z.string(),
});

const staffCheckinSchema = z.object({
	userId: z.string(),
	facilityId: z.string(),
	eventId: z.string().optional(), // null = general facility check-in
});

const getRecentCheckinsSchema = z.object({
	facilityId: z.string(),
	since: z.date().optional(), // for incremental polling — return only records after this timestamp
});

const getMemberAttendanceHistorySchema = z.object({
	userId: z.string(),
	limit: z.number().int().min(1).max(100).optional().default(20),
	cursor: z.string().optional(), // attendanceId of the last item from the previous page
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Get start and end of today using server local time.
 * TODO: Use facility.timezone (IANA) from ClubFacility model instead of server
 * local time. This matters when the server and facility are in different timezones.
 * For the current single-timezone deployment this is fine.
 */
function todayRange() {
	const now = new Date();
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const endOfDay = new Date(startOfDay);
	endOfDay.setDate(endOfDay.getDate() + 1);
	return { startOfDay, endOfDay };
}

// ============================================================
// ROUTER
// ============================================================

export const checkinRouter = createTRPCRouter({
	// ------------------------------------------------------------------
	// MEMBER-FACING (Phase 6a)
	// ------------------------------------------------------------------

	/** Everything the member check-in page needs: today's events, QR data */
	getMemberCheckinDashboard: protectedProcedure
		.input(getMemberCheckinDashboardSchema)
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const { clubShortName, facilityId } = input;

			// Verify user belongs to this club
			if (user.clubShortName !== clubShortName) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not a member of this club",
				});
			}

			// Fetch club display name
			const club = await ctx.db.club.findUnique({
				where: { clubShortName },
				select: { clubName: true },
			});

			// Verify facility exists and belongs to club
			const facility = await ctx.db.clubFacility.findFirst({
				where: { facilityId, clubShortName, isActive: true },
				select: { facilityId: true, name: true },
			});

			if (!facility) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Facility not found",
				});
			}

			const { startOfDay, endOfDay } = todayRange();

			// Today's events this member is registered for at this facility
			// Scoped by resource.facilityId (decision #55)
			const registrations = await ctx.db.eventRegistration.findMany({
				where: {
					userId: user.userId,
					status: {
						in: [RegistrationStatus.REGISTERED, RegistrationStatus.CHECKED_IN],
					},
					event: {
						isDeleted: false,
						start: { gte: startOfDay },
						end: { lte: endOfDay },
						resource: { facilityId },
					},
				},
				include: {
					event: {
						select: {
							eventId: true,
							title: true,
							start: true,
							end: true,
							eventType: true,
							maxParticipants: true,
							resource: { select: { title: true } },
						},
					},
				},
				orderBy: { event: { start: "asc" } },
			});

			return {
				facility,
				clubShortName,
				clubName: club?.clubName ?? clubShortName,
				member: {
					userId: user.userId,
					firstName: user.firstName,
					lastName: user.lastName,
					email: user.email,
				},
				registrations: registrations.map((r) => ({
					registrationId: r.registrationId,
					status: r.status,
					event: {
						eventId: r.event.eventId,
						title: r.event.title,
						start: r.event.start,
						end: r.event.end,
						eventType: r.event.eventType,
						maxParticipants: r.event.maxParticipants,
						resourceTitle: r.event.resource?.title ?? null,
					},
				})),
			};
		}),

	/** Member self-checks-in to a registered event (decision #44, #45) */
	selfCheckin: protectedProcedure
		.input(selfCheckinSchema)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const { registrationId, facilityId } = input;

			const registration = await ctx.db.eventRegistration.findUnique({
				where: { registrationId },
				include: {
					event: {
						select: {
							eventId: true,
							clubShortName: true,
							start: true,
							end: true,
							resource: { select: { facilityId: true } },
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

			// Must be the member's own registration
			if (registration.userId !== user.userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only check in to your own registrations",
				});
			}

			// Double self-check-in prevention (decision #45)
			if (registration.status === RegistrationStatus.CHECKED_IN) {
				return { alreadyCheckedIn: true };
			}

			if (registration.status !== RegistrationStatus.REGISTERED) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only registered events can be checked in",
				});
			}

			// Verify facilityId matches the event's resource facility
			if (
				registration.event.resource?.facilityId &&
				registration.event.resource.facilityId !== facilityId
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Facility does not match the event's location",
				});
			}

			// Self-check-in window ±30 min is enforced client-side only (decision #39).
			// Server does not enforce time restrictions for self-check-in.

			await ctx.db.$transaction(async (tx) => {
				await tx.eventRegistration.update({
					where: { registrationId },
					data: { status: RegistrationStatus.CHECKED_IN },
				});

				await tx.attendance.create({
					data: {
						clubShortName: registration.event.clubShortName,
						facilityId,
						userId: user.userId,
						eventId: registration.event.eventId,
						registrationId,
						checkedInBy: user.userId,
						source: "self",
					},
				});

				await tx.registrationStatusLog.create({
					data: {
						clubShortName: registration.event.clubShortName,
						registrationId,
						userId: user.userId,
						changedByUserId: user.userId,
						oldStatus: RegistrationStatus.REGISTERED,
						newStatus: RegistrationStatus.CHECKED_IN,
						source: "self_service",
					},
				});
			});

			return { alreadyCheckedIn: false };
		}),

	// ------------------------------------------------------------------
	// STAFF-FACING (Phase 7a)
	// ------------------------------------------------------------------

	// `searchMembers` moved to `user.searchMembers` in Phase 9a Round 5 — it's a
	// general-purpose club-wide member typeahead reused by check-in, family
	// management, event registration, and sellPackage Bill-to. See user.ts.

	/** Full member detail card data for the admin check-in page */
	getMemberCheckinCard: facilityProcedure
		.input(getMemberCheckinCardSchema)
		.query(async ({ ctx, input }) => {
			const { userId, facilityId } = input;

			const member = await ctx.db.user.findFirst({
				where: {
					userId,
					clubShortName: ctx.user.clubShortName,
				},
				select: {
					userId: true,
					firstName: true,
					lastName: true,
					email: true,
					profileImage: true,
					createdAt: true,
					userTags: {
						include: { tag: true },
					},
				},
			});

			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found",
				});
			}

			const { startOfDay, endOfDay } = todayRange();

			// Today's registered events at this facility
			const todayRegistrations = await ctx.db.eventRegistration.findMany({
				where: {
					userId,
					status: {
						in: [RegistrationStatus.REGISTERED, RegistrationStatus.CHECKED_IN],
					},
					event: {
						isDeleted: false,
						start: { gte: startOfDay },
						end: { lte: endOfDay },
						resource: { facilityId },
					},
				},
				include: {
					event: {
						select: {
							eventId: true,
							title: true,
							start: true,
							end: true,
							eventType: true,
							maxParticipants: true,
							productId: true,
							resource: { select: { title: true } },
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
				orderBy: { event: { start: "asc" } },
			});

			// Nearby events: starting within 1hr OR currently running, member NOT registered
			// (decision #49: start <= now + 1hr AND end > now)
			const now = new Date();
			const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

			const memberEventIds = todayRegistrations.map((r) => r.event.eventId);

			const nearbyEvents = await ctx.db.calendarEvent.findMany({
				where: {
					isDeleted: false,
					resource: { facilityId },
					start: { lte: oneHourFromNow },
					end: { gt: now },
					eventType: { in: ["BOOKABLE", "COACHING_SLOT"] },
					...(memberEventIds.length > 0 && {
						eventId: { notIn: memberEventIds },
					}),
				},
				select: {
					eventId: true,
					title: true,
					start: true,
					end: true,
					eventType: true,
					maxParticipants: true,
					productId: true,
					resource: { select: { title: true } },
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

			return {
				member: {
					userId: member.userId,
					firstName: member.firstName,
					lastName: member.lastName,
					email: member.email,
					profileImage: member.profileImage,
					memberSince: member.createdAt,
					tags: member.userTags.map((ut) => ({
						tagId: ut.tag.tagId,
						name: ut.tag.name,
						bgColor: ut.tag.bgColor,
						textColor: ut.tag.textColor,
					})),
				},
				todayRegistrations: todayRegistrations.map((r) => ({
					registrationId: r.registrationId,
					status: r.status,
					event: {
						eventId: r.event.eventId,
						title: r.event.title,
						start: r.event.start,
						end: r.event.end,
						eventType: r.event.eventType,
						maxParticipants: r.event.maxParticipants,
						currentRegistrations: r.event._count.registrations,
						resourceTitle: r.event.resource?.title ?? null,
					},
				})),
				nearbyEvents: nearbyEvents.map((e) => ({
					eventId: e.eventId,
					title: e.title,
					start: e.start,
					end: e.end,
					eventType: e.eventType,
					maxParticipants: e.maxParticipants,
					currentRegistrations: e._count.registrations,
					resourceTitle: e.resource?.title ?? null,
				})),
			};
		}),

	/** Staff checks a member in. 3 flows: registered event, unregistered walk-in, general facility */
	staffCheckin: facilityProcedure
		.input(staffCheckinSchema)
		.mutation(async ({ ctx, input }) => {
			const { userId, facilityId, eventId } = input;
			const staffUser = ctx.user;

			// Verify member exists in this club
			const member = await ctx.db.user.findFirst({
				where: { userId, clubShortName: staffUser.clubShortName },
				select: { userId: true, clubShortName: true },
			});

			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found",
				});
			}

			// Flow 3: General facility check-in (no event)
			if (!eventId) {
				const attendance = await ctx.db.$transaction(async (tx) => {
					const att = await tx.attendance.create({
						data: {
							clubShortName: staffUser.clubShortName,
							facilityId,
							userId,
							eventId: null,
							registrationId: null,
							checkedInBy: staffUser.userId,
							source: "staff",
						},
					});

					// Phase 8a: deduct 1 credit from member's isGeneralDropIn package (if any).
					// Fails silently if no matching package — invoice line item (Phase 9).
					await consumeCredit({
						tx,
						userId,
						clubShortName: staffUser.clubShortName,
						eventId: null,
						attendanceId: att.attendanceId,
					});

					return att;
				});

				return {
					success: true,
					attendanceId: attendance.attendanceId,
					flow: "general" as const,
				};
			}

			// Verify event exists
			const event = await ctx.db.calendarEvent.findFirst({
				where: { eventId, isDeleted: false },
				select: {
					eventId: true,
					clubShortName: true,
					productId: true,
					creditCost: true,
					maxParticipants: true,
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
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Event not found",
				});
			}

			// Check if member has an existing registration for this event
			const existingReg = await ctx.db.eventRegistration.findFirst({
				where: {
					eventId,
					userId,
					status: {
						in: [RegistrationStatus.REGISTERED, RegistrationStatus.CHECKED_IN],
					},
				},
			});

			if (existingReg) {
				// Flow 1: Registered event check-in
				if (existingReg.status === RegistrationStatus.CHECKED_IN) {
					return {
						success: true,
						alreadyCheckedIn: true,
						flow: "registered" as const,
					};
				}

				await ctx.db.$transaction(async (tx) => {
					await tx.eventRegistration.update({
						where: { registrationId: existingReg.registrationId },
						data: { status: RegistrationStatus.CHECKED_IN },
					});

					await tx.attendance.create({
						data: {
							clubShortName: staffUser.clubShortName,
							facilityId,
							userId,
							eventId,
							registrationId: existingReg.registrationId,
							checkedInBy: staffUser.userId,
							source: "staff",
						},
					});

					await tx.registrationStatusLog.create({
						data: {
							clubShortName: event.clubShortName,
							registrationId: existingReg.registrationId,
							userId,
							changedByUserId: staffUser.userId,
							oldStatus: RegistrationStatus.REGISTERED,
							newStatus: RegistrationStatus.CHECKED_IN,
							source: "admin_dashboard",
						},
					});
				});

				return { success: true, flow: "registered" as const };
			}

			// Flow 2: Unregistered walk-in — create registration + attendance
			// Capacity warning is shown client-side (decision #48); no hard block here
			await ctx.db.$transaction(async (tx) => {
				const newReg = await tx.eventRegistration.create({
					data: {
						eventId,
						userId,
						productId: event.productId ?? null, // nullable for free events (decision #46)
						status: RegistrationStatus.CHECKED_IN,
					},
				});

				const att = await tx.attendance.create({
					data: {
						clubShortName: staffUser.clubShortName,
						facilityId,
						userId,
						eventId,
						registrationId: newReg.registrationId,
						checkedInBy: staffUser.userId,
						source: "staff",
					},
				});

				await tx.registrationStatusLog.create({
					data: {
						clubShortName: event.clubShortName,
						registrationId: newReg.registrationId,
						userId,
						changedByUserId: staffUser.userId,
						oldStatus: null,
						newStatus: RegistrationStatus.CHECKED_IN,
						source: "admin_dashboard",
					},
				});

				// Phase 8a: deduct credit for walk-in (member bypassed registration).
				// Skipped for free events (productId=null) or non-credit events (creditCost=null/0).
				if (event.productId && event.creditCost && event.creditCost > 0) {
					await consumeCredit({
						tx,
						userId,
						clubShortName: staffUser.clubShortName,
						eventId: event.eventId,
						eventProductId: event.productId,
						creditCost: event.creditCost,
						registrationId: newReg.registrationId,
						attendanceId: att.attendanceId,
					});
				}
			});

			return { success: true, flow: "walkin" as const };
		}),

	/** Recent check-ins at a facility, with incremental polling via `since` param */
	getRecentCheckins: facilityProcedure
		.input(getRecentCheckinsSchema)
		.query(async ({ ctx, input }) => {
			const { facilityId, since } = input;
			const { startOfDay } = todayRange();

			const attendances = await ctx.db.attendance.findMany({
				where: {
					clubShortName: ctx.user.clubShortName,
					facilityId,
					checkedInAt: { gte: since ?? startOfDay },
				},
				include: {
					user: {
						select: {
							userId: true,
							firstName: true,
							lastName: true,
							profileImage: true,
						},
					},
					event: {
						select: {
							eventId: true,
							title: true,
						},
					},
				},
				orderBy: { checkedInAt: "desc" },
				take: 50,
			});

			return {
				checkins: attendances.map((a) => ({
					attendanceId: a.attendanceId,
					checkedInAt: a.checkedInAt,
					source: a.source,
					member: a.user,
					event: a.event
						? { eventId: a.event.eventId, title: a.event.title }
						: null,
				})),
			};
		}),

	// ------------------------------------------------------------------
	// STUDENT DETAIL PAGE (Customer Feedback Sprint — F4)
	// ------------------------------------------------------------------

	/**
	 * Paginated attendance history for a single member, scoped to the caller's club.
	 * Cursor-based: pass the last seen `attendanceId` to fetch the next page.
	 * Ordered by checkedInAt DESC. See
	 * designFiles/roadmap/customer-feedback-ui-sprint.md (TD-5).
	 */
	getMemberAttendanceHistory: facilityProcedure
		.input(getMemberAttendanceHistorySchema)
		.query(async ({ ctx, input }) => {
			const { userId, limit, cursor } = input;

			// Scope check: target user must belong to caller's club.
			const member = await ctx.db.user.findFirst({
				where: {
					userId,
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

			// Fetch limit+1 to determine whether there's another page.
			const rows = await ctx.db.attendance.findMany({
				where: {
					userId,
					clubShortName: ctx.user.clubShortName,
				},
				include: {
					event: {
						select: { eventId: true, title: true },
					},
					facility: {
						select: { facilityId: true, name: true },
					},
				},
				orderBy: [{ checkedInAt: "desc" }, { attendanceId: "desc" }],
				take: limit + 1,
				...(cursor
					? {
							cursor: { attendanceId: cursor },
							skip: 1,
						}
					: {}),
			});

			const hasMore = rows.length > limit;
			const page = hasMore ? rows.slice(0, limit) : rows;
			const nextCursor = hasMore
				? (page[page.length - 1]?.attendanceId ?? null)
				: null;

			return {
				attendances: page.map((a) => ({
					attendanceId: a.attendanceId,
					checkedInAt: a.checkedInAt,
					source: a.source,
					notes: a.notes,
					event: a.event
						? { eventId: a.event.eventId, title: a.event.title }
						: null,
					facility: {
						facilityId: a.facility.facilityId,
						name: a.facility.name,
					},
				})),
				nextCursor,
			};
		}),
});
