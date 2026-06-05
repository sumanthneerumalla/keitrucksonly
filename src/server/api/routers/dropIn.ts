import { DropInFormat, DropInMode, DropInPlayerStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";

/**
 * Drop-in sessions (designFiles/drop-in). DI-1 ships MANUAL mode: a session is
 * materialized for a DROP_IN event occurrence, and staff check members in /
 * waitlist / cancel from the event page. No match records in MANUAL (TIMED +
 * MATCH rotation arrive in DI-2/DI-4).
 *
 * Drop-in status (DropInCheckIn.status) is SEPARATE from EventRegistration —
 * it tracks in-session presence: IDLE = checked in/present, WAITING =
 * waitlisted, CANCELLED = cancelled, LEFT = left/no-show.
 */
export const dropInRouter = createTRPCRouter({
	/**
	 * Read the session + roster for a DROP_IN event occurrence. Returns null if
	 * the session hasn't been started yet. Any authenticated club member can view
	 * (the event page renders the board from this).
	 */
	getSession: protectedProcedure
		.input(z.object({ eventId: z.string(), occurrenceDate: z.coerce.date() }))
		.query(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { clubShortName: true },
			});
			if (!user) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			const session = await ctx.db.dropInSession.findUnique({
				where: {
					eventId_occurrenceDate: {
						eventId: input.eventId,
						occurrenceDate: input.occurrenceDate,
					},
				},
				include: {
					checkIns: {
						include: {
							user: {
								select: { userId: true, firstName: true, lastName: true },
							},
						},
						orderBy: { checkedInAt: "asc" },
					},
				},
			});

			if (!session) return null;
			if (session.clubShortName !== user.clubShortName) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			return session;
		}),

	/**
	 * Materialize + activate a drop-in session for a DROP_IN event occurrence.
	 * Idempotent (unique on eventId + occurrenceDate) — re-running re-activates.
	 * Courts default to a snapshot of the event's resources.
	 */
	startSession: facilityProcedure
		.input(
			z.object({
				eventId: z.string(),
				occurrenceDate: z.coerce.date(),
				mode: z.nativeEnum(DropInMode),
				format: z.nativeEnum(DropInFormat).optional(),
				courtIds: z.array(z.string()).optional(),
				rotationMinutes: z.number().int().min(5).max(30).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const event = await ctx.db.calendarEvent.findUnique({
				where: { eventId: input.eventId },
				select: {
					clubShortName: true,
					eventType: true,
					resourceId: true,
					resourceIds: true,
				},
			});
			if (
				!event ||
				event.clubShortName !== ctx.user.clubShortName ||
				event.eventType !== "DROP_IN"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Not a drop-in event in your club.",
				});
			}

			// Snapshot the courts dedicated to drop-in (primary + additional resources).
			const courtIds =
				input.courtIds ??
				Array.from(
					new Set(
						[event.resourceId, ...event.resourceIds].filter(
							(id): id is string => !!id,
						),
					),
				);

			return ctx.db.dropInSession.upsert({
				where: {
					eventId_occurrenceDate: {
						eventId: input.eventId,
						occurrenceDate: input.occurrenceDate,
					},
				},
				create: {
					clubShortName: ctx.user.clubShortName,
					eventId: input.eventId,
					occurrenceDate: input.occurrenceDate,
					mode: input.mode,
					format: input.format,
					courtIds,
					rotationMinutes: input.rotationMinutes,
					status: "ACTIVE",
					startedAt: new Date(),
				},
				update: { status: "ACTIVE", startedAt: new Date(), endedAt: null },
			});
		}),

	/** End a drop-in session. */
	endSession: facilityProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: { clubShortName: true },
			});
			if (!session || session.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			return ctx.db.dropInSession.update({
				where: { sessionId: input.sessionId },
				data: { status: "ENDED", endedAt: new Date() },
			});
		}),

	/**
	 * Staff checks a member into the session (front-desk, G2). Idempotent on
	 * (sessionId, userId); defaults to IDLE (present). Re-checking clears leftAt.
	 */
	checkIn: facilityProcedure
		.input(
			z.object({
				sessionId: z.string(),
				userId: z.string(),
				status: z.nativeEnum(DropInPlayerStatus).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: { clubShortName: true },
			});
			if (!session || session.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const status = input.status ?? DropInPlayerStatus.IDLE;
			return ctx.db.dropInCheckIn.upsert({
				where: {
					sessionId_userId: {
						sessionId: input.sessionId,
						userId: input.userId,
					},
				},
				create: { sessionId: input.sessionId, userId: input.userId, status },
				update: { status, leftAt: null },
			});
		}),

	/**
	 * Change a check-in's status — waitlist (WAITING), cancel (CANCELLED), mark
	 * left/no-show (LEFT), or back to present (IDLE). Staff only.
	 */
	setCheckInStatus: facilityProcedure
		.input(
			z.object({
				checkInId: z.string(),
				status: z.nativeEnum(DropInPlayerStatus),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const checkIn = await ctx.db.dropInCheckIn.findUnique({
				where: { checkInId: input.checkInId },
				select: { session: { select: { clubShortName: true } } },
			});
			if (
				!checkIn ||
				checkIn.session.clubShortName !== ctx.user.clubShortName
			) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			return ctx.db.dropInCheckIn.update({
				where: { checkInId: input.checkInId },
				data: {
					status: input.status,
					leftAt: input.status === DropInPlayerStatus.LEFT ? new Date() : null,
				},
			});
		}),
});
