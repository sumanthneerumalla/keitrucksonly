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
import { checkResourceConflicts } from "~/server/utils/resourceConflicts";

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
/**
 * Validate per-game scores for a badminton MATCH. Each game must reach the target
 * (default 21) and be won by 2 — capped at target+9 (e.g. 30 for 21, where a
 * 1-point win is allowed at the cap). The match must be decided by exactly the
 * majority of `bestOf` games (2 of 3), total games ≤ bestOf, no game tied.
 * Returns an error message, or null if the score is valid.
 */
function validateMatchScore(
	games: { a: number; b: number }[],
	pointsPerGame: number,
	bestOf: number,
): string | null {
	const cap = pointsPerGame + 9;
	for (const [i, g] of games.entries()) {
		const n = i + 1;
		if (g.a === g.b) return `Game ${n} can't be tied.`;
		const w = Math.max(g.a, g.b);
		const l = Math.min(g.a, g.b);
		if (w < pointsPerGame) return `Game ${n}: a game goes to ${pointsPerGame}.`;
		if (w > cap) return `Game ${n}: the maximum score is ${cap}.`;
		// Win by 2, except a 1-point win is allowed only at the cap.
		if (w < cap && w - l < 2) return `Game ${n}: must be won by 2.`;
	}
	if (games.length > bestOf)
		return `Best of ${bestOf}: too many games entered.`;
	const gamesA = games.filter((g) => g.a > g.b).length;
	const gamesB = games.filter((g) => g.b > g.a).length;
	const majority = Math.floor(bestOf / 2) + 1; // 2 for best-of-3
	const winnerGames = Math.max(gamesA, gamesB);
	const loserGames = Math.min(gamesA, gamesB);
	if (winnerGames !== majority) {
		return `Best of ${bestOf}: a side must win ${majority} game${majority > 1 ? "s" : ""}.`;
	}
	if (loserGames >= majority) return "Both sides can't win the match.";
	return null;
}

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

	/**
	 * End a drop-in session. Cancels any games still in flight and marks everyone
	 * present as DONE, so the board can render a clean "ended" state. Confirmed
	 * results (and the leaderboard) are left intact.
	 */
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
			const now = new Date();
			return ctx.db.$transaction(async (tx) => {
				await tx.dropInAssignment.updateMany({
					where: {
						sessionId: input.sessionId,
						status: {
							in: ["ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRM", "DISPUTED"],
						},
					},
					data: { status: "CANCELLED", endedAt: now },
				});
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: input.sessionId,
						status: { in: ["WAITING", "PLAYING", "IDLE", "AWAITING_RESULT"] },
					},
					data: { status: "DONE" },
				});
				return tx.dropInSession.update({
					where: { sessionId: input.sessionId },
					data: { status: "ENDED", endedAt: now },
				});
			});
		}),

	/**
	 * Staff (facility+): pause a live session — in-progress games finish/report, but
	 * no new games form, no new queue joins, and TIMED stops auto-rotating.
	 */
	pauseSession: facilityProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: { clubShortName: true, status: true },
			});
			if (!session || session.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (session.status !== "ACTIVE") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only an active session can be paused.",
				});
			}
			return ctx.db.dropInSession.update({
				where: { sessionId: input.sessionId },
				data: { status: "PAUSED" },
			});
		}),

	/** Staff (facility+): resume a paused session. */
	resumeSession: facilityProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: { clubShortName: true, status: true },
			});
			if (!session || session.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (session.status !== "PAUSED") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Session is not paused.",
				});
			}
			return ctx.db.dropInSession.update({
				where: { sessionId: input.sessionId },
				data: { status: "ACTIVE" },
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
	 * Staff (facility+): replace a player in a live game with another member (e.g. to
	 * seat a specific test account). Keeps the participant's side; benches the
	 * outgoing player (IDLE) and seats the incoming one (PLAYING, check-in created if
	 * needed). Allowed while the game is IN_PROGRESS or PENDING_CONFIRM.
	 */
	swapParticipant: facilityProcedure
		.input(
			z.object({
				assignmentId: z.string(),
				outUserId: z.string(),
				inUserId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.outUserId === input.inUserId) return { ok: true };
			const assignment = await ctx.db.dropInAssignment.findUnique({
				where: { assignmentId: input.assignmentId },
				include: {
					participants: { select: { id: true, userId: true } },
					session: { select: { clubShortName: true, sessionId: true } },
				},
			});
			if (
				!assignment ||
				assignment.session.clubShortName !== ctx.user.clubShortName
			) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (
				assignment.status !== "IN_PROGRESS" &&
				assignment.status !== "PENDING_CONFIRM"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Players can only be swapped on a live game.",
				});
			}
			const outRow = assignment.participants.find(
				(p) => p.userId === input.outUserId,
			);
			if (!outRow) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "That player isn't in this game.",
				});
			}
			if (assignment.participants.some((p) => p.userId === input.inUserId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "That player is already in this game.",
				});
			}
			const inUser = await ctx.db.user.findUnique({
				where: { userId: input.inUserId },
				select: { clubShortName: true },
			});
			if (!inUser || inUser.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Unknown player.",
				});
			}

			const sessionId = assignment.session.sessionId;
			return ctx.db.$transaction(async (tx) => {
				const swapped = await tx.dropInAssignmentParticipant.update({
					where: { id: outRow.id },
					data: { userId: input.inUserId, isWinner: null },
				});
				await tx.dropInCheckIn.updateMany({
					where: { sessionId, userId: input.outUserId },
					data: { status: "IDLE" },
				});
				await tx.dropInCheckIn.upsert({
					where: { sessionId_userId: { sessionId, userId: input.inUserId } },
					create: { sessionId, userId: input.inUserId, status: "PLAYING" },
					update: { status: "PLAYING", leftAt: null },
				});
				return swapped;
			});
		}),

	/**
	 * Staff (facility+): add one or more members to the waiting pool. Passing 2 (or
	 * 4) users queues them adjacently so doubles auto-pairs them by queue order —
	 * the closest thing to "add a pair" until explicit pairs land (R3). Upserts each
	 * check-in to WAITING; queuedAt is staggered to preserve the selected order.
	 */
	addToQueue: facilityProcedure
		.input(
			z.object({
				sessionId: z.string(),
				userIds: z.array(z.string()).min(1).max(8),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: { clubShortName: true, status: true },
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
			const now = Date.now();
			await ctx.db.$transaction(
				input.userIds.map((userId, i) =>
					ctx.db.dropInCheckIn.upsert({
						where: {
							sessionId_userId: { sessionId: input.sessionId, userId },
						},
						create: {
							sessionId: input.sessionId,
							userId,
							status: "WAITING",
							queuedAt: new Date(now + i),
						},
						update: {
							status: "WAITING",
							queuedAt: new Date(now + i),
							leftAt: null,
						},
					}),
				),
			);
			return { added: input.userIds.length };
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
				select: {
					sessionId: true,
					clubShortName: true,
					status: true,
					courtIds: true,
					format: true,
					mode: true,
					rotationMinutes: true,
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

			const format = session.format ?? DropInFormat.DOUBLES;
			const playersPerCourt = format === DropInFormat.SINGLES ? 2 : 4;
			const isTimed = session.mode === DropInMode.TIMED;
			const half = playersPerCourt / 2;
			const now = new Date();
			const expiresAt = isTimed
				? new Date(now.getTime() + (session.rotationMinutes ?? 15) * 60_000)
				: null;

			// Everything that reads the pool / claims players happens in ONE
			// transaction so concurrent "Start next" (or auto-rotation ticks) can't
			// assign the same players — or the same court — twice. The claim
			// (updateMany WHERE status=WAITING) takes row locks; if a contending call
			// grabbed some of our picks first, our count comes up short and we abort.
			return ctx.db.$transaction(async (tx) => {
				const occupied = await tx.dropInAssignment.findFirst({
					where: {
						sessionId: session.sessionId,
						courtId: input.courtId,
						status: { in: ["IN_PROGRESS", "PENDING_CONFIRM", "DISPUTED"] },
					},
					select: { assignmentId: true },
				});
				if (occupied) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Court is already occupied.",
					});
				}

				const waiting = await tx.dropInCheckIn.findMany({
					where: { sessionId: session.sessionId, status: "WAITING" },
					orderBy: [
						{ gamesPlayed: "asc" },
						{ lastPlayedAt: { sort: "asc", nulls: "first" } },
						{ queuedAt: "asc" },
					],
				});
				if (waiting.length < playersPerCourt) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Need ${playersPerCourt} waiting players; have ${waiting.length}.`,
					});
				}
				const picked = waiting.slice(0, playersPerCourt);

				const claim = await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: session.sessionId,
						userId: { in: picked.map((c) => c.userId) },
						status: "WAITING",
					},
					data: { status: "PLAYING" },
				});
				if (claim.count !== playersPerCourt) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Players were just assigned elsewhere — try again.",
					});
				}

				return tx.dropInAssignment.create({
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
	 * Staff (facility+): cancel a game on a court — frees the court and returns the
	 * present players to the pool (WAITING), without counting it as a game played.
	 */
	cancelAssignment: facilityProcedure
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
			if (
				assignment.status === "COMPLETED" ||
				assignment.status === "CONFIRMED" ||
				assignment.status === "CANCELLED"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This game is already finished.",
				});
			}
			const now = new Date();
			return ctx.db.$transaction(async (tx) => {
				const updated = await tx.dropInAssignment.update({
					where: { assignmentId: assignment.assignmentId },
					data: { status: "CANCELLED", endedAt: now },
				});
				// Present players go back to the pool; the cancelled game isn't counted.
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: assignment.session.sessionId,
						userId: { in: assignment.participants.map((p) => p.userId) },
					},
					data: { status: "WAITING", queuedAt: now },
				});
				return updated;
			});
		}),

	/**
	 * Staff (facility+): add a court to a live session. Validates the court is an
	 * active club resource; unless `force`, it checks the calendar for a conflicting
	 * event over the session's window and returns `{ conflictTitle }` so the UI can
	 * ask "this court is reserved by another event — proceed anyway?".
	 */
	addCourt: facilityProcedure
		.input(
			z.object({
				sessionId: z.string(),
				courtId: z.string(),
				force: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: {
					clubShortName: true,
					status: true,
					courtIds: true,
					eventId: true,
				},
			});
			if (!session || session.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			if (session.status === "ENDED" || session.status === "CANCELLED") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Session has ended.",
				});
			}
			if (session.courtIds.includes(input.courtId)) {
				return { added: true as const };
			}
			const resource = await ctx.db.clubResource.findUnique({
				where: { resourceId: input.courtId },
				select: { clubShortName: true, isActive: true },
			});
			if (
				!resource ||
				resource.clubShortName !== ctx.user.clubShortName ||
				!resource.isActive
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Court not found in your club.",
				});
			}
			if (!input.force) {
				const event = await ctx.db.calendarEvent.findUnique({
					where: { eventId: session.eventId },
					select: { start: true, end: true, eventId: true },
				});
				if (event) {
					const conflicts = await checkResourceConflicts({
						db: ctx.db,
						resourceId: input.courtId,
						start: event.start,
						end: event.end,
						excludeEventId: event.eventId,
					});
					if (conflicts.length > 0) {
						return {
							added: false as const,
							conflictTitle: conflicts[0]?.title ?? "another event",
						};
					}
				}
			}
			await ctx.db.dropInSession.update({
				where: { sessionId: input.sessionId },
				data: { courtIds: { push: input.courtId } },
			});
			return { added: true as const };
		}),

	/**
	 * Staff (facility+): remove a court from a live session (the event still reserves
	 * it on the calendar — it just goes unused). Blocked while a game is on it.
	 */
	removeCourt: facilityProcedure
		.input(z.object({ sessionId: z.string(), courtId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const session = await ctx.db.dropInSession.findUnique({
				where: { sessionId: input.sessionId },
				select: { clubShortName: true, courtIds: true },
			});
			if (!session || session.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			const active = await ctx.db.dropInAssignment.findFirst({
				where: {
					sessionId: input.sessionId,
					courtId: input.courtId,
					status: { in: ["IN_PROGRESS", "PENDING_CONFIRM", "DISPUTED"] },
				},
				select: { assignmentId: true },
			});
			if (active) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "End the game on this court before removing it.",
				});
			}
			return ctx.db.dropInSession.update({
				where: { sessionId: input.sessionId },
				data: {
					courtIds: {
						set: session.courtIds.filter((c) => c !== input.courtId),
					},
				},
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
					session: {
						select: {
							clubShortName: true,
							sessionId: true,
							bestOf: true,
							pointsPerGame: true,
						},
					},
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
			const scoreError = validateMatchScore(
				input.gameScores,
				assignment.session.pointsPerGame ?? 21,
				assignment.session.bestOf ?? 3,
			);
			if (scoreError) {
				throw new TRPCError({ code: "BAD_REQUEST", message: scoreError });
			}
			const gamesA = input.gameScores.filter((g) => g.a > g.b).length;
			const gamesB = input.gameScores.filter((g) => g.b > g.a).length;
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
			const me = assignment.participants.find((p) => p.userId === user.userId);
			if (!me) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not in this match.",
				});
			}
			// Only the side that did NOT report can confirm (so a doubles partner
			// can't rubber-stamp their own team's report).
			const reporter = assignment.participants.find(
				(p) => p.userId === assignment.reportedByUserId,
			);
			if (reporter && me.side === reporter.side) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only the opposing side can confirm the score.",
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
	 * MATCH: the opposing side rejects the reported score → DISPUTED. Players stay
	 * locked (AWAITING_RESULT) until staff resolve via staffSetScore (or cancel).
	 */
	disputeScore: protectedProcedure
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
					session: { select: { clubShortName: true } },
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
			const me = assignment.participants.find((p) => p.userId === user.userId);
			if (!me) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not in this match.",
				});
			}
			const reporter = assignment.participants.find(
				(p) => p.userId === assignment.reportedByUserId,
			);
			if (reporter && me.side === reporter.side) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only the opposing side can dispute the score.",
				});
			}
			return ctx.db.dropInAssignment.update({
				where: { assignmentId: assignment.assignmentId },
				data: { status: "DISPUTED" },
			});
		}),

	/**
	 * Staff (facility+): enter/override a MATCH score directly — authoritative
	 * (C2, 1.0x), no opponent confirm needed. Sets the game CONFIRMED, stamps
	 * winners, returns players to the pool (counters bumped), and queues the
	 * (stubbed) GBR sync. Works on a live, pending, or disputed game.
	 */
	staffSetScore: facilityProcedure
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
			const assignment = await ctx.db.dropInAssignment.findUnique({
				where: { assignmentId: input.assignmentId },
				include: {
					participants: { select: { userId: true } },
					session: {
						select: {
							clubShortName: true,
							sessionId: true,
							bestOf: true,
							pointsPerGame: true,
						},
					},
				},
			});
			if (
				!assignment ||
				assignment.session.clubShortName !== ctx.user.clubShortName
			) {
				throw new TRPCError({ code: "NOT_FOUND" });
			}
			// Allow correcting an already-CONFIRMED result (staff override); only a
			// COMPLETED (TIMED) or CANCELLED game can no longer be scored.
			if (
				assignment.status === "COMPLETED" ||
				assignment.status === "CANCELLED"
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This game can no longer be scored.",
				});
			}
			const wasConfirmed = assignment.status === "CONFIRMED";
			const scoreError = validateMatchScore(
				input.gameScores,
				assignment.session.pointsPerGame ?? 21,
				assignment.session.bestOf ?? 3,
			);
			if (scoreError) {
				throw new TRPCError({ code: "BAD_REQUEST", message: scoreError });
			}
			const gamesA = input.gameScores.filter((g) => g.a > g.b).length;
			const gamesB = input.gameScores.filter((g) => g.b > g.a).length;
			const winnerSide = gamesA > gamesB ? DropInSide.A : DropInSide.B;
			const now = new Date();
			return ctx.db.$transaction(async (tx) => {
				const updated = await tx.dropInAssignment.update({
					where: { assignmentId: assignment.assignmentId },
					data: {
						status: "CONFIRMED",
						reportedByUserId: ctx.user.userId,
						reportedScoreA: gamesA,
						reportedScoreB: gamesB,
						gameScores: input.gameScores,
						winnerSide,
						confirmedByUserId: ctx.user.userId,
						confirmedAt: now,
						gbrSyncStatus: "PENDING",
					},
				});
				await tx.dropInAssignmentParticipant.updateMany({
					where: { assignmentId: assignment.assignmentId, side: winnerSide },
					data: { isWinner: true },
				});
				await tx.dropInAssignmentParticipant.updateMany({
					where: {
						assignmentId: assignment.assignmentId,
						side: winnerSide === DropInSide.A ? DropInSide.B : DropInSide.A,
					},
					data: { isWinner: false },
				});
				// A correction to an already-confirmed game must NOT re-count it
				// (players already moved on and gamesPlayed was bumped once). For a
				// fresh resolution, return the players to the pool and bump counters.
				if (!wasConfirmed) {
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
				}
				return updated;
			});
		}),

	/**
	 * Recent confirmed results for a session (most recent first) — lets staff find
	 * a finished game (which has left the board) to override its score.
	 */
	getRecentResults: protectedProcedure
		.input(z.object({ sessionId: z.string(), limit: z.number().optional() }))
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
			return ctx.db.dropInAssignment.findMany({
				where: { sessionId: input.sessionId, status: "CONFIRMED" },
				orderBy: { confirmedAt: "desc" },
				take: input.limit ?? 10,
				select: {
					assignmentId: true,
					reportedScoreA: true,
					reportedScoreB: true,
					gameScores: true,
					winnerSide: true,
					confirmedAt: true,
					participants: {
						select: {
							userId: true,
							side: true,
							user: { select: { firstName: true, lastName: true } },
						},
					},
				},
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
				try {
					const formed = await ctx.db.$transaction(async (tx) => {
						// Claim: only the tick that flips IN_PROGRESS -> COMPLETED proceeds.
						const claimed = await tx.dropInAssignment.updateMany({
							where: { assignmentId: slot.assignmentId, status: "IN_PROGRESS" },
							data: { status: "COMPLETED", endedAt: now },
						});
						if (claimed.count === 0) return false;

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
						if (waiting.length < playersPerCourt) return false; // court empty

						const picked = waiting.slice(0, playersPerCourt);
						// Atomically claim the next group; if another court grabbed some
						// first, abort this slot (throws → rolls back; retries next tick).
						const claim = await tx.dropInCheckIn.updateMany({
							where: {
								sessionId: input.sessionId,
								userId: { in: picked.map((c) => c.userId) },
								status: "WAITING",
							},
							data: { status: "PLAYING" },
						});
						if (claim.count !== playersPerCourt) {
							throw new Error("CONTENDED");
						}
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
						return true;
					});
					if (formed) rotated += 1;
				} catch {
					// Contended/transient — skip this slot; the next tick retries it.
				}
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
