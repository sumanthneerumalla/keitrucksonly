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
	/** True if any member has `isGuest = true` (suppresses GBR sync). */
	hasGuest: boolean;
}

export interface Pick {
	partyIds: string[];
	userIds: string[];
	/** False if any chosen party contained a guest — caller MUST set
	 * `DropInAssignment.ratingWeight = null` in that case. */
	ratingEligible: boolean;
}

/**
 * "Ready" = no member is currently on a court or owes a score.
 * IDLE = checked in or just finished a game; DONE = endSession only (defensive).
 */
export function isReady(party: PartySummary): boolean {
	for (const userId of party.memberUserIds) {
		const status = party.memberStatuses[userId];
		if (status !== "IDLE" && status !== "DONE") return false;
	}
	return true;
}

/**
 * Select the next group to occupy a freed court. `parties` MUST be pre-sorted
 * by `queuedAt ASC` (pure party FIFO — rule X in the plan).
 */
export function pickNextOccupants(
	parties: PartySummary[],
	capacity: number,
): Pick | null {
	for (let i = 0; i < parties.length; i++) {
		const head = parties[i];
		if (!head) continue;

		// A1: temporal blocker — try the next head.
		if (!isReady(head)) continue;

		// Closed party: must equal capacity to play; otherwise held in place
		// (incomplete closed party = waiting for its missing members).
		if (!head.openToFill) {
			if (head.memberUserIds.length === capacity) {
				return {
					partyIds: [head.partyId],
					userIds: [...head.memberUserIds],
					ratingEligible: !head.hasGuest,
				};
			}
			continue;
		}

		// Defensive: C1 (party > capacity rejected at create/add time) should
		// make this unreachable. If we see corrupt data, don't stall — log
		// and try the next head so one bad row doesn't freeze rotation.
		if (head.memberUserIds.length > capacity) {
			reportInvariantViolation("party larger than court capacity", {
				partyId: head.partyId,
				size: head.memberUserIds.length,
				capacity,
			});
			continue;
		}

		// Open party: try to fill from later open parties (FIFO).
		const chosen: PartySummary[] = [head];
		let chosenSize = head.memberUserIds.length;

		for (let j = i + 1; j < parties.length && chosenSize < capacity; j++) {
			const candidate = parties[j];
			if (!candidate) continue;
			if (!candidate.openToFill) continue;
			if (!isReady(candidate)) continue;

			const newSize = chosenSize + candidate.memberUserIds.length;
			if (newSize > capacity) continue; // overshoot — skip & scan further

			chosen.push(candidate);
			chosenSize = newSize;
		}

		if (chosenSize === capacity) {
			return {
				partyIds: chosen.map((p) => p.partyId),
				userIds: chosen.flatMap((p) => [...p.memberUserIds]),
				ratingEligible: chosen.every((p) => !p.hasGuest),
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
