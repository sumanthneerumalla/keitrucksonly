/**
 * Phase 12a Round 2.7 — Auto-family-group linker.
 *
 * Implements the §7.8.6 truth table from
 * `designFiles/roadmap/phase12-stripe-connect.md`. Called by the webhook
 * dispatch after both buyer and beneficiary have been resolved to local
 * `User` rows. Returns a discriminated outcome so the confirmation page
 * (§7.8.7) can render the right branch.
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
	| "extended_a_into_b_group"
	| "extended_b_into_a_group"
	| "untouched_both_existing_different_groups"
	| "no_op_same_group"
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
 * Apply the §7.8.6 truth table for two distinct identities at a paid
 * checkout. Idempotent under concurrent retry via PG advisory lock.
 *
 * The two userIds are symmetric — `userIdA` and `userIdB` carry no
 * semantic priority (the "buyer" vs "beneficiary" framing is dispatch's
 * concern; here we only see two userIds and a club). The returned outcome
 * is enough for the confirmation page (§7.8.7) to render the right branch.
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

	const aGroup = userA.familyGroupId;
	const bGroup = userB.familyGroupId;

	// §7.8.6 truth table — 8 cases mapped to 6 outcomes.

	// Case 7: both in the same group → no-op.
	if (aGroup !== null && bGroup !== null && aGroup === bGroup) {
		return "no_op_same_group";
	}

	// Case 8: both in DIFFERENT existing groups → DO NOT TOUCH.
	if (aGroup !== null && bGroup !== null && aGroup !== bGroup) {
		return "untouched_both_existing_different_groups";
	}

	// Case 5: A in group, B has none → add B to A's group.
	if (aGroup !== null && bGroup === null) {
		await tx.user.update({
			where: { userId: userB.userId },
			data: { familyGroupId: aGroup },
		});
		return "extended_b_into_a_group";
	}

	// Case 6: A has no group, B in group → add A to B's group.
	if (aGroup === null && bGroup !== null) {
		await tx.user.update({
			where: { userId: userA.userId },
			data: { familyGroupId: bGroup },
		});
		return "extended_a_into_b_group";
	}

	// Cases 1–4: neither has a group → create a fresh one and link both.
	// Auto-default the name to "{lastName} family" from the FIRST identity
	// (matches the FamilyGroup schema comment). Fall back to a generic
	// "Family" when both lastNames are empty.
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
