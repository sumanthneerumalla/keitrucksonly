import {
	DropInFormat,
	DropInMode,
	DropInPlayerStatus,
	DropInSide,
	type Prisma,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import {
	assertCallerInParty,
	assertPartyHasRoom,
	assertSessionAcceptsPartyOps,
	generateGuestClerkUserId,
	loadPartyForOp,
	loadPartySummaries,
	loadSessionForPartyOp,
} from "~/server/services/dropIn/party";
import { pickNextOccupants } from "~/server/services/dropIn/pickNextOccupants";
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

/**
 * Auto-start (A15, on-confirm): after a MATCH court frees (a score was confirmed /
 * staff-resolved), atomically form the next matchup on that court from the waiting
 * pool. Race-safe (claim WHERE status=WAITING, verify count). No-op unless the
 * session is an ACTIVE MATCH, the court is free, and enough players are waiting.
 * Must run inside the same transaction that freed the court.
 */
async function autoStartMatchOnCourt(
	tx: Prisma.TransactionClient,
	session: {
		sessionId: string;
		mode: DropInMode;
		status: DropInSessionStatusLike;
		format: DropInFormat | null;
	},
	courtId: string,
): Promise<void> {
	if (session.mode !== DropInMode.MATCH || session.status !== "ACTIVE") return;
	const occupied = await tx.dropInAssignment.findFirst({
		where: {
			sessionId: session.sessionId,
			courtId,
			status: { in: ["IN_PROGRESS", "PENDING_CONFIRM", "DISPUTED"] },
		},
		select: { assignmentId: true },
	});
	if (occupied) return;

	const format = session.format ?? DropInFormat.DOUBLES;
	const playersPerCourt = format === DropInFormat.SINGLES ? 2 : 4;
	const waiting = await tx.dropInCheckIn.findMany({
		where: { sessionId: session.sessionId, status: "WAITING" },
		orderBy: [
			{ gamesPlayed: "asc" },
			{ lastPlayedAt: { sort: "asc", nulls: "first" } },
			{ queuedAt: "asc" },
		],
	});
	if (waiting.length < playersPerCourt) return;

	const picked = waiting.slice(0, playersPerCourt);
	const half = playersPerCourt / 2;
	const claim = await tx.dropInCheckIn.updateMany({
		where: {
			sessionId: session.sessionId,
			userId: { in: picked.map((c) => c.userId) },
			status: "WAITING",
		},
		data: { status: "PLAYING" },
	});
	if (claim.count !== playersPerCourt) return; // contended — staff can Start next

	await tx.dropInAssignment.create({
		data: {
			sessionId: session.sessionId,
			courtId,
			format,
			status: "IN_PROGRESS",
			startedAt: new Date(),
			ratingWeight: 1.0,
			participants: {
				create: picked.map((c, i) => ({
					sessionId: session.sessionId,
					userId: c.userId,
					side: i < half ? DropInSide.A : DropInSide.B,
				})),
			},
		},
	});
}

type DropInSessionStatusLike =
	| "SCHEDULED"
	| "ACTIVE"
	| "PAUSED"
	| "ENDED"
	| "CANCELLED";

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
	 * End a drop-in session — SOFT end (E2). Stops forming new games and clears the
	 * queue, but lets in-progress games finish + report/confirm (and sync, once GBR
	 * is live). Only ASSIGNED (transient, never started) is cancelled; PLAYING /
	 * AWAITING_RESULT players and their IN_PROGRESS/PENDING_CONFIRM/DISPUTED games are
	 * left intact so they can resolve. Staff "Cancel game" can clear stragglers.
	 * (Auto-cancel after a grace period is deferred — no scheduler yet.)
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
				// Only cancel transient pre-assignments; leave live/pending games alone.
				await tx.dropInAssignment.updateMany({
					where: { sessionId: input.sessionId, status: "ASSIGNED" },
					data: { status: "CANCELLED", endedAt: now },
				});
				// Players not in a live game are done; PLAYING / AWAITING_RESULT stay so
				// they can finish and report/confirm.
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: input.sessionId,
						status: { in: ["WAITING", "IDLE"] },
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
			return ctx.db.$transaction(async (tx) => {
				const existing = await tx.dropInCheckIn.findUnique({
					where: {
						sessionId_userId: {
							sessionId: input.sessionId,
							userId: input.userId,
						},
					},
					select: { checkInId: true },
				});
				if (existing) {
					return tx.dropInCheckIn.update({
						where: {
							sessionId_userId: {
								sessionId: input.sessionId,
								userId: input.userId,
							},
						},
						data: { status, leftAt: null },
					});
				}
				// Fresh: solo party (openToFill=true so they're auto-mixable
				// in the standard way).
				const party = await tx.dropInParty.create({
					data: {
						sessionId: input.sessionId,
						openToFill: true,
						createdByUserId: ctx.user.userId,
					},
				});
				return tx.dropInCheckIn.create({
					data: {
						sessionId: input.sessionId,
						userId: input.userId,
						partyId: party.partyId,
						status,
					},
				});
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
								select: {
									userId: true,
									firstName: true,
									lastName: true,
									isGuest: true,
								},
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
					parties: {
						orderBy: { queuedAt: "asc" },
						include: {
							members: {
								where: {
									status: {
										in: [
											"WAITING",
											"IDLE",
											"PLAYING",
											"AWAITING_RESULT",
											"DONE",
										],
									},
								},
								orderBy: { createdAt: "asc" },
								select: {
									userId: true,
									status: true,
									user: {
										select: {
											userId: true,
											firstName: true,
											lastName: true,
											isGuest: true,
										},
									},
								},
							},
						},
					},
				},
			});
			if (!session) return null;
			if (session.clubShortName !== user.clubShortName) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			// Map checkInId → { partyId, isPartyHead } for pool enrichment. A
			// member is the "head" of their party iff they're first by
			// member.createdAt within their party — purely a display concept.
			const partyHeadByUserId = new Map<string, boolean>();
			for (const p of session.parties) {
				const head = p.members[0];
				if (head) partyHeadByUserId.set(head.userId, true);
			}

			// Pool: only WAITING members (unchanged semantics), now enriched
			// with partyId + isPartyHead. Sort key still includes the fairness
			// counters so legacy renderings stay consistent; new clients can
			// also group by partyId.
			const pool = session.checkIns
				.filter((c) => c.status === "WAITING")
				.sort(
					(a, b) =>
						a.gamesPlayed - b.gamesPlayed ||
						(a.lastPlayedAt?.getTime() ?? 0) -
							(b.lastPlayedAt?.getTime() ?? 0) ||
						a.queuedAt.getTime() - b.queuedAt.getTime(),
				)
				.map((c) => ({
					...c,
					isPartyHead: partyHeadByUserId.get(c.userId) ?? false,
				}));

			// Top-level parties[]: derived state per plan §4. Defunct parties
			// (no live members) are filtered out. Each entry includes member
			// list so the client can render "Party of 4: Alice + Bob queued,
			// Charlie on Court 2" while the party is held.
			const parties = session.parties
				.filter((p) => p.members.length > 0)
				.map((p) => {
					const anyPlaying = p.members.some((m) => m.status === "PLAYING");
					const anyAwaiting = p.members.some(
						(m) => m.status === "AWAITING_RESULT",
					);
					const derivedState = anyPlaying
						? "PLAYING"
						: anyAwaiting
							? "AWAITING_RESULT"
							: "WAITING";
					return {
						partyId: p.partyId,
						openToFill: p.openToFill,
						queuedAt: p.queuedAt,
						memberCount: p.members.length,
						members: p.members.map((m) => ({
							userId: m.userId,
							firstName: m.user.firstName,
							lastName: m.user.lastName,
							isGuest: m.user.isGuest,
							status: m.status,
						})),
						hasGuest: p.members.some((m) => m.user.isGuest),
						isReady: !anyPlaying && !anyAwaiting,
						derivedState,
					};
				});

			return { session, pool, parties, viewerUserId: user.userId };
		}),

	/**
	 * Member self-joins the waiting pool (TIMED/MATCH; G1 = logged in). On first
	 * join in a session, also creates an `openToFill=true` solo party (so they
	 * get mixed with other open queuers by default — matches today's behavior).
	 * On re-entry (already had a check-in), preserves the existing party.
	 */
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

			return ctx.db.$transaction(async (tx) => {
				const existing = await tx.dropInCheckIn.findUnique({
					where: {
						sessionId_userId: {
							sessionId: input.sessionId,
							userId: user.userId,
						},
					},
					select: { partyId: true },
				});
				if (existing) {
					// Existing check-in (any status) — preserve the party,
					// refresh queue position.
					return tx.dropInCheckIn.update({
						where: {
							sessionId_userId: {
								sessionId: input.sessionId,
								userId: user.userId,
							},
						},
						data: {
							status: "WAITING",
							queuedAt: new Date(),
							leftAt: null,
						},
					});
				}
				// Fresh — create a solo party with openToFill=true (default
				// solo-mix behavior).
				const now = new Date();
				const party = await tx.dropInParty.create({
					data: {
						sessionId: input.sessionId,
						openToFill: true,
						queuedAt: now,
						createdByUserId: user.userId,
					},
				});
				return tx.dropInCheckIn.create({
					data: {
						sessionId: input.sessionId,
						userId: user.userId,
						partyId: party.partyId,
						status: "WAITING",
						queuedAt: now,
					},
				});
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
			// IDLE only — a player in AWAITING_RESULT still owes a confirm and is gated
			// from the queue until their match is resolved (A3 dual gate).
			return ctx.db.dropInCheckIn.updateMany({
				where: {
					sessionId: input.sessionId,
					userId: user.userId,
					status: "IDLE",
				},
				data: { status: "WAITING", queuedAt: new Date() },
			});
		}),

	// ===========================================================================
	// Drop-in PARTY procedures (designFiles/drop-in/group-join-feature-plan.md).
	//
	// A party is a group of 1+ players holding a single queue slot together.
	// Solo = party of 1. Every DropInCheckIn has a partyId (NOT NULL).
	//
	// Party state (WAITING / PLAYING / etc.) is DERIVED from members'
	// DropInCheckIn.status — there is no status column on DropInParty. So these
	// procedures only mutate member-level rows + the party's queuedAt/openToFill.
	// ===========================================================================

	/**
	 * Caller creates a new party of 1 (themselves) and enters the queue. If they
	 * already have a check-in in this session, this re-enters via their existing
	 * party (idempotent — preserves the existing party's queue position).
	 *
	 * Default openToFill = false — opt-in via setPartyOpenToFill or by clicking
	 * "Join others" in the UI.
	 */
	createParty: protectedProcedure
		.input(
			z.object({
				sessionId: z.string(),
				openToFill: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			return ctx.db.$transaction(async (tx) => {
				const session = await loadSessionForPartyOp(
					tx,
					input.sessionId,
					caller.clubShortName,
				);
				assertSessionAcceptsPartyOps(session);

				// Already in this session? Re-enter via the existing party so we
				// don't strand them in a stale party row.
				const existing = await tx.dropInCheckIn.findUnique({
					where: {
						sessionId_userId: {
							sessionId: input.sessionId,
							userId: caller.userId,
						},
					},
					select: { partyId: true },
				});
				if (existing) {
					await tx.dropInCheckIn.update({
						where: {
							sessionId_userId: {
								sessionId: input.sessionId,
								userId: caller.userId,
							},
						},
						data: {
							status: "WAITING",
							queuedAt: new Date(),
							leftAt: null,
						},
					});
					return { partyId: existing.partyId, isNew: false };
				}

				// Fresh party of 1.
				const now = new Date();
				const party = await tx.dropInParty.create({
					data: {
						sessionId: input.sessionId,
						openToFill: input.openToFill,
						queuedAt: now,
						createdByUserId: caller.userId,
					},
				});
				await tx.dropInCheckIn.create({
					data: {
						sessionId: input.sessionId,
						userId: caller.userId,
						partyId: party.partyId,
						status: "WAITING",
						queuedAt: now,
					},
				});
				return { partyId: party.partyId, isNew: true };
			});
		}),

	/**
	 * Add another player (real user or guest) to caller's party. Implements B2:
	 * if the target is already solo-WAITING with an earlier queuedAt, the party
	 * snaps to MIN(party.queuedAt, target.queuedAt). The target's prior party
	 * (a solo party of 1) is left behind as defunct (no live members).
	 */
	addPartyMember: protectedProcedure
		.input(
			z.object({
				partyId: z.string(),
				targetUserId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			return ctx.db.$transaction(async (tx) => {
				await assertCallerInParty(tx, input.partyId, caller.userId);

				const party = await loadPartyForOp(tx, input.partyId);
				const session = await loadSessionForPartyOp(
					tx,
					party.sessionId,
					caller.clubShortName,
				);
				assertSessionAcceptsPartyOps(session);

				if (input.targetUserId === caller.userId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "You are already in this party.",
					});
				}

				// Capacity check (C1) — must leave room for the new member.
				assertPartyHasRoom(party.liveMembers.length, session.format);

				const target = await tx.user.findUnique({
					where: { userId: input.targetUserId },
					select: { userId: true, clubShortName: true, isGuest: true },
				});
				if (!target) throw new TRPCError({ code: "NOT_FOUND" });
				if (target.clubShortName !== caller.clubShortName) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Target user is not in this club.",
					});
				}

				// Existing check-in for the target in this session, if any.
				const existing = await tx.dropInCheckIn.findUnique({
					where: {
						sessionId_userId: {
							sessionId: party.sessionId,
							userId: target.userId,
						},
					},
					select: { partyId: true, queuedAt: true, status: true },
				});

				// Reject if target is already in THIS party (idempotency).
				if (existing && existing.partyId === input.partyId) {
					return { partyId: input.partyId, added: false };
				}

				const now = new Date();

				if (existing) {
					// Target has a check-in (possibly LEFT/CANCELLED, possibly
					// in another live party). Move them to ours.
					if (
						existing.status !== "LEFT" &&
						existing.status !== "CANCELLED"
					) {
						// B2: snap the receiving party's position to the earlier
						// of the two queuedAts. Solo-WAITING entries effectively
						// "give" their position to the party.
						const earlier =
							existing.queuedAt < party.queuedAt
								? existing.queuedAt
								: party.queuedAt;
						if (earlier.getTime() !== party.queuedAt.getTime()) {
							await tx.dropInParty.update({
								where: { partyId: input.partyId },
								data: { queuedAt: earlier },
							});
						}
					}
					await tx.dropInCheckIn.update({
						where: {
							sessionId_userId: {
								sessionId: party.sessionId,
								userId: target.userId,
							},
						},
						data: {
							partyId: input.partyId,
							// Preserve PLAYING/AWAITING_RESULT status if they're
							// mid-game on another court — spec allows adding
							// someone who's playing. Otherwise flip to WAITING.
							status:
								existing.status === "PLAYING" ||
								existing.status === "AWAITING_RESULT"
									? existing.status
									: "WAITING",
							queuedAt: party.queuedAt, // member rows mirror party time for fairness
							leftAt: null,
						},
					});
				} else {
					// First time joining this session — fresh check-in pointing
					// to our party.
					await tx.dropInCheckIn.create({
						data: {
							sessionId: party.sessionId,
							userId: target.userId,
							partyId: input.partyId,
							status: "WAITING",
							queuedAt: party.queuedAt,
						},
					});
				}

				return { partyId: input.partyId, added: true };
			});
		}),

	/**
	 * Remove a member from the party. Sets their check-in to LEFT (audit-
	 * preserved partyId). Rejected if the target is currently PLAYING — can't
	 * yank someone off a live court via party UI; staff use endSlot for that.
	 *
	 * Any party member can remove any other. Removing yourself is equivalent to
	 * leaveParty (kept as a separate endpoint for clarity).
	 */
	removePartyMember: protectedProcedure
		.input(
			z.object({
				partyId: z.string(),
				targetUserId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			return ctx.db.$transaction(async (tx) => {
				await assertCallerInParty(tx, input.partyId, caller.userId);
				const party = await loadPartyForOp(tx, input.partyId);
				await loadSessionForPartyOp(tx, party.sessionId, caller.clubShortName);

				const target = party.liveMembers.find(
					(m) => m.userId === input.targetUserId,
				);
				if (!target) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Target is not a live member of this party.",
					});
				}
				if (target.status === "PLAYING") {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Cannot remove a member who is mid-game.",
					});
				}

				await tx.dropInCheckIn.update({
					where: {
						sessionId_userId: {
							sessionId: party.sessionId,
							userId: input.targetUserId,
						},
					},
					data: { status: "LEFT", leftAt: new Date() },
				});
				return { partyId: input.partyId, removed: input.targetUserId };
			});
		}),

	/** Caller leaves their own party. Sugar over removePartyMember(self). */
	leaveParty: protectedProcedure
		.input(z.object({ partyId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			return ctx.db.$transaction(async (tx) => {
				await assertCallerInParty(tx, input.partyId, caller.userId);
				const party = await loadPartyForOp(tx, input.partyId);
				await loadSessionForPartyOp(tx, party.sessionId, caller.clubShortName);

				const self = party.liveMembers.find((m) => m.userId === caller.userId);
				if (self && self.status === "PLAYING") {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Cannot leave the party while mid-game.",
					});
				}

				await tx.dropInCheckIn.update({
					where: {
						sessionId_userId: {
							sessionId: party.sessionId,
							userId: caller.userId,
						},
					},
					data: { status: "LEFT", leftAt: new Date() },
				});
				return { partyId: input.partyId, left: caller.userId };
			});
		}),

	/**
	 * Disband the party — every live member's check-in flips to LEFT. The party
	 * row stays for audit but becomes defunct (no live members). Rejected if
	 * any member is currently PLAYING.
	 */
	disbandParty: protectedProcedure
		.input(z.object({ partyId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			return ctx.db.$transaction(async (tx) => {
				await assertCallerInParty(tx, input.partyId, caller.userId);
				const party = await loadPartyForOp(tx, input.partyId);
				await loadSessionForPartyOp(tx, party.sessionId, caller.clubShortName);

				if (party.liveMembers.some((m) => m.status === "PLAYING")) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Cannot disband while a member is mid-game.",
					});
				}

				const now = new Date();
				await tx.dropInCheckIn.updateMany({
					where: {
						partyId: input.partyId,
						userId: { in: party.liveMembers.map((m) => m.userId) },
					},
					data: { status: "LEFT", leftAt: now },
				});
				return {
					partyId: input.partyId,
					disbanded: party.liveMembers.length,
				};
			});
		}),

	/**
	 * Re-queue the party after a game finishes (plan §5). Filters to members
	 * currently `IDLE` (just-finished); LEFT/CANCELLED stay gone; AWAITING_RESULT
	 * waits for their previous score to confirm before re-queue applies. Updates
	 * `party.queuedAt = now` so the party drops to the back of the FIFO queue —
	 * essential for pure-party-FIFO fairness (rule X). Idempotent: re-queueing
	 * an already-WAITING party is a no-op for that member.
	 *
	 * If no IDLE members are eligible, party is effectively dissolved by
	 * attrition; procedure returns `{ requeued: 0 }` without touching anything.
	 */
	requeueParty: protectedProcedure
		.input(z.object({ partyId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			return ctx.db.$transaction(async (tx) => {
				await assertCallerInParty(tx, input.partyId, caller.userId);
				const party = await loadPartyForOp(tx, input.partyId);
				const session = await loadSessionForPartyOp(
					tx,
					party.sessionId,
					caller.clubShortName,
				);
				assertSessionAcceptsPartyOps(session);

				const idleMembers = party.liveMembers.filter(
					(m) => m.status === "IDLE",
				);
				if (idleMembers.length === 0) {
					return { partyId: input.partyId, requeued: 0 };
				}

				const now = new Date();
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: party.sessionId,
						userId: { in: idleMembers.map((m) => m.userId) },
					},
					data: { status: "WAITING", queuedAt: now },
				});
				await tx.dropInParty.update({
					where: { partyId: input.partyId },
					data: { queuedAt: now },
				});
				return { partyId: input.partyId, requeued: idleMembers.length };
			});
		}),

	/**
	 * Toggle the party's openToFill flag — opts the party into being filled
	 * with other open parties at court-assignment time. Concurrent toggles from
	 * two members are last-write-wins (Prisma default isolation); both states
	 * are valid so this is fine.
	 */
	setPartyOpenToFill: protectedProcedure
		.input(
			z.object({
				partyId: z.string(),
				openToFill: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			return ctx.db.$transaction(async (tx) => {
				await assertCallerInParty(tx, input.partyId, caller.userId);
				const party = await loadPartyForOp(tx, input.partyId);
				const session = await loadSessionForPartyOp(
					tx,
					party.sessionId,
					caller.clubShortName,
				);
				assertSessionAcceptsPartyOps(session);

				return tx.dropInParty.update({
					where: { partyId: input.partyId },
					data: { openToFill: input.openToFill },
					select: { partyId: true, openToFill: true },
				});
			});
		}),

	/**
	 * Create a persistent guest profile in the caller's club. Guests are User
	 * rows with isGuest=true and a synthetic clerkUserId. They can be added to
	 * parties and play, but assignments containing them are GBR-excluded.
	 *
	 * Duplicate first+last in the same club is rejected unless allowDuplicate
	 * is explicitly true.
	 */
	createGuest: protectedProcedure
		.input(
			z.object({
				firstName: z.string().trim().min(1).max(60),
				lastName: z.string().trim().min(1).max(60),
				email: z.string().email().optional(),
				phone: z.string().trim().max(40).optional(),
				allowDuplicate: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { userId: true, clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			if (!input.allowDuplicate) {
				const dup = await ctx.db.user.findFirst({
					where: {
						isGuest: true,
						clubShortName: caller.clubShortName,
						firstName: { equals: input.firstName, mode: "insensitive" },
						lastName: { equals: input.lastName, mode: "insensitive" },
					},
					select: { userId: true },
				});
				if (dup) {
					throw new TRPCError({
						code: "CONFLICT",
						message:
							"A guest with this name already exists in your club. Pass allowDuplicate=true to create another.",
					});
				}
			}

			const guest = await ctx.db.user.create({
				data: {
					clerkUserId: generateGuestClerkUserId(),
					isGuest: true,
					guestCreatedBy: caller.userId,
					firstName: input.firstName,
					lastName: input.lastName,
					email: input.email,
					clubShortName: caller.clubShortName,
				},
				select: {
					userId: true,
					firstName: true,
					lastName: true,
					email: true,
				},
			});
			return guest;
		}),

	/**
	 * Search guests in the caller's club by name prefix (case-insensitive).
	 * Used by the "Add to party" UI. Returns up to 20 matches sorted by
	 * createdAt DESC (most recent first).
	 */
	searchGuests: protectedProcedure
		.input(
			z.object({
				query: z.string().trim().min(1).max(60),
			}),
		)
		.query(async ({ ctx, input }) => {
			const caller = await ctx.db.user.findUnique({
				where: { clerkUserId: ctx.auth.userId },
				select: { clubShortName: true },
			});
			if (!caller) throw new TRPCError({ code: "UNAUTHORIZED" });

			const q = input.query;
			return ctx.db.user.findMany({
				where: {
					isGuest: true,
					clubShortName: caller.clubShortName,
					OR: [
						{ firstName: { startsWith: q, mode: "insensitive" } },
						{ lastName: { startsWith: q, mode: "insensitive" } },
					],
				},
				orderBy: { createdAt: "desc" },
				take: 20,
				select: {
					userId: true,
					firstName: true,
					lastName: true,
					email: true,
				},
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
			// Only while a game is IN_PROGRESS (not after a score is reported). Swapping
			// during PENDING_CONFIRM could remove the reporter, which would make the
			// opposing-side confirm guard fail open — so it's disallowed.
			if (assignment.status !== "IN_PROGRESS") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Players can only be swapped during a live game (before a score is reported).",
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
				// Incoming player gets a check-in directly in PLAYING. If they
				// don't already have one in this session, give them a fresh
				// solo party (openToFill=true so post-game re-queue mixes
				// normally).
				const existing = await tx.dropInCheckIn.findUnique({
					where: { sessionId_userId: { sessionId, userId: input.inUserId } },
					select: { checkInId: true },
				});
				if (existing) {
					await tx.dropInCheckIn.update({
						where: { sessionId_userId: { sessionId, userId: input.inUserId } },
						data: { status: "PLAYING", leftAt: null },
					});
				} else {
					const party = await tx.dropInParty.create({
						data: {
							sessionId,
							openToFill: true,
							createdByUserId: ctx.user.userId,
						},
					});
					await tx.dropInCheckIn.create({
						data: {
							sessionId,
							userId: input.inUserId,
							partyId: party.partyId,
							status: "PLAYING",
						},
					});
				}
				return swapped;
			});
		}),

	/**
	 * Staff (facility+): bulk-add unrelated walk-ins to the waiting pool. Each
	 * userId becomes its own `openToFill=true` solo party (max 8 per call —
	 * batch-size cap, NOT party size). To create a multi-person party that
	 * sticks together, use `createParty` + `addPartyMember` instead.
	 *
	 * Existing check-ins (any status) are re-entered into the queue without
	 * disturbing their party; fresh adds get a new solo party each.
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
			await ctx.db.$transaction(async (tx) => {
				for (const [i, userId] of input.userIds.entries()) {
					const stamp = new Date(now + i); // staggered for adjacent FIFO
					const existing = await tx.dropInCheckIn.findUnique({
						where: {
							sessionId_userId: { sessionId: input.sessionId, userId },
						},
						select: { checkInId: true },
					});
					if (existing) {
						await tx.dropInCheckIn.update({
							where: {
								sessionId_userId: { sessionId: input.sessionId, userId },
							},
							data: {
								status: "WAITING",
								queuedAt: stamp,
								leftAt: null,
							},
						});
						continue;
					}
					const party = await tx.dropInParty.create({
						data: {
							sessionId: input.sessionId,
							openToFill: true,
							queuedAt: stamp,
							createdByUserId: ctx.user.userId,
						},
					});
					await tx.dropInCheckIn.create({
						data: {
							sessionId: input.sessionId,
							userId,
							partyId: party.partyId,
							status: "WAITING",
							queuedAt: stamp,
						},
					});
				}
			});
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

				// Party-aware selection (designFiles/drop-in/group-join-feature-plan.md §3).
				// Replaces the prior slice(0, playersPerCourt) over per-checkin
				// rows — see plan §3 for the algorithm + A1-vs-combinatorial
				// divergence.
				const parties = await loadPartySummaries(tx, session.sessionId);
				const pick = pickNextOccupants(parties, playersPerCourt);
				if (!pick) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "No ready group can fill this court right now.",
					});
				}

				const claim = await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: session.sessionId,
						userId: { in: pick.userIds },
						status: "WAITING",
					},
					data: { status: "PLAYING" },
				});
				if (claim.count !== pick.userIds.length) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Players were just assigned elsewhere — try again.",
					});
				}

				// Race guard: an `addPartyMember` landing between our snapshot
				// and the claim could leave a just-added member out of pick.
				// Re-read each chosen party's live-WAITING-or-PLAYING count;
				// if any party's expected size doesn't match what we just
				// claimed, abort + retry.
				const counts = await tx.dropInCheckIn.groupBy({
					by: ["partyId"],
					where: {
						sessionId: session.sessionId,
						partyId: { in: pick.partyIds },
						status: { in: ["PLAYING", "WAITING"] },
					},
					_count: { userId: true },
				});
				for (const p of parties) {
					if (!pick.partyIds.includes(p.partyId)) continue;
					const actual = counts.find((c) => c.partyId === p.partyId)
						?._count.userId ?? 0;
					if (actual !== p.memberUserIds.length) {
						throw new TRPCError({
							code: "CONFLICT",
							message: "Party changed during selection — retry.",
						});
					}
				}

				// ratingWeight = null when TIMED (no GBR sync ever) OR when
				// any party in this assignment contains a guest member.
				const ratingWeight =
					isTimed || !pick.ratingEligible ? null : 1.0;

				return tx.dropInAssignment.create({
					data: {
						sessionId: session.sessionId,
						courtId: input.courtId,
						format,
						status: "IN_PROGRESS",
						startedAt: now,
						expiresAt,
						ratingWeight,
						participants: {
							create: pick.userIds.map((userId, i) => ({
								sessionId: session.sessionId,
								userId,
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
					session: {
						select: {
							clubShortName: true,
							sessionId: true,
							mode: true,
							format: true,
							status: true,
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
						// GBR sync ONLY when this assignment is rating-eligible.
						// Guest-containing assignments have ratingWeight=null
						// (set in formNext) — they must NEVER reach GBR.
						// TIMED assignments are also null (no scores at all).
						// Both leave gbrSyncStatus at NOT_APPLICABLE.
						gbrSyncStatus:
							assignment.ratingWeight === null ? "NOT_APPLICABLE" : "PENDING",
						// Idempotency key for GBR submission (data-model §5). == assignmentId.
						externalMatchId: assignment.assignmentId,
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
				// On-confirm auto-start: the court is now free — refill it from the pool.
				await autoStartMatchOnCourt(
					tx,
					{
						sessionId: assignment.session.sessionId,
						mode: assignment.session.mode,
						status: assignment.session.status,
						format: assignment.session.format,
					},
					assignment.courtId,
				);
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
					participants: {
						select: {
							userId: true,
							// Guest membership in the original assignment must be
							// honored here too — a staff score correction cannot
							// retroactively promote a guest-containing match to
							// GBR-eligible (designFiles/drop-in/group-join-feature-plan.md §6).
							user: { select: { isGuest: true } },
						},
					},
					session: {
						select: {
							clubShortName: true,
							sessionId: true,
							bestOf: true,
							pointsPerGame: true,
							mode: true,
							format: true,
							status: true,
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
			const hasGuest = assignment.participants.some((p) => p.user.isGuest);
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
						// Guest-containing assignments stay GBR-excluded even on
						// staff override. Non-guest assignments: 1.0x weight, GBR
						// sync queued.
						ratingWeight: hasGuest ? null : 1.0,
						gbrSyncStatus: hasGuest ? "NOT_APPLICABLE" : "PENDING",
						externalMatchId: assignment.assignmentId, // GBR idempotency key
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
				// On-confirm auto-start (only when this actually resolved a live game,
				// i.e. not an override of an already-confirmed one): refill the court.
				if (!wasConfirmed) {
					await autoStartMatchOnCourt(
						tx,
						{
							sessionId: assignment.session.sessionId,
							mode: assignment.session.mode,
							status: assignment.session.status,
							format: assignment.session.format,
						},
						assignment.courtId,
					);
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

						// Party-aware selection (designFiles/drop-in/group-join-feature-plan.md §3).
						// Court stays empty when no group can play (e.g. open
						// head + no clean fill, or all closed parties incomplete) —
						// next tick retries once the queue shape changes.
						const parties = await loadPartySummaries(tx, input.sessionId);
						const pick = pickNextOccupants(parties, playersPerCourt);
						if (!pick) return false;

						const claim = await tx.dropInCheckIn.updateMany({
							where: {
								sessionId: input.sessionId,
								userId: { in: pick.userIds },
								status: "WAITING",
							},
							data: { status: "PLAYING" },
						});
						if (claim.count !== pick.userIds.length) {
							throw new Error("CONTENDED");
						}

						// Race guard — see formNext for rationale.
						const counts = await tx.dropInCheckIn.groupBy({
							by: ["partyId"],
							where: {
								sessionId: input.sessionId,
								partyId: { in: pick.partyIds },
								status: { in: ["PLAYING", "WAITING"] },
							},
							_count: { userId: true },
						});
						for (const p of parties) {
							if (!pick.partyIds.includes(p.partyId)) continue;
							const actual = counts.find((c) => c.partyId === p.partyId)
								?._count.userId ?? 0;
							if (actual !== p.memberUserIds.length) {
								throw new Error("PARTY_CHANGED");
							}
						}

						// TIMED mode → ratingWeight stays null (no GBR sync).
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
									create: pick.userIds.map((userId) => ({
										sessionId: input.sessionId,
										userId,
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
