/**
 * TIMED auto-rotation — complete every expired slot and form the next group on
 * that court from the WAITING pool.
 *
 * Called as READ-REPAIR from the board readers (`getBoard` / `getPublicBoard`):
 * any open browser polling a board — member, spectator, or logged-out kiosk —
 * keeps rotation moving. The server's stored `expiresAt` vs server `now` is the
 * only source of truth; clients never decide when to rotate (the on-screen
 * countdown and horn are display-only). A future headless scheduler (R3 Track
 * C) can call this same function for zero-viewer rotation.
 *
 * Idempotent + race-safe: each expired slot is claimed via a conditional
 * IN_PROGRESS → COMPLETED update, so concurrent callers (several open boards
 * polling at once) can't double-rotate, and the party claim inside is guarded
 * by `claimPickedMembers`.
 */

import { DropInFormat, type PrismaClient } from "@prisma/client";
import {
	claimPickedMembers,
	loadPartySummaries,
} from "~/server/services/dropIn/party";
import { pickNextOccupants } from "~/server/services/dropIn/pickNextOccupants";

export async function rotateExpiredSlots(
	db: PrismaClient,
	session: {
		sessionId: string;
		status: string;
		mode: string;
		format: DropInFormat | null;
		rotationMinutes: number | null;
	},
): Promise<number> {
	if (session.status !== "ACTIVE" || session.mode !== "TIMED") return 0;

	const now = new Date();
	const expired = await db.dropInAssignment.findMany({
		where: {
			sessionId: session.sessionId,
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
			const formed = await db.$transaction(async (tx) => {
				// Claim: only the caller that flips IN_PROGRESS -> COMPLETED proceeds.
				const claimed = await tx.dropInAssignment.updateMany({
					where: { assignmentId: slot.assignmentId, status: "IN_PROGRESS" },
					data: { status: "COMPLETED", endedAt: now },
				});
				if (claimed.count === 0) return false;

				// Free the finishing players back to the pool (explicit re-queue, A12).
				await tx.dropInCheckIn.updateMany({
					where: {
						sessionId: session.sessionId,
						userId: { in: slot.participants.map((p) => p.userId) },
					},
					data: {
						status: "IDLE",
						gamesPlayed: { increment: 1 },
						lastPlayedAt: now,
					},
				});

				// Party-aware selection (designFiles/drop-in/group-join-feature-plan.md
				// §3). Court stays empty when no group can play — the next repair
				// retries once the queue shape changes.
				const parties = await loadPartySummaries(tx, session.sessionId);
				const pick = pickNextOccupants(parties, playersPerCourt, slot.courtId);
				if (!pick) return false;

				if (!(await claimPickedMembers(tx, session.sessionId, parties, pick))) {
					// Contended or party changed — the catch below skips this slot;
					// the next repair retries it.
					throw new Error("CONTENDED");
				}

				// TIMED mode → ratingWeight stays null (no GBR sync).
				await tx.dropInAssignment.create({
					data: {
						sessionId: session.sessionId,
						courtId: slot.courtId,
						format,
						status: "IN_PROGRESS",
						startedAt: now,
						expiresAt: new Date(
							now.getTime() + (session.rotationMinutes ?? 15) * 60_000,
						),
						participants: {
							create: pick.userIds.map((userId) => ({
								sessionId: session.sessionId,
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
			// Contended/transient — skip this slot; the next repair retries it.
		}
	}

	return rotated;
}
