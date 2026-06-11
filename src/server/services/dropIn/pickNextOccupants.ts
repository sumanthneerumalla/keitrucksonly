/**
 * Drop-in court allocation — group/party-aware selection.
 *
 * See designFiles/drop-in/group-join-feature-plan.md §3 for the full spec.
 *
 * Inputs: a session's parties (already sorted by party.queuedAt ASC, the
 * pure-FIFO ordering rule X) and the court's capacity (2 for SINGLES, 4 for
 * DOUBLES/MIXED_DOUBLES).
 *
 * Output: a `Pick` naming the parties + member userIds that should be assigned
 * to the next freed court, or `null` if no group can play right now (the court
 * stays empty until the queue shape changes).
 *
 * Two distinct "head can't serve this court" cases:
 *
 *   A1 — TEMPORAL blocker (a member is PLAYING/AWAITING_RESULT on another
 *        court). Resolves naturally when that game ends. → SKIP head, try next.
 *
 *   COMBINATORIAL blocker (open head, but no clean fill — e.g. head of 2 +
 *        only oversized closed parties remain). Only resolves when the queue
 *        shape changes. → STOP; leave the court empty.
 *
 * Both are intentional and not contradictory: A1 is "wait a tick and they'll be
 * ready"; combinatorial is "waiting won't help, the queue itself has to
 * change". The plan called this out explicitly under §3 so it's not read as a
 * contradiction.
 *
 * Atomicity: this function is PURE. The caller takes a snapshot inside a
 * transaction, runs this selector, and re-claims via `updateMany WHERE
 * status=WAITING` (the existing pattern in formNext/tickTimed). A race guard
 * after the claim catches `addPartyMember` landings between snapshot and
 * claim — see plan §3.
 */

import type { DropInPlayerStatus } from "@prisma/client";

export interface PartySummary {
	partyId: string;
	openToFill: boolean;
	queuedAt: Date;
	memberUserIds: string[];
	/** Status snapshot per member at the moment we read the pool. */
	memberStatuses: Record<string, DropInPlayerStatus>;
	/**
	 * Hard court lock (court-preference feature). null/undefined = any court.
	 * When set, the party is only eligible for that court — see the `courtId`
	 * filter in `pickNextOccupants`.
	 */
	preferredCourtId?: string | null;
}

export interface Pick {
	partyIds: string[];
	userIds: string[];
}

/**
 * A party is selectable when:
 *   - No member is mid-game elsewhere (PLAYING / AWAITING_RESULT) — that's the
 *     A1 temporal blocker; skip the party but keep its queue position.
 *   - At least one member is currently `WAITING` — i.e. the party is *in*
 *     the queue this round. Members at IDLE/DONE/LEFT/CANCELLED don't count
 *     toward the party's effective size; they must explicitly re-queue
 *     (requeueParty) to be considered.
 *
 * Returns `ready: false` for either failure mode so callers don't need to
 * distinguish them at the algorithm level. The waiting count is the party's
 * "in the queue right now" size and is what the algorithm matches against
 * court capacity.
 */
export function isReady(party: PartySummary): {
	ready: boolean;
	waitingCount: number;
} {
	let waitingCount = 0;
	for (const userId of party.memberUserIds) {
		const status = party.memberStatuses[userId];
		if (status === "PLAYING" || status === "AWAITING_RESULT") {
			return { ready: false, waitingCount: 0 };
		}
		if (status === "WAITING") waitingCount++;
	}
	if (waitingCount === 0) return { ready: false, waitingCount: 0 };
	return { ready: true, waitingCount };
}

/** Subset of a party's members currently `WAITING` — used to materialize the
 * exact userIds the caller's `updateMany WHERE status=WAITING` claim will
 * touch. IDLE / DONE / LEFT / CANCELLED are excluded. */
function waitingMembersOf(party: PartySummary): string[] {
	return party.memberUserIds.filter(
		(uid) => party.memberStatuses[uid] === "WAITING",
	);
}

/**
 * Select the next group to occupy a freed court. `parties` MUST be pre-sorted
 * by `queuedAt ASC` (pure party FIFO — rule X in the plan).
 */
export function pickNextOccupants(
	parties: PartySummary[],
	capacity: number,
	/**
	 * The court being filled. When provided, only parties whose
	 * `preferredCourtId` is null/undefined (any court) OR equals this court are
	 * eligible — that's the hard court lock (court-preference feature). Omit to
	 * consider all parties (legacy / court-agnostic behavior).
	 */
	courtId?: string,
): Pick | null {
	// Court-eligibility pre-filter (preserves FIFO order). A party locked to a
	// different court is simply never a candidate for this court.
	const eligible = courtId
		? parties.filter(
				(p) => !p.preferredCourtId || p.preferredCourtId === courtId,
			)
		: parties;

	for (let i = 0; i < eligible.length; i++) {
		const head = eligible[i];
		if (!head) continue;

		const headStatus = isReady(head);
		// A1 (member mid-game elsewhere) OR not-in-queue (no WAITING members
		// yet — party hasn't re-queued). Both just skip the head; queue order
		// is preserved.
		if (!headStatus.ready) continue;

		// Closed party: WAITING-count must equal capacity. If members exist but
		// some are at IDLE (haven't rejoined yet), the party isn't ready THIS
		// round — held in place, try next head.
		if (!head.openToFill) {
			if (headStatus.waitingCount === capacity) {
				return {
					partyIds: [head.partyId],
					userIds: waitingMembersOf(head),
				};
			}
			continue;
		}

		// Defensive: C1 (party > capacity rejected at create/add time) should
		// make this unreachable. If we see corrupt data, don't stall — log
		// and try the next head so one bad row doesn't freeze rotation.
		if (headStatus.waitingCount > capacity) {
			reportInvariantViolation("party larger than court capacity", {
				partyId: head.partyId,
				waitingCount: headStatus.waitingCount,
				capacity,
			});
			continue;
		}

		// Open party: try to fill from later open parties (FIFO).
		const chosen: PartySummary[] = [head];
		let chosenSize = headStatus.waitingCount;

		for (let j = i + 1; j < eligible.length && chosenSize < capacity; j++) {
			const candidate = eligible[j];
			if (!candidate) continue;
			if (!candidate.openToFill) continue;
			const candStatus = isReady(candidate);
			if (!candStatus.ready) continue;

			const newSize = chosenSize + candStatus.waitingCount;
			if (newSize > capacity) continue; // overshoot — skip & scan further

			chosen.push(candidate);
			chosenSize = newSize;
		}

		if (chosenSize === capacity) {
			return {
				partyIds: chosen.map((p) => p.partyId),
				userIds: chosen.flatMap((p) => waitingMembersOf(p)),
			};
		}

		// COMBINATORIAL stall — head is open and ready but the pool can't
		// produce a clean fill. Court stays empty until the queue shape
		// changes (someone joins, leaves, becomes openToFill, etc.). Do NOT
		// advance to the next head — the head's slot is sacred.
		return null;
	}

	return null;
}

/**
 * Hook for surfacing data-corruption signals during the selection. Kept as a
 * thin indirection so callers (and tests) can swap in a Sentry breadcrumb
 * later without changing this file. Default behavior: console.error.
 */
function reportInvariantViolation(
	message: string,
	context: Record<string, unknown>,
): void {
	// eslint-disable-next-line no-console
	console.error("[pickNextOccupants] invariant violation:", message, context);
}
