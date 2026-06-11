/**
 * Drop-in party — shared helpers used by the party tRPC procedures.
 *
 * See designFiles/drop-in/group-join-feature-plan.md for the full design.
 */

import type { DropInFormat, DropInPlayerStatus, Prisma } from "@prisma/client";
import { UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { PartySummary } from "./pickNextOccupants";

/**
 * Statuses we consider "live" — counted toward a party's effective size and
 * eligible for selection. LEFT / CANCELLED check-ins keep their partyId for
 * audit but don't participate in any further party logic.
 */
const LIVE_STATUSES: readonly DropInPlayerStatus[] = [
	"WAITING",
	"IDLE",
	"PLAYING",
	"AWAITING_RESULT",
	"DONE",
];

/** Court capacity per session format. */
export function capacityForFormat(format: DropInFormat | null): number {
	// MANUAL sessions have format=null and don't run rotation. The party feature
	// is TIMED+MATCH scope (per plan), but we still want a sane default so the
	// validators don't crash if reached on a MANUAL session.
	if (format === "SINGLES") return 2;
	return 4;
}

/**
 * Club staff (facility / club admin / platform admin) may manage any party in
 * their club — disband a stuck group, remove a no-show member — without being
 * a member of it. Mirrors the role set behind `facilityProcedure`.
 */
export function isClubStaff(userType: UserType): boolean {
	return (
		userType === UserType.FACILITY ||
		userType === UserType.CLUB_ADMIN ||
		userType === UserType.PLATFORM_ADMIN
	);
}

// =============================================================================
// Guards — common rejection paths reused across procedures.
// =============================================================================

/** Throw NOT_FOUND if the session doesn't exist or isn't in the caller's club. */
export async function loadSessionForPartyOp(
	tx: Prisma.TransactionClient,
	sessionId: string,
	callerClubShortName: string,
): Promise<{
	sessionId: string;
	clubShortName: string;
	status: "SCHEDULED" | "ACTIVE" | "PAUSED" | "ENDED" | "CANCELLED";
	format: DropInFormat | null;
}> {
	const session = await tx.dropInSession.findUnique({
		where: { sessionId },
		select: {
			sessionId: true,
			clubShortName: true,
			status: true,
			format: true,
		},
	});
	if (!session || session.clubShortName !== callerClubShortName) {
		throw new TRPCError({ code: "NOT_FOUND" });
	}
	return session;
}

/**
 * Sessions accept party ops only when ACTIVE. PAUSED rejects (existing games
 * finish, no new joins). SCHEDULED, ENDED, CANCELLED all reject.
 */
export function assertSessionAcceptsPartyOps(session: {
	status: string;
}): void {
	if (session.status !== "ACTIVE") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Session is not active (status=${session.status}).`,
		});
	}
}

/**
 * Auth guard: throw FORBIDDEN if the caller is not a live member of the party.
 * "Live" here = check-in exists and status is not LEFT/CANCELLED. Audit-only
 * rows (members who left) don't count.
 */
export async function assertCallerInParty(
	tx: Prisma.TransactionClient,
	partyId: string,
	callerUserId: string,
): Promise<void> {
	const membership = await tx.dropInCheckIn.findFirst({
		where: {
			partyId,
			userId: callerUserId,
			status: { in: [...LIVE_STATUSES] },
		},
		select: { checkInId: true },
	});
	if (!membership) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You are not a member of this party.",
		});
	}
}

/** Load a party + its live members for capacity checks and queuedAt math. */
export async function loadPartyForOp(
	tx: Prisma.TransactionClient,
	partyId: string,
): Promise<{
	partyId: string;
	sessionId: string;
	openToFill: boolean;
	queuedAt: Date;
	liveMembers: Array<{
		userId: string;
		status: DropInPlayerStatus;
		queuedAt: Date;
	}>;
}> {
	const party = await tx.dropInParty.findUnique({
		where: { partyId },
		select: {
			partyId: true,
			sessionId: true,
			openToFill: true,
			queuedAt: true,
			members: {
				where: { status: { in: [...LIVE_STATUSES] } },
				select: { userId: true, status: true, queuedAt: true },
			},
		},
	});
	if (!party) throw new TRPCError({ code: "NOT_FOUND" });
	return {
		partyId: party.partyId,
		sessionId: party.sessionId,
		openToFill: party.openToFill,
		queuedAt: party.queuedAt,
		liveMembers: party.members,
	};
}

/**
 * C1: reject if adding one more member would exceed the court's capacity. The
 * spec is "party larger than capacity → reject" — so a party of 4 in a SINGLES
 * session can't even form, and a party of 4 in a DOUBLES session can't add a
 * 5th.
 */
export function assertPartyHasRoom(
	liveMemberCount: number,
	format: DropInFormat | null,
): void {
	const capacity = capacityForFormat(format);
	if (liveMemberCount + 1 > capacity) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Party is at capacity for this session (${capacity}).`,
		});
	}
}

/**
 * Attach a user's check-in to a party — the shared core of `addPartyMember`
 * and `joinExistingParty` (callers do auth + capacity + club checks first).
 * Moves an existing check-in (any prior party; the old solo party is left
 * defunct) or creates a fresh one (first time in this session — this is what
 * lets members pull in friends who never checked in). Revives LEFT/CANCELLED
 * check-ins.
 *
 * B2 snap: only a currently solo-WAITING target with an earlier queuedAt
 * gives the party its position (MIN). Non-WAITING check-ins (IDLE/DONE/fresh)
 * bring no position — a stale early timestamp must not drag the party forward.
 *
 * Status: a target mid-game (PLAYING / AWAITING_RESULT) keeps their status —
 * they're "not ready" for the party until their game resolves. Everyone else
 * lands WAITING. Member queuedAt mirrors the party's (fairness rule X).
 *
 * Returns false (no-op) when the user is already a live member of this party.
 */
export async function attachUserToParty(
	tx: Prisma.TransactionClient,
	party: { partyId: string; sessionId: string; queuedAt: Date },
	userId: string,
): Promise<boolean> {
	const existing = await tx.dropInCheckIn.findUnique({
		where: { sessionId_userId: { sessionId: party.sessionId, userId } },
		select: { partyId: true, queuedAt: true, status: true },
	});
	if (
		existing &&
		existing.partyId === party.partyId &&
		existing.status !== "LEFT" &&
		existing.status !== "CANCELLED"
	) {
		return false; // already a live member — idempotent no-op
	}

	let partyQueuedAt = party.queuedAt;
	if (
		existing &&
		existing.status === "WAITING" &&
		existing.queuedAt < partyQueuedAt
	) {
		partyQueuedAt = existing.queuedAt;
		await tx.dropInParty.update({
			where: { partyId: party.partyId },
			data: { queuedAt: partyQueuedAt },
		});
	}

	// Upsert, not update/create, so a concurrent add / double-click can't blow
	// up with a unique-constraint error on (sessionId, userId): if a row
	// appeared since the findUnique above, just move them into this party.
	await tx.dropInCheckIn.upsert({
		where: { sessionId_userId: { sessionId: party.sessionId, userId } },
		create: {
			sessionId: party.sessionId,
			userId,
			partyId: party.partyId,
			status: "WAITING",
			queuedAt: partyQueuedAt,
		},
		update: {
			partyId: party.partyId,
			status:
				existing?.status === "PLAYING" || existing?.status === "AWAITING_RESULT"
					? existing.status
					: "WAITING",
			queuedAt: partyQueuedAt,
			leftAt: null,
		},
	});
	return true;
}

/**
 * Atomically claim a pick's WAITING members (→ PLAYING) and verify no chosen
 * party changed shape between the snapshot and the claim. Shared by formNext /
 * tickTimed / MATCH auto-start. Returns false on contention or a party-shape
 * change — callers throw/skip/retry on their own terms (the next tick or a
 * manual retry re-runs selection against the new queue shape).
 *
 * The race this guards: an `addPartyMember` landing between the
 * `loadPartySummaries` snapshot and the claim would silently leave the
 * just-added member off the court. Post-claim, each chosen party's
 * WAITING+PLAYING count must equal the snapshot's WAITING count (the members
 * the claim was meant to seat).
 */
export async function claimPickedMembers(
	tx: Prisma.TransactionClient,
	sessionId: string,
	parties: PartySummary[],
	pick: { partyIds: string[]; userIds: string[] },
): Promise<boolean> {
	const claim = await tx.dropInCheckIn.updateMany({
		where: { sessionId, userId: { in: pick.userIds }, status: "WAITING" },
		data: { status: "PLAYING" },
	});
	if (claim.count !== pick.userIds.length) return false;

	const counts = await tx.dropInCheckIn.groupBy({
		by: ["partyId"],
		where: {
			sessionId,
			partyId: { in: pick.partyIds },
			status: { in: ["PLAYING", "WAITING"] },
		},
		_count: { userId: true },
	});
	for (const p of parties) {
		if (!pick.partyIds.includes(p.partyId)) continue;
		const waitingInSnapshot = p.memberUserIds.filter(
			(uid) => p.memberStatuses[uid] === "WAITING",
		).length;
		const actual =
			counts.find((c) => c.partyId === p.partyId)?._count.userId ?? 0;
		if (actual !== waitingInSnapshot) return false;
	}
	return true;
}

// =============================================================================
// Pool loader — reads parties for pickNextOccupants. Called by formNext /
// tickTimed (next task).
// =============================================================================

/**
 * Load every party in the session that has at least one live member, with the
 * member-status snapshot pickNextOccupants needs. Sorted by party.queuedAt ASC
 * (rule X — pure party FIFO).
 *
 * Defunct parties (no live members) are filtered out.
 */
export async function loadPartySummaries(
	tx: Prisma.TransactionClient,
	sessionId: string,
): Promise<PartySummary[]> {
	const parties = await tx.dropInParty.findMany({
		where: { sessionId },
		orderBy: { queuedAt: "asc" },
		select: {
			partyId: true,
			openToFill: true,
			queuedAt: true,
			preferredCourtId: true,
			members: {
				where: { status: { in: [...LIVE_STATUSES] } },
				select: { userId: true, status: true },
			},
		},
	});

	const out: PartySummary[] = [];
	for (const p of parties) {
		if (p.members.length === 0) continue; // defunct
		const memberStatuses: Record<string, DropInPlayerStatus> = {};
		const memberUserIds: string[] = [];
		for (const m of p.members) {
			memberUserIds.push(m.userId);
			memberStatuses[m.userId] = m.status;
		}
		out.push({
			partyId: p.partyId,
			openToFill: p.openToFill,
			queuedAt: p.queuedAt,
			preferredCourtId: p.preferredCourtId,
			memberUserIds,
			memberStatuses,
		});
	}
	return out;
}
