import type { DropInPlayerStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
	type PartySummary,
	type Pick,
	isReady,
	pickNextOccupants,
} from "./pickNextOccupants";

// -----------------------------------------------------------------------------
// Test helpers — build PartySummary fixtures concisely.
// -----------------------------------------------------------------------------

let nextQueuedAtMs = 1_000_000; // arbitrary, monotonic per fixture

function nextDate(): Date {
	const d = new Date(nextQueuedAtMs);
	nextQueuedAtMs += 1000;
	return d;
}

interface PartyOpts {
	open?: boolean;
	size?: number;
	statuses?: DropInPlayerStatus[]; // defaults to all IDLE
	hasGuest?: boolean;
	id?: string;
	memberPrefix?: string;
}

function party(opts: PartyOpts = {}): PartySummary {
	const size = opts.size ?? 1;
	const id = opts.id ?? `pty_${Math.random().toString(36).slice(2, 10)}`;
	const memberUserIds = Array.from(
		{ length: size },
		(_, i) => `${opts.memberPrefix ?? `u_${id}`}_${i}`,
	);
	const memberStatuses: Record<string, DropInPlayerStatus> = {};
	for (let i = 0; i < size; i++) {
		const userId = memberUserIds[i];
		if (!userId) continue;
		// Default to WAITING — that's the "in queue" status. IDLE means
		// checked in but not in queue (needs explicit rejoin/requeueParty).
		memberStatuses[userId] = opts.statuses?.[i] ?? "WAITING";
	}
	return {
		partyId: id,
		openToFill: opts.open ?? false,
		queuedAt: nextDate(),
		memberUserIds,
		memberStatuses,
		hasGuest: opts.hasGuest ?? false,
	};
}

function expectPicked(result: Pick | null, partyIds: string[]): void {
	expect(result).not.toBeNull();
	expect(result?.partyIds).toEqual(partyIds);
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("isReady", () => {
	it("returns ready=true with the WAITING count when all members are WAITING", () => {
		const r = isReady(party({ size: 2, statuses: ["WAITING", "WAITING"] }));
		expect(r).toEqual({ ready: true, waitingCount: 2 });
	});
	it("counts only WAITING toward the in-queue size (IDLE members excluded)", () => {
		const r = isReady(party({ size: 3, statuses: ["WAITING", "IDLE", "WAITING"] }));
		expect(r).toEqual({ ready: true, waitingCount: 2 });
	});
	it("returns ready=false when any member is PLAYING (A1 temporal blocker)", () => {
		const r = isReady(party({ size: 2, statuses: ["WAITING", "PLAYING"] }));
		expect(r.ready).toBe(false);
	});
	it("returns ready=false when any member is AWAITING_RESULT (A3 gate)", () => {
		const r = isReady(party({ size: 2, statuses: ["WAITING", "AWAITING_RESULT"] }));
		expect(r.ready).toBe(false);
	});
	it("returns ready=false when no member is WAITING (party not in queue)", () => {
		const r = isReady(party({ size: 2, statuses: ["IDLE", "IDLE"] }));
		expect(r).toEqual({ ready: false, waitingCount: 0 });
	});
});

describe("pickNextOccupants", () => {
	// ---- Closed parties --------------------------------------------------------

	it("T1: closed party of 4 at head, all IDLE, DOUBLES → assigned", () => {
		const p = party({ size: 4, open: false, id: "pty_alice" });
		const result = pickNextOccupants([p], 4);
		expectPicked(result, ["pty_alice"]);
		expect(result?.userIds).toHaveLength(4);
		expect(result?.ratingEligible).toBe(true);
	});

	it("T2: closed party of 3 at head (incomplete) → null", () => {
		const p = party({ size: 3, open: false, id: "pty_incomplete" });
		expect(pickNextOccupants([p], 4)).toBeNull();
	});

	it("T3: closed party of 4 with one member PLAYING → null (A1)", () => {
		const p = party({
			size: 4,
			open: false,
			statuses: ["IDLE", "IDLE", "PLAYING", "IDLE"],
		});
		expect(pickNextOccupants([p], 4)).toBeNull();
	});

	// ---- Open + fill ----------------------------------------------------------

	it("T4: open solo head + open party of 3 → both assigned (user's verified scenario)", () => {
		const solo = party({ open: true, id: "pty_solo" });
		const trio = party({ open: true, size: 3, id: "pty_trio" });
		const result = pickNextOccupants([solo, trio], 4);
		expectPicked(result, ["pty_solo", "pty_trio"]);
		expect(result?.userIds).toHaveLength(4);
	});

	it("T5: open solo + open trio + open trio → solo + first trio, second untouched", () => {
		const solo = party({ open: true, id: "pty_solo" });
		const trio1 = party({ open: true, size: 3, id: "pty_trio1" });
		const trio2 = party({ open: true, size: 3, id: "pty_trio2" });
		const result = pickNextOccupants([solo, trio1, trio2], 4);
		expectPicked(result, ["pty_solo", "pty_trio1"]);
		expect(result?.userIds).toHaveLength(4);
	});

	it("T6: open pair + open trio + open solo + open solo → pair + two solos (skip trio overshoot)", () => {
		const pair = party({ open: true, size: 2, id: "pty_pair" });
		const trio = party({ open: true, size: 3, id: "pty_trio" });
		const s1 = party({ open: true, id: "pty_s1" });
		const s2 = party({ open: true, id: "pty_s2" });
		const result = pickNextOccupants([pair, trio, s1, s2], 4);
		expectPicked(result, ["pty_pair", "pty_s1", "pty_s2"]);
	});

	it("T7: open head + no compatible fillers → null (court stays empty)", () => {
		const head = party({ open: true, size: 1, id: "pty_head" });
		const fat = party({ open: true, size: 4, id: "pty_fat" }); // overshoot
		const result = pickNextOccupants([head, fat], 4);
		expect(result).toBeNull();
	});

	// ---- A1 vs combinatorial stall — the spec's key divergence ----------------

	it("T17: open solo head NOT ready (PLAYING) + closed trio at #2 → A1 skip head, trio incomplete → null", () => {
		// Solo at head is PLAYING (mid-game on another court) — A1 says skip.
		// Next head is a closed trio (incomplete for cap=4) — try next head.
		// No more heads → null.
		const solo = party({
			open: true,
			size: 1,
			statuses: ["PLAYING"],
			id: "pty_solo",
		});
		const trio = party({ open: false, size: 3, id: "pty_trio_closed" });
		expect(pickNextOccupants([solo, trio], 4)).toBeNull();
	});

	it("A1 advances when head is not ready, then assigns the next-head closed full party", () => {
		const blocked = party({
			open: false,
			size: 4,
			statuses: ["PLAYING", "IDLE", "IDLE", "IDLE"],
			id: "pty_blocked",
		});
		const ready = party({ open: false, size: 4, id: "pty_ready" });
		const result = pickNextOccupants([blocked, ready], 4);
		expectPicked(result, ["pty_ready"]);
	});

	// ---- Composition: skip overshoot, scan further ----------------------------

	it("T22: open pair + open trio + open pair → skip trio overshoot, combine pair + pair", () => {
		const head = party({ open: true, size: 2, id: "pty_head_pair" });
		const trio = party({ open: true, size: 3, id: "pty_trio" });
		const tail = party({ open: true, size: 2, id: "pty_tail_pair" });
		const result = pickNextOccupants([head, trio, tail], 4);
		expectPicked(result, ["pty_head_pair", "pty_tail_pair"]);
		expect(result?.userIds).toHaveLength(4);
	});

	// ---- SINGLES (capacity = 2) -----------------------------------------------

	it("closed pair at head, SINGLES → assigned", () => {
		const pair = party({ open: false, size: 2, id: "pty_pair" });
		const result = pickNextOccupants([pair], 2);
		expectPicked(result, ["pty_pair"]);
		expect(result?.userIds).toHaveLength(2);
	});

	it("two open solos at head, SINGLES → both assigned together", () => {
		const s1 = party({ open: true, id: "pty_s1" });
		const s2 = party({ open: true, id: "pty_s2" });
		const result = pickNextOccupants([s1, s2], 2);
		expectPicked(result, ["pty_s1", "pty_s2"]);
	});

	it("open solo head + open pair next, SINGLES → solo blocked (pair would overshoot 1+2)", () => {
		// With cap=2, an open solo head needs +1 more solo. A pair at #2 would
		// overshoot (1+2=3) — skip it, scan further, find nothing → court empty.
		const solo = party({ open: true, id: "pty_solo" });
		const pair = party({ open: true, size: 2, id: "pty_pair" });
		expect(pickNextOccupants([solo, pair], 2)).toBeNull();
	});

	// ---- Guest handling -------------------------------------------------------

	it("T10 (algorithmic half): party containing a guest → ratingEligible=false", () => {
		const p = party({
			size: 4,
			open: false,
			hasGuest: true,
			id: "pty_with_guest",
		});
		const result = pickNextOccupants([p], 4);
		expectPicked(result, ["pty_with_guest"]);
		expect(result?.ratingEligible).toBe(false);
	});

	it("open assembly: any guest in the assembled set → ratingEligible=false", () => {
		const head = party({ open: true, size: 2, id: "pty_clean_pair" });
		const tail = party({
			open: true,
			size: 2,
			hasGuest: true,
			id: "pty_guest_pair",
		});
		const result = pickNextOccupants([head, tail], 4);
		expectPicked(result, ["pty_clean_pair", "pty_guest_pair"]);
		expect(result?.ratingEligible).toBe(false);
	});

	// ---- Defensive: corrupt oversize party ------------------------------------

	it("defensive: party larger than capacity → skipped (does not stall rotation)", () => {
		const corrupt: PartySummary = {
			partyId: "pty_corrupt",
			openToFill: true,
			queuedAt: nextDate(),
			memberUserIds: ["a", "b", "c", "d", "e"], // 5 in a 4-cap court
			memberStatuses: { a: "IDLE", b: "IDLE", c: "IDLE", d: "IDLE", e: "IDLE" },
			hasGuest: false,
		};
		const next = party({ open: false, size: 4, id: "pty_next" });
		const result = pickNextOccupants([corrupt, next], 4);
		// Corrupt party is skipped; the next closed-full party is assigned.
		expectPicked(result, ["pty_next"]);
	});

	// ---- Mixed: closed party at head followed by open parties -----------------

	it("closed-incomplete head is held; algorithm tries next head", () => {
		// Per the plan: incomplete closed party "continues" — try next head.
		const closedIncomplete = party({
			open: false,
			size: 2,
			id: "pty_closed_incomplete",
		});
		const openFull = party({ open: true, size: 4, id: "pty_open_full" });
		const result = pickNextOccupants([closedIncomplete, openFull], 4);
		expectPicked(result, ["pty_open_full"]);
	});

	it("empty pool → null", () => {
		expect(pickNextOccupants([], 4)).toBeNull();
	});
});
