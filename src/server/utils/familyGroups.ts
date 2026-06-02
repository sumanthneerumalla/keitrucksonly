/**
 * Phase 12a Round 2.7 — Auto-family-group linker.
 *
 * Implements the §7.8.6 simplified rule from
 * `designFiles/roadmap/phase12-stripe-connect.md`. Called by the webhook
 * dispatch after both buyer and beneficiary have been resolved to local
 * `User` rows. Returns a discriminated outcome so the confirmation page
 * (§7.8.7) can render the right branch.
 *
 * SIMPLIFIED 2026-05-30: 3 outcomes (was 6). The directional "extended"
 * variants were premature complexity for a rare-and-recoverable scenario;
 * the rule is now "either party already has a group → DO NOT TOUCH".
 *
 * Locked decisions:
 *  - HANDOFF #7 — `FamilyGroup` is club-scoped. A user in two clubs may sit
 *    in two independent FamilyGroups (one per club). The link operation is
 *    therefore conditioned on `clubShortName`.
 *  - §7.8.11 E7 — concurrent purchases for the same (buyer, beneficiary)
 *    pair must NOT create duplicate FamilyGroups. We acquire a
 *    `pg_advisory_xact_lock` keyed on `family-group-${clubShortName}-${sortedIdPair}`
 *    BEFORE reading either user's current `familyGroupId`. Sorting the two
 *    user ids ensures the same key regardless of call order.
 *  - §7.8.5 — same-email dedup short-circuits BEFORE reaching this helper
 *    (dispatch.ts collapses to one identity). Defensive `no_op_self_pay`
 *    outcome retained in case a caller passes `userIdA === userIdB`.
 *  - Cross-tenant defensive check: both users MUST have a `UserClub` row
 *    for the target `clubShortName` before linking. A new user resolved
 *    from a brand-new Clerk lookup will already have one — `findOrCreateLocalUserAccount`
 *    creates the UserClub row inside the same dispatch tx. Refuse if either
 *    user is missing the membership (would indicate a programming bug or a
 *    tampered intent).
 */

import type { Prisma } from "@prisma/client";

// ============================================================
// Outcome shape (re-exported as FamilyGroupLinkOutcome from
// `~/server/services/payments/types`)
// ============================================================

export type FamilyGroupLinkOutcome =
	| "created"
	| "not_linked_existing_group"
	| "no_op_self_pay";

// ============================================================
// linkFamilyGroup
// ============================================================

export interface LinkFamilyGroupInput {
	userIdA: string;
	userIdB: string;
	clubShortName: string;
}

/**
 * Apply the §7.8.6 simplified rule for two distinct identities at a paid
 * checkout. Idempotent under concurrent retry via PG advisory lock.
 *
 * The two userIds are symmetric — `userIdA` and `userIdB` carry no
 * semantic priority (the "buyer" vs "beneficiary" framing is dispatch's
 * concern; here we only see two userIds and a club). The returned outcome
 * is enough for the confirmation page (§7.8.7) to render the right branch.
 *
 * Rule (3 outcomes):
 *   - `userIdA === userIdB` (defensive — dedup already collapsed):
 *       → `no_op_self_pay`, no DB writes.
 *   - EITHER user already in a club-scoped FamilyGroup at `clubShortName`:
 *       → `not_linked_existing_group`, family groups untouched. Trade-off
 *         accepted (§7.8.6): when a parent already has a family group and
 *         buys for a brand-new kid, the kid does NOT auto-join. Admin can
 *         manually link via the existing "Add to family" flow afterward.
 *   - Neither in a group → create a new FamilyGroup containing both:
 *       → `created`.
 *
 * MUST be called from inside a Prisma `$transaction` — the advisory lock
 * is acquired with `pg_advisory_xact_lock`, which auto-releases on tx commit
 * or rollback.
 */
export async function linkFamilyGroup(
	tx: Prisma.TransactionClient,
	{ userIdA, userIdB, clubShortName }: LinkFamilyGroupInput,
): Promise<FamilyGroupLinkOutcome> {
	// §7.8.5 defensive — same-email dedup already collapses in dispatch, but
	// guard against a caller that bypassed the collapse.
	if (userIdA === userIdB) {
		return "no_op_self_pay";
	}

	// §7.8.11 E7 — symmetric lock key. Sort the two userIds so the lock is
	// identical regardless of which side is "A" vs "B" in the caller.
	const sortedPair =
		userIdA < userIdB ? `${userIdA}|${userIdB}` : `${userIdB}|${userIdA}`;
	const lockKey = `family-group-${clubShortName}-${sortedPair}`;
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

	// Defensive cross-tenant guard: both users must belong to this club.
	// `findOrCreateLocalUserAccount` should have created the UserClub row
	// already; a missing row indicates a programming bug, not a user-input
	// problem. Refuse instead of silently linking strangers across tenants.
	const [aMembership, bMembership] = await Promise.all([
		tx.userClub.findFirst({
			where: { userId: userIdA, clubShortName },
			select: { id: true },
		}),
		tx.userClub.findFirst({
			where: { userId: userIdB, clubShortName },
			select: { id: true },
		}),
	]);
	if (!aMembership || !bMembership) {
		throw new Error(
			`linkFamilyGroup: one or both users missing UserClub at ${clubShortName} (a=${!!aMembership} b=${!!bMembership})`,
		);
	}

	// Read both users' current familyGroupId AFTER taking the lock.
	const [userA, userB] = await Promise.all([
		tx.user.findUnique({
			where: { userId: userIdA },
			select: { userId: true, familyGroupId: true, lastName: true },
		}),
		tx.user.findUnique({
			where: { userId: userIdB },
			select: { userId: true, familyGroupId: true, lastName: true },
		}),
	]);
	if (!userA || !userB) {
		throw new Error(
			`linkFamilyGroup: user row vanished mid-tx (a=${!!userA} b=${!!userB})`,
		);
	}

	// §7.8.6 simplified rule — if EITHER has a group, do not touch.
	if (userA.familyGroupId !== null || userB.familyGroupId !== null) {
		return "not_linked_existing_group";
	}

	// Neither has a group — create a fresh one and link both.
	// Auto-default the name to "{lastName} family" from the FIRST identity
	// (matches the FamilyGroup schema comment). Fall back to a generic
	// `null` (display-fallback "Family") when both lastNames are empty.
	const defaultName =
		(userA.lastName && userA.lastName.trim().length > 0
			? `${userA.lastName.trim()} family`
			: userB.lastName && userB.lastName.trim().length > 0
				? `${userB.lastName.trim()} family`
				: null) ?? null;

	const group = await tx.familyGroup.create({
		data: {
			clubShortName,
			name: defaultName,
		},
		select: { familyGroupId: true },
	});

	await tx.user.updateMany({
		where: { userId: { in: [userA.userId, userB.userId] } },
		data: { familyGroupId: group.familyGroupId },
	});
	return "created";
}
