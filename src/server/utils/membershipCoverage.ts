/**
 * Phase 10c — membership coverage (DISPLAY only, no enforcement).
 *
 * Answers "which active memberships cover this user, and how big is their
 * family?" — the inputs the check-in card needs to let the front desk reconcile
 * a plan's stated capacity against reality. Coverage widens from the user's OWN
 * memberships to any SHAREABLE membership held by someone in the same FamilyGroup
 * (mirrors the package-sharing widening in `consumeCredit.ts`).
 *
 * Shareability + the displayed cap come from `memberCapacity` (snapshotted on the
 * membership): 1 = individual (own only); N>1 = covers family, stated cap N;
 * null = covers family, no cap. The number is NEVER enforced — the caller shows
 * "covers N · family has M" and flags M>N for the human. This helper does NOT
 * gate check-in/registration (10a memberships are display-only).
 */

import type { Prisma, PrismaClient } from "@prisma/client";

function fullName(u: { firstName: string | null; lastName: string | null }) {
	return [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
}

export interface MembershipCoverageRow {
	memberMembershipId: string;
	status: string;
	startDate: Date;
	endDate: Date | null;
	freezeReason: string | null;
	suspendReason: string | null;
	cancelReason: string | null;
	/** Display hint: 1 = individual, N>1 = stated cap, null = family/no cap. */
	memberCapacity: number | null;
	planDescription: string;
	membershipTypeName: string;
	/** "own" = the user's own membership; "family" = shared by a family member. */
	coverageSource: "own" | "family";
	/** For "family" coverage, the primary member who holds the shared membership. */
	sharedByUserId: string | null;
	sharedByName: string | null;
}

export interface MembershipCoverage {
	rows: MembershipCoverageRow[];
	/** Count of the user's FamilyGroup members in this club (1 when not grouped). */
	familySize: number;
}

/**
 * Active-ish coverage for a user (excludes voided rows; caller derives the
 * upcoming/active/expired badge). Returns the user's own memberships PLUS
 * family-shared ones, and the family size. `clubShortName` scopes everything
 * (FamilyGroups are per-club).
 */
export async function getMembershipCoverage(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
	clubShortName: string,
): Promise<MembershipCoverage> {
	// Same widening shape as consumeCredit: the user's family group → same-club
	// siblings. Falls back to [userId] when the user isn't in a family group.
	const me = await db.user.findUnique({
		where: { userId },
		select: { familyGroupId: true },
	});
	const familyMemberIds = me?.familyGroupId
		? (
				await db.user.findMany({
					where: { familyGroupId: me.familyGroupId, clubShortName },
					select: { userId: true },
				})
			).map((u) => u.userId)
		: [userId];
	const familySize = familyMemberIds.length;

	const rows = await db.memberMembership.findMany({
		where: {
			clubShortName,
			status: { not: "voided" },
			OR: [
				{ userId }, // the user's own
				// shared by a family member: memberCapacity != 1 (i.e. null OR > 1).
				// Includes the user's own shareable rows, but those also match the
				// branch above → deduped to one row by findMany.
				{
					userId: { in: familyMemberIds },
					OR: [{ memberCapacity: null }, { memberCapacity: { gt: 1 } }],
				},
			],
		},
		select: {
			memberMembershipId: true,
			userId: true,
			status: true,
			startDate: true,
			endDate: true,
			freezeReason: true,
			suspendReason: true,
			cancelReason: true,
			memberCapacity: true,
			user: { select: { firstName: true, lastName: true } },
			membershipPlan: {
				select: {
					description: true,
					membershipType: { select: { name: true } },
				},
			},
		},
		orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
	});

	return {
		familySize,
		rows: rows.map((r) => {
			const isOwn = r.userId === userId;
			return {
				memberMembershipId: r.memberMembershipId,
				status: r.status,
				startDate: r.startDate,
				endDate: r.endDate,
				freezeReason: r.freezeReason,
				suspendReason: r.suspendReason,
				cancelReason: r.cancelReason,
				memberCapacity: r.memberCapacity,
				planDescription: r.membershipPlan.description,
				membershipTypeName: r.membershipPlan.membershipType.name,
				coverageSource: isOwn ? "own" : "family",
				sharedByUserId: isOwn ? null : r.userId,
				sharedByName: isOwn ? null : fullName(r.user),
			};
		}),
	};
}
