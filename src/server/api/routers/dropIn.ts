import {
	DropInFormat,
	DropInMode,
	DropInPlayerStatus,
	DropInSide,
} from "@prisma/client";
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

	// =========================================================================
	// DI-2 / DI-4 ROTATION (TIMED + MATCH). Happy-path:
	//  - doubles auto-pairs from queue order (self-formed editable pairs are a
	//    pilot-ready refinement, R3);
	//  - GBR sync is stubbed (only gbrSyncStatus is flipped to PENDING);
	//  - the next group/matchup is formed explicitly (staff/board "start next"),
	//    auto-start-on-report is an R3 refinement.
	// Statuses are passed as string literals (Prisma accepts the enum unions).
	// =========================================================================

	/**
	 * Live board read for a session occurrence: the session, its in-flight
	 * assignments (with participants), and the fairness-ordered waiting pool.
	 * Returns null before a session is started. Authed club members only.
	 */
	getBoard: protectedProcedure
		.input(z.object({ eventId: z.string(), occurrenceDate: z.coerce.date() }))
		.query(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

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
					},
					assignments: {
						where: {
							status: { in: ["IN_PROGRESS", "PENDING_CONFIRM", "DISPUTED"] },
						},
						include: {
							participants: {
								include: {
									user: {
										select: { userId: true, firstName: true, lastName: true },
									},
								},
							},
						},
						orderBy: { startedAt: "asc" },
					},
				},
			});
			if (!session) return null;
			if (session.clubShortName !== user.clubShortName) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			const pool = session.checkIns
				.filter((c) => c.status === "WAITING")
				.sort(
					(a, b) =>
						a.gamesPlayed - b.gamesPlayed ||
						(a.lastPlayedAt?.getTime() ?? 0) -
							(b.lastPlayedAt?.getTime() ?? 0) ||
						a.queuedAt.getTime() - b.queuedAt.getTime(),
				);

			return { session, pool, viewerUserId: user.userId };
		}),

	/** Member self-joins the waiting pool (TIMED/MATCH; G1 = logged in). */
	joinQueue: protectedProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: { clubShortName: true, status: true },
			});
			if (!session || session.clubShortName !== user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (session.status !== "ACTIVE") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Session is not active.",
				});
			}
			return ctx.db.dropInCheckIn.upsert({
				where: {
					sessionId_userId: {
						sessionId: input.sessionId,
						userId: user.userId,
					},
				},
				create: {
					sessionId: input.sessionId,
					userId: user.userId,
					status: "WAITING",
				},
				update: { status: "WAITING", queuedAt: new Date(), leftAt: null },
			});
		}),

	/** Member leaves the queue (back to IDLE). */
	leaveQueue: protectedProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true },
			});
			if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
			return ctx.db.dropInCheckIn.updateMany({
				where: { sessionId: input.sessionId, userId: user.userId },
				data: { status: "IDLE" },
			});
		}),

	/** Member re-enters the queue after a match resolves (or a TIMED slot ends). */
	rejoin: protectedProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true },
			});
			if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
			return ctx.db.dropInCheckIn.updateMany({
				where: {
					sessionId: input.sessionId,
					userId: user.userId,
					status: { in: ["IDLE", "AWAITING_RESULT", "DONE"] },
				},
				data: { status: "WAITING", queuedAt: new Date() },
			});
		}),

	/**
	 * Staff: form the next group (TIMED) or matchup (MATCH) on a free court from
	 * the top of the fairness-ordered pool. Doubles auto-pairs from queue order.
	 */
	formNext: facilityProcedure
		.input(z.object({ sessionId: z.string(), courtId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				include: {
					checkIns: true,
					assignments: {
						where: {
							status: { in: ["IN_PROGRESS", "PENDING_CONFIRM", "DISPUTED"] },
						},
						select: { courtId: true },
					},
				},
			});
			if (!session || session.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (session.status !== "ACTIVE") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Session is not active.",
				});
			}
			if (!session.courtIds.includes(input.courtId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Court is not part of this session.",
				});
			}
			if (session.assignments.some((a) => a.courtId === input.courtId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Court is already occupied.",
				});
			}

			const format = session.format ?? DropInFormat.DOUBLES;
			const playersPerCourt = format === DropInFormat.SINGLES ? 2 : 4;
			const waiting = session.checkIns
				.filter((c) => c.status === "WAITING")
				.sort(
					(a, b) =>
						a.gamesPlayed - b.gamesPlayed ||
						(a.lastPlayedAt?.getTime() ?? 0) -
							(b.lastPlayedAt?.getTime() ?? 0) ||
						a.queuedAt.getTime() - b.queuedAt.getTime(),
				);
			if (waiting.length < playersPerCourt) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Need ${playersPerCourt} waiting players; have ${waiting.length}.`,
				});
			}

			const picked = waiting.slice(0, playersPerCourt);
			const isTimed = session.mode === DropInMode.TIMED;
			const half = playersPerCourt / 2;
			const now = new Date();
			const expiresAt = isTimed
				? new Date(now.getTime() + (session.rotationMinutes ?? 15) * 60_000)
				: null;

			return ctx.db.$transaction(async (tx) => {
				const assignment = await tx.dropInAssignment.create({
					data: {
						sessionId: session.sessionId,
						courtId: input.courtId,
						format,
						status: "IN_PROGRESS",
						startedAt: now,
						expiresAt,
						ratingWeight: isTimed ? null : 1.0,
						participants: {
							create: picked.map((c, i) => ({
								sessionId: session.sessionId,
								userId: c.userId,
								side: isTimed ? null : i < half ? DropInSide.A : DropInSide.B,
							})),
						},
					},
					include: {
						participants: {
							include: {
								user: {
									select: { userId: true, firstName: true, lastName: true },
								},
							},
						},
					},
				});
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: session.sessionId,
						userId: { in: picked.map((c) => c.userId) },
					},
					data: { status: "PLAYING" },
				});
				return assignment;
			});
		}),

	/** Staff: end a TIMED slot now — players return to the pool (IDLE), counters bumped. */
	endSlot: facilityProcedure
		.input(z.object({ assignmentId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const assignment = await ctx.db.dropInAssignment.findUnique({
				where: { assignmentId: input.assignmentId },
				include: {
					participants: { select: { userId: true } },
					session: { select: { clubShortName: true, sessionId: true } },
				},
			});
			if (
				!assignment ||
				assignment.session.clubShortName !== ctx.user.clubShortName
			) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			const now = new Date();
			return ctx.db.$transaction(async (tx) => {
				const updated = await tx.dropInAssignment.update({
					where: { assignmentId: assignment.assignmentId },
					data: { status: "COMPLETED", endedAt: now },
				});
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: assignment.session.sessionId,
						userId: { in: assignment.participants.map((p) => p.userId) },
					},
					data: {
						status: "IDLE",
						gamesPlayed: { increment: 1 },
						lastPlayedAt: now,
					},
				});
				return updated;
			});
		}),

	/**
	 * MATCH: a player on the court reports the per-game scores. Moves the match to
	 * PENDING_CONFIRM and frees the court (all participants → AWAITING_RESULT).
	 */
	reportScore: protectedProcedure
		.input(
			z.object({
				assignmentId: z.string(),
				gameScores: z
					.array(
						z.object({
							a: z.number().int().min(0),
							b: z.number().int().min(0),
						}),
					)
					.min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
			const assignment = await ctx.db.dropInAssignment.findUnique({
				where: { assignmentId: input.assignmentId },
				include: {
					participants: { select: { userId: true } },
					session: { select: { clubShortName: true, sessionId: true } },
				},
			});
			if (
				!assignment ||
				assignment.session.clubShortName !== user.clubShortName
			) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (assignment.status !== "IN_PROGRESS") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This match is not in progress.",
				});
			}
			if (!assignment.participants.some((p) => p.userId === user.userId)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not in this match.",
				});
			}
			const gamesA = input.gameScores.filter((g) => g.a > g.b).length;
			const gamesB = input.gameScores.filter((g) => g.b > g.a).length;
			if (gamesA === gamesB) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A match can't end tied — re-check the game scores.",
				});
			}
			const now = new Date();
			return ctx.db.$transaction(async (tx) => {
				const updated = await tx.dropInAssignment.update({
					where: { assignmentId: assignment.assignmentId },
					data: {
						status: "PENDING_CONFIRM",
						reportedByUserId: user.userId,
						reportedScoreA: gamesA,
						reportedScoreB: gamesB,
						gameScores: input.gameScores,
						winnerSide: gamesA > gamesB ? DropInSide.A : DropInSide.B,
					},
				});
				// First report frees the court — reporting players go off to AWAITING_RESULT.
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: assignment.session.sessionId,
						userId: { in: assignment.participants.map((p) => p.userId) },
					},
					data: { status: "AWAITING_RESULT" },
				});
				return updated;
			});
		}),

	/**
	 * MATCH: the opponent confirms the reported score → CONFIRMED. Stamps winners,
	 * returns players to IDLE with counters bumped, and queues a (stubbed) GBR sync.
	 */
	confirmScore: protectedProcedure
		.input(z.object({ assignmentId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
			const assignment = await ctx.db.dropInAssignment.findUnique({
				where: { assignmentId: input.assignmentId },
				include: {
					participants: { select: { userId: true, side: true } },
					session: { select: { clubShortName: true, sessionId: true } },
				},
			});
			if (
				!assignment ||
				assignment.session.clubShortName !== user.clubShortName
			) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (assignment.status !== "PENDING_CONFIRM") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This match is not awaiting confirmation.",
				});
			}
			if (!assignment.participants.some((p) => p.userId === user.userId)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not in this match.",
				});
			}
			if (assignment.reportedByUserId === user.userId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Wait for an opponent to confirm the score you reported.",
				});
			}
			const now = new Date();
			return ctx.db.$transaction(async (tx) => {
				const updated = await tx.dropInAssignment.update({
					where: { assignmentId: assignment.assignmentId },
					data: {
						status: "CONFIRMED",
						confirmedByUserId: user.userId,
						confirmedAt: now,
						gbrSyncStatus: "PENDING", // stub: DI-5 submission loop picks this up
					},
				});
				// Stamp winners on the participant rows (per side).
				await tx.dropInAssignmentParticipant.updateMany({
					where: {
						assignmentId: assignment.assignmentId,
						side: assignment.winnerSide,
					},
					data: { isWinner: true },
				});
				await tx.dropInAssignmentParticipant.updateMany({
					where: {
						assignmentId: assignment.assignmentId,
						side:
							assignment.winnerSide === DropInSide.A
								? DropInSide.B
								: DropInSide.A,
					},
					data: { isWinner: false },
				});
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: assignment.session.sessionId,
						userId: { in: assignment.participants.map((p) => p.userId) },
					},
					data: {
						status: "IDLE",
						gamesPlayed: { increment: 1 },
						lastPlayedAt: now,
					},
				});
				return updated;
			});
		}),

	/**
	 * TIMED auto-rotation tick. The live board calls this when a slot's countdown
	 * hits zero; it completes every expired TIMED slot and forms the next group on
	 * that court from the remaining WAITING pool — so rotation is hands-free.
	 * Idempotent + race-safe: each expired slot is "claimed" via a conditional
	 * status update, so concurrent ticks from multiple open boards can't double-
	 * rotate. (Headless rotation with no board open would need a scheduler — R3.)
	 */
	tickTimed: protectedProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { clubShortName: true },
			});
			if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: {
					clubShortName: true,
					status: true,
					mode: true,
					format: true,
					rotationMinutes: true,
				},
			});
			if (!session || session.clubShortName !== user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (session.status !== "ACTIVE" || session.mode !== DropInMode.TIMED) {
				return { rotated: 0 };
			}

			const now = new Date();
			const expired = await ctx.db.dropInAssignment.findMany({
				where: {
					sessionId: input.sessionId,
					status: "IN_PROGRESS",
					expiresAt: { lte: now },
				},
				include: { participants: { select: { userId: true } } },
			});

			const format = session.format ?? DropInFormat.DOUBLES;
			const playersPerCourt = format === DropInFormat.SINGLES ? 2 : 4;
			let rotated = 0;

			for (const slot of expired) {
				await ctx.db.$transaction(async (tx) => {
					// Claim: only the tick that flips IN_PROGRESS -> COMPLETED proceeds.
					const claimed = await tx.dropInAssignment.updateMany({
						where: { assignmentId: slot.assignmentId, status: "IN_PROGRESS" },
						data: { status: "COMPLETED", endedAt: now },
					});
					if (claimed.count === 0) return;

					// Free the finishing players back to the pool (manual rejoin, A12).
					await tx.dropInCheckIn.updateMany({
						where: {
							sessionId: input.sessionId,
							userId: { in: slot.participants.map((p) => p.userId) },
						},
						data: {
							status: "IDLE",
							gamesPlayed: { increment: 1 },
							lastPlayedAt: now,
						},
					});

					// Pull the next group from whoever is still WAITING (fairness order).
					const waiting = await tx.dropInCheckIn.findMany({
						where: { sessionId: input.sessionId, status: "WAITING" },
						orderBy: [
							{ gamesPlayed: "asc" },
							{ lastPlayedAt: { sort: "asc", nulls: "first" } },
							{ queuedAt: "asc" },
						],
					});
					if (waiting.length < playersPerCourt) return; // leave court empty

					const picked = waiting.slice(0, playersPerCourt);
					await tx.dropInAssignment.create({
						data: {
							sessionId: input.sessionId,
							courtId: slot.courtId,
							format,
							status: "IN_PROGRESS",
							startedAt: now,
							expiresAt: new Date(
								now.getTime() + (session.rotationMinutes ?? 15) * 60_000,
							),
							participants: {
								create: picked.map((c) => ({
									sessionId: input.sessionId,
									userId: c.userId,
									side: null,
								})),
							},
						},
					});
					await tx.dropInCheckIn.updateMany({
						where: {
							sessionId: input.sessionId,
							userId: { in: picked.map((c) => c.userId) },
						},
						data: { status: "PLAYING" },
					});
					rotated += 1;
				});
			}

			return { rotated };
		}),

	/**
	 * Per-session leaderboard (local; the GBR-extracted `calculateStandings` is a
	 * later refinement). Ranks confirmed-match players by wins then point diff.
	 */
	getStandings: protectedProcedure
		.input(z.object({ sessionId: z.string() }))
		.query(async ({ ctx, input }) => {
			const user = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { clubShortName: true },
			});
			if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: { clubShortName: true },
			});
			if (!session || session.clubShortName !== user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}

			const assignments = await ctx.db.dropInAssignment.findMany({
				where: { sessionId: input.sessionId, status: "CONFIRMED" },
				include: {
					participants: {
						include: {
							user: {
								select: { userId: true, firstName: true, lastName: true },
							},
						},
					},
				},
			});

			const tally = new Map<
				string,
				{
					userId: string;
					firstName: string | null;
					lastName: string | null;
					wins: number;
					losses: number;
					pointDiff: number;
				}
			>();
			for (const a of assignments) {
				const games = (a.gameScores as { a: number; b: number }[] | null) ?? [];
				const ptsA = games.reduce((s, g) => s + g.a, 0);
				const ptsB = games.reduce((s, g) => s + g.b, 0);
				for (const p of a.participants) {
					const row = tally.get(p.userId) ?? {
						userId: p.userId,
						firstName: p.user.firstName,
						lastName: p.user.lastName,
						wins: 0,
						losses: 0,
						pointDiff: 0,
					};
					if (p.isWinner === true) row.wins += 1;
					else if (p.isWinner === false) row.losses += 1;
					row.pointDiff += p.side === DropInSide.A ? ptsA - ptsB : ptsB - ptsA;
					tally.set(p.userId, row);
				}
			}

			return [...tally.values()].sort(
				(x, y) => y.wins - x.wins || y.pointDiff - x.pointDiff,
			);
		}),
});
