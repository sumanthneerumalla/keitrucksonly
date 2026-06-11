// @vitest-environment node
/**
 * Integration tests for the drop-in party procedures
 * (designFiles/drop-in/group-join-feature-plan.md §8 test matrix).
 *
 * These hit a REAL Postgres via the dev DB connection. Each test stands up its
 * own DropInSession (with a unique occurrenceDate) + a small set of test
 * users, runs procedures via tRPC's createCaller, and cleans up via cascade
 * delete of the session. Test users are created with `test_<uuid>`
 * clerkUserIds so they never collide with real seed data.
 *
 * Covered: T8 B2 snap, T9 C1 reject, T12-T14 disband variants, T15
 * requeueParty filter, T16 PAUSED block, T21 addToQueue creates one solo
 * party per userId.
 *
 * Not covered here (deferred — they require parallel transactions): T11
 * concurrent formNext+tickTimed claim race, T18 addPartyMember race during
 * selection.
 */

import { randomUUID } from "node:crypto";
import {
	type DropInSessionStatus,
	PrismaClient,
	UserType,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { dropInRouter } from "~/server/api/routers/dropIn";
import { createCallerFactory } from "~/server/api/trpc";

const db = new PrismaClient();
const createCaller = createCallerFactory(dropInRouter);

// The "Rotation" DROP_IN event we created earlier — see DB. We make new
// DropInSession rows underneath it for each test. The event itself is
// shared and not modified.
const EVENT_ID = "d1a4c740-3201-4377-b533-7b23f6ffb058";
const CLUB_SHORTNAME = "dc-badminton";

function caller(clerkUserId: string) {
	return createCaller({
		db,
		// Only ctx.auth.userId is read by the isAuthed middleware.
		// biome-ignore lint/suspicious/noExplicitAny: synthetic Clerk auth for tests
		auth: { userId: clerkUserId } as any,
		headers: new Headers(),
	});
}

interface TestUser {
	userId: string;
	clerkUserId: string;
	firstName: string | null;
}

async function createTestUser(
	firstName: string,
	overrides: { userType?: UserType } = {},
): Promise<TestUser> {
	const clerkUserId = `test_${randomUUID()}`;
	const u = await db.user.create({
		data: {
			clerkUserId,
			firstName,
			lastName: "Test",
			userType: overrides.userType ?? UserType.STUDENT,
			clubShortName: CLUB_SHORTNAME,
		},
		select: { userId: true, clerkUserId: true, firstName: true },
	});
	return u;
}

async function createTestSession(opts: {
	status?: DropInSessionStatus;
	mode?: "TIMED" | "MATCH" | "MANUAL";
}): Promise<string> {
	const event = await db.calendarEvent.findUniqueOrThrow({
		where: { eventId: EVENT_ID },
		select: { facilityId: true, clubShortName: true },
	});
	const s = await db.dropInSession.create({
		data: {
			clubShortName: event.clubShortName,
			eventId: EVENT_ID,
			occurrenceDate: new Date(), // unique per test (millisecond precision)
			mode: opts.mode ?? "TIMED",
			format: "DOUBLES",
			courtIds: [],
			status: opts.status ?? "ACTIVE",
			rotationMinutes: 15,
			startedAt: new Date(),
		},
		select: { sessionId: true },
	});
	return s.sessionId;
}

async function cleanup(sessionId: string, userIds: string[]): Promise<void> {
	// Session delete cascades to parties + check-ins + assignments.
	await db.dropInSession.delete({ where: { sessionId } }).catch(() => {});
	// Users get removed last; can fail harmlessly if dependent rows exist.
	if (userIds.length > 0) {
		await db.user.deleteMany({ where: { userId: { in: userIds } } });
	}
}

afterAll(async () => {
	await db.$disconnect();
});

// =============================================================================
// T8 — B2 snap: adding a solo-WAITING to a party pulls the party's queuedAt
// =============================================================================

describe("addPartyMember (B2 snap)", () => {
	let sessionId: string;
	let alice: TestUser;
	let bob: TestUser;
	let allUserIds: string[];

	beforeEach(async () => {
		sessionId = await createTestSession({});
		alice = await createTestUser("Alice");
		bob = await createTestUser("Bob");
		allUserIds = [alice.userId, bob.userId];
	});
	afterEach(async () => {
		await cleanup(sessionId, allUserIds);
	});

	it("snaps party.queuedAt to the earlier of the two (T8)", async () => {
		// Alice joins solo first (gets an early queuedAt).
		await caller(alice.clerkUserId).joinQueue({ sessionId });
		const aliceCheckIn = await db.dropInCheckIn.findFirstOrThrow({
			where: { sessionId, userId: alice.userId },
			select: { partyId: true, queuedAt: true },
		});

		// Wait a moment so Bob's timestamps are strictly later.
		await new Promise((r) => setTimeout(r, 20));

		// Bob creates a party (later queuedAt).
		const bobParty = await caller(bob.clerkUserId).createParty({ sessionId });
		const bobPartyBefore = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: bobParty.partyId },
			select: { queuedAt: true },
		});
		expect(bobPartyBefore.queuedAt.getTime()).toBeGreaterThan(
			aliceCheckIn.queuedAt.getTime(),
		);

		// Bob adds Alice. Per B2, Bob's party.queuedAt should snap to Alice's.
		await caller(bob.clerkUserId).addPartyMember({
			partyId: bobParty.partyId,
			targetUserId: alice.userId,
		});

		const bobPartyAfter = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: bobParty.partyId },
			select: { queuedAt: true },
		});
		expect(bobPartyAfter.queuedAt.getTime()).toBe(
			aliceCheckIn.queuedAt.getTime(),
		);
	});

	it("does NOT snap to a later queuedAt (snap is MIN only)", async () => {
		// Bob's party is created FIRST.
		const bobParty = await caller(bob.clerkUserId).createParty({ sessionId });
		const bobPartyAt = (
			await db.dropInParty.findUniqueOrThrow({
				where: { partyId: bobParty.partyId },
				select: { queuedAt: true },
			})
		).queuedAt;

		await new Promise((r) => setTimeout(r, 20));

		// Alice joins solo LATER.
		await caller(alice.clerkUserId).joinQueue({ sessionId });

		// Bob adds Alice. Bob's party.queuedAt should NOT change (Alice is later).
		await caller(bob.clerkUserId).addPartyMember({
			partyId: bobParty.partyId,
			targetUserId: alice.userId,
		});
		const bobPartyAfter = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: bobParty.partyId },
			select: { queuedAt: true },
		});
		expect(bobPartyAfter.queuedAt.getTime()).toBe(bobPartyAt.getTime());
	});
});

// =============================================================================
// T9 — C1: party > court capacity rejected at add time
// =============================================================================

describe("addPartyMember (C1 capacity)", () => {
	let sessionId: string;
	let users: TestUser[];

	beforeEach(async () => {
		// Use DOUBLES (capacity 4). A 5th add must be rejected.
		sessionId = await createTestSession({});
		users = await Promise.all(
			["A", "B", "C", "D", "E"].map((n) => createTestUser(n)),
		);
	});
	afterEach(async () => {
		await cleanup(
			sessionId,
			users.map((u) => u.userId),
		);
	});

	it("rejects when adding would exceed capacity (T9)", async () => {
		const owner = users[0];
		if (!owner) throw new Error("users[0] missing");
		const party = await caller(owner.clerkUserId).createParty({ sessionId });

		// Add 3 more — at capacity (4 total). Fine.
		for (const u of users.slice(1, 4)) {
			await caller(owner.clerkUserId).addPartyMember({
				partyId: party.partyId,
				targetUserId: u.userId,
			});
		}

		const fifth = users[4];
		if (!fifth) throw new Error("users[4] missing");
		await expect(
			caller(owner.clerkUserId).addPartyMember({
				partyId: party.partyId,
				targetUserId: fifth.userId,
			}),
		).rejects.toThrow(/capacity/i);
	});
});

// =============================================================================
// T12, T13, T14 — disband / leave variants
// =============================================================================

describe("disbandParty + leaveParty", () => {
	let sessionId: string;
	let alice: TestUser;
	let bob: TestUser;
	let charlie: TestUser;
	let allUserIds: string[];

	beforeEach(async () => {
		sessionId = await createTestSession({});
		alice = await createTestUser("Alice");
		bob = await createTestUser("Bob");
		charlie = await createTestUser("Charlie");
		allUserIds = [alice.userId, bob.userId, charlie.userId];
	});
	afterEach(async () => {
		await cleanup(sessionId, allUserIds);
	});

	it("T12: disband while WAITING flips all live members to LEFT", async () => {
		const party = await caller(alice.clerkUserId).createParty({ sessionId });
		await caller(alice.clerkUserId).addPartyMember({
			partyId: party.partyId,
			targetUserId: bob.userId,
		});
		await caller(alice.clerkUserId).disbandParty({ partyId: party.partyId });

		const checkIns = await db.dropInCheckIn.findMany({
			where: { sessionId, partyId: party.partyId },
			select: { userId: true, status: true },
		});
		expect(checkIns.length).toBe(2);
		expect(checkIns.every((c) => c.status === "LEFT")).toBe(true);
	});

	it("T13: disband while a member is PLAYING is rejected", async () => {
		const party = await caller(alice.clerkUserId).createParty({ sessionId });
		// Force Alice's check-in to PLAYING (simulating an in-progress game).
		await db.dropInCheckIn.update({
			where: { sessionId_userId: { sessionId, userId: alice.userId } },
			data: { status: "PLAYING" },
		});
		await expect(
			caller(alice.clerkUserId).disbandParty({ partyId: party.partyId }),
		).rejects.toThrow(/mid-game/i);
	});

	it("T14: last live member leaving makes the party defunct (no live members)", async () => {
		const party = await caller(alice.clerkUserId).createParty({ sessionId });
		await caller(alice.clerkUserId).leaveParty({ partyId: party.partyId });

		const live = await db.dropInCheckIn.findMany({
			where: {
				partyId: party.partyId,
				status: {
					in: ["WAITING", "IDLE", "PLAYING", "AWAITING_RESULT", "DONE"],
				},
			},
		});
		expect(live.length).toBe(0);
	});
});

// =============================================================================
// T15 — requeueParty filters: only IDLE members re-queue
// =============================================================================

describe("requeueParty", () => {
	let sessionId: string;
	let alice: TestUser;
	let bob: TestUser;
	let charlie: TestUser;
	let allUserIds: string[];

	beforeEach(async () => {
		sessionId = await createTestSession({});
		alice = await createTestUser("Alice");
		bob = await createTestUser("Bob");
		charlie = await createTestUser("Charlie");
		allUserIds = [alice.userId, bob.userId, charlie.userId];
	});
	afterEach(async () => {
		await cleanup(sessionId, allUserIds);
	});

	it("T15: re-queues IDLE members; LEFT members stay LEFT", async () => {
		const party = await caller(alice.clerkUserId).createParty({ sessionId });
		await caller(alice.clerkUserId).addPartyMember({
			partyId: party.partyId,
			targetUserId: bob.userId,
		});
		await caller(alice.clerkUserId).addPartyMember({
			partyId: party.partyId,
			targetUserId: charlie.userId,
		});

		// Simulate post-game state: Alice and Bob IDLE, Charlie LEFT mid-game.
		await db.dropInCheckIn.updateMany({
			where: {
				sessionId,
				userId: { in: [alice.userId, bob.userId] },
			},
			data: { status: "IDLE" },
		});
		await db.dropInCheckIn.update({
			where: { sessionId_userId: { sessionId, userId: charlie.userId } },
			data: { status: "LEFT" },
		});

		const before = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: party.partyId },
			select: { queuedAt: true },
		});
		await new Promise((r) => setTimeout(r, 20)); // ensure new queuedAt is strictly later

		const result = await caller(alice.clerkUserId).requeueParty({
			partyId: party.partyId,
		});

		expect(result.requeued).toBe(2);

		const final = await db.dropInCheckIn.findMany({
			where: { sessionId, partyId: party.partyId },
			select: { userId: true, status: true },
		});
		const byUser = new Map(final.map((c) => [c.userId, c.status]));
		expect(byUser.get(alice.userId)).toBe("WAITING");
		expect(byUser.get(bob.userId)).toBe("WAITING");
		expect(byUser.get(charlie.userId)).toBe("LEFT");

		const after = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: party.partyId },
			select: { queuedAt: true },
		});
		expect(after.queuedAt.getTime()).toBeGreaterThan(before.queuedAt.getTime());
	});

	it("returns requeued=0 when no members are IDLE", async () => {
		const party = await caller(alice.clerkUserId).createParty({ sessionId });
		// Caller is WAITING (joinQueue default), no IDLE members.
		const result = await caller(alice.clerkUserId).requeueParty({
			partyId: party.partyId,
		});
		expect(result.requeued).toBe(0);
	});
});

// =============================================================================
// T16 — PAUSED session blocks party ops
// =============================================================================

describe("PAUSED session guards", () => {
	let sessionId: string;
	let alice: TestUser;

	beforeEach(async () => {
		sessionId = await createTestSession({ status: "PAUSED" });
		alice = await createTestUser("Alice");
	});
	afterEach(async () => {
		await cleanup(sessionId, [alice.userId]);
	});

	it("T16: createParty rejected when session is PAUSED", async () => {
		await expect(
			caller(alice.clerkUserId).createParty({ sessionId }),
		).rejects.toThrow(/not active/i);
	});

	it("T16: setPartyOpenToFill rejected when session is PAUSED", async () => {
		// First flip session to ACTIVE so we can create the party, then back to PAUSED.
		await db.dropInSession.update({
			where: { sessionId },
			data: { status: "ACTIVE" },
		});
		const party = await caller(alice.clerkUserId).createParty({ sessionId });
		await db.dropInSession.update({
			where: { sessionId },
			data: { status: "PAUSED" },
		});

		await expect(
			caller(alice.clerkUserId).setPartyOpenToFill({
				partyId: party.partyId,
				openToFill: true,
			}),
		).rejects.toThrow(/not active/i);
	});
});

// =============================================================================
// T21 — Staff addToQueue creates one solo party per userId
// =============================================================================

describe("addToQueue (staff bulk-add)", () => {
	let sessionId: string;
	let staff: TestUser;
	let users: TestUser[];
	let allUserIds: string[];

	beforeEach(async () => {
		sessionId = await createTestSession({});
		staff = await createTestUser("Staff", {
			userType: UserType.PLATFORM_ADMIN,
		});
		users = await Promise.all(["A", "B", "C"].map((n) => createTestUser(n)));
		allUserIds = [staff.userId, ...users.map((u) => u.userId)];
	});
	afterEach(async () => {
		await cleanup(sessionId, allUserIds);
	});

	it("T21: N userIds become N separate openToFill solo parties", async () => {
		await caller(staff.clerkUserId).addToQueue({
			sessionId,
			userIds: users.map((u) => u.userId),
		});

		const parties = await db.dropInParty.findMany({
			where: { sessionId },
			include: { members: true },
		});
		expect(parties.length).toBe(3);
		for (const p of parties) {
			expect(p.openToFill).toBe(true);
			expect(p.members.length).toBe(1);
		}
	});
});

// =============================================================================
// Misc: createParty defaults; idempotent re-create on existing check-in
// =============================================================================

describe("createParty", () => {
	let sessionId: string;
	let alice: TestUser;

	beforeEach(async () => {
		sessionId = await createTestSession({});
		alice = await createTestUser("Alice");
	});
	afterEach(async () => {
		await cleanup(sessionId, [alice.userId]);
	});

	it("default openToFill is false (explicit closed party)", async () => {
		const r = await caller(alice.clerkUserId).createParty({ sessionId });
		const p = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: r.partyId },
			select: { openToFill: true },
		});
		expect(p.openToFill).toBe(false);
	});

	it("calling again with same caller reuses existing party (idempotent)", async () => {
		const first = await caller(alice.clerkUserId).createParty({ sessionId });
		const second = await caller(alice.clerkUserId).createParty({ sessionId });
		expect(second.partyId).toBe(first.partyId);
		expect(second.isNew).toBe(false);
	});
});

// =============================================================================
// joinExistingParty (outsider one-click join into an open party)
// =============================================================================

describe("joinExistingParty", () => {
	let sessionId: string;
	let owner: TestUser;
	let outsider: TestUser;
	let allUserIds: string[];

	beforeEach(async () => {
		sessionId = await createTestSession({});
		owner = await createTestUser("Owner");
		outsider = await createTestUser("Outsider");
		allUserIds = [owner.userId, outsider.userId];
	});
	afterEach(async () => {
		await cleanup(sessionId, allUserIds);
	});

	it("adds an outsider with no prior check-in into the open party", async () => {
		const party = await caller(owner.clerkUserId).createParty({
			sessionId,
			openToFill: true,
		});
		const r = await caller(outsider.clerkUserId).joinExistingParty({
			partyId: party.partyId,
		});
		expect(r.joined).toBe(true);

		const checkIn = await db.dropInCheckIn.findUniqueOrThrow({
			where: {
				sessionId_userId: { sessionId, userId: outsider.userId },
			},
			select: { partyId: true, status: true },
		});
		expect(checkIn.partyId).toBe(party.partyId);
		expect(checkIn.status).toBe("WAITING");
	});

	it("snaps party.queuedAt to the joiner's earlier WAITING position (their better position wins)", async () => {
		// Outsider joins solo first → earlier queuedAt.
		await caller(outsider.clerkUserId).joinQueue({ sessionId });
		const outsiderCheckIn = await db.dropInCheckIn.findFirstOrThrow({
			where: { sessionId, userId: outsider.userId },
			select: { queuedAt: true },
		});
		await new Promise((r) => setTimeout(r, 20));

		// Owner creates an open party LATER.
		const party = await caller(owner.clerkUserId).createParty({
			sessionId,
			openToFill: true,
		});
		const partyBefore = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: party.partyId },
			select: { queuedAt: true },
		});
		expect(partyBefore.queuedAt.getTime()).toBeGreaterThan(
			outsiderCheckIn.queuedAt.getTime(),
		);

		// Outsider joins owner's party → party snaps to outsider's earlier
		// queuedAt.
		await caller(outsider.clerkUserId).joinExistingParty({
			partyId: party.partyId,
		});

		const partyAfter = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: party.partyId },
			select: { queuedAt: true },
		});
		expect(partyAfter.queuedAt.getTime()).toBe(
			outsiderCheckIn.queuedAt.getTime(),
		);
	});

	it("does NOT snap when joiner is IDLE (no queue position to bring)", async () => {
		// Outsider is IDLE (checked in, never joined queue) — they have no
		// "position" so the party stays where it is.
		const party = await caller(owner.clerkUserId).createParty({
			sessionId,
			openToFill: true,
		});
		const partyBefore = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: party.partyId },
			select: { queuedAt: true },
		});

		await db.dropInCheckIn.create({
			data: {
				sessionId,
				userId: outsider.userId,
				partyId: (
					await db.dropInParty.create({
						data: {
							sessionId,
							openToFill: true,
							createdByUserId: outsider.userId,
						},
						select: { partyId: true },
					})
				).partyId,
				status: "IDLE",
			},
		});

		await caller(outsider.clerkUserId).joinExistingParty({
			partyId: party.partyId,
		});

		const partyAfter = await db.dropInParty.findUniqueOrThrow({
			where: { partyId: party.partyId },
			select: { queuedAt: true },
		});
		expect(partyAfter.queuedAt.getTime()).toBe(partyBefore.queuedAt.getTime());
	});

	it("rejects when the party is at capacity (C1)", async () => {
		const party = await caller(owner.clerkUserId).createParty({
			sessionId,
			openToFill: true,
		});
		// Pack the party to capacity (4 for DOUBLES). Add 3 more members via
		// addPartyMember — owner is already member #1, plus 3 makes 4.
		const fillers = await Promise.all(
			["F1", "F2", "F3"].map((n) => createTestUser(n)),
		);
		allUserIds.push(...fillers.map((u) => u.userId));
		for (const f of fillers) {
			await caller(owner.clerkUserId).addPartyMember({
				partyId: party.partyId,
				targetUserId: f.userId,
			});
		}

		await expect(
			caller(outsider.clerkUserId).joinExistingParty({
				partyId: party.partyId,
			}),
		).rejects.toThrow(/capacity/i);
	});

	it("rejects a closed (openToFill=false) party", async () => {
		const party = await caller(owner.clerkUserId).createParty({
			sessionId,
			openToFill: false,
		});
		await expect(
			caller(outsider.clerkUserId).joinExistingParty({
				partyId: party.partyId,
			}),
		).rejects.toThrow(/closed/i);
	});

	it("rejects when session is PAUSED", async () => {
		const party = await caller(owner.clerkUserId).createParty({
			sessionId,
			openToFill: true,
		});
		await db.dropInSession.update({
			where: { sessionId },
			data: { status: "PAUSED" },
		});
		await expect(
			caller(outsider.clerkUserId).joinExistingParty({
				partyId: party.partyId,
			}),
		).rejects.toThrow(/not active/i);
	});

	it("returns joined=false (no-op) if caller is already in the party", async () => {
		const party = await caller(owner.clerkUserId).createParty({
			sessionId,
			openToFill: true,
		});
		await caller(owner.clerkUserId).addPartyMember({
			partyId: party.partyId,
			targetUserId: outsider.userId,
		});
		const r = await caller(outsider.clerkUserId).joinExistingParty({
			partyId: party.partyId,
		});
		expect(r.joined).toBe(false);
	});
});
