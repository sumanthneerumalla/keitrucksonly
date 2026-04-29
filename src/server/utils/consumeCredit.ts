/**
 * consumeCredit — internal backend function for deducting credits from a MemberPackage.
 *
 * NOT a tRPC endpoint. Called from inside other mutations (registerForEvent, staffCheckin).
 *
 * Matching logic (per phase8-packages.md):
 *   - If called with eventId: find member packages where packagePlan.productId === event.productId
 *   - If called without eventId (general check-in): find packages where packagePlan.isGeneralDropIn = true
 *   - Always filter by status='active' AND (endDate IS NULL OR endDate > now()) — don't trust stored status
 *   - Order by endDate ASC NULLS LAST (FIFO — soonest-to-expire first)
 *   - Atomic UPDATE: SET creditsUsed = creditsUsed + cost WHERE creditsUsed + cost <= creditsTotal
 *     (handles race conditions — if the WHERE clause fails, try the next package)
 *   - Multi-credit events: if no single package has enough credits, fail entirely (decision #60)
 *
 * Family widening (public-shop.md FAM phase, decisions #15 / D7):
 *   The package-search WHERE clause uses `userId IN [registrant, ...sameClubFamilyMembers]`
 *   so any package owned by a registrant's family member (in the same club) can satisfy
 *   the deduction. Cross-club is blocked by filtering family members by clubShortName.
 *
 * Returns: { usage: PackageCreditUsage } on success, or { usage: null, reason } if no match.
 * Registration/check-in still succeeds — member just doesn't get a credit deducted (invoice
 * line item comes from Phase 9).
 *
 * Concurrency model (B1 review fix, 2026-04-28):
 *   The conditional update uses `$executeRaw` with the WHERE clause checking
 *   the LIVE DB value of `creditsUsed` — not a captured client-side literal.
 *   This is the fix for HANDOFF.md open thread #4 / public-shop.md D4 / I7.
 *   Two family members consuming the last credit in parallel: only one of the
 *   two atomic UPDATEs will affect a row; the other returns affected=0 and the
 *   loop falls through to the next candidate package or the no-match path.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

interface ConsumeCreditArgs {
	tx: TxClient;
	userId: string;
	clubShortName: string;
	eventId?: string | null;
	eventProductId?: string | null;
	creditCost?: number | null;
	registrationId?: string | null;
	attendanceId?: string | null;
}

export type ConsumeCreditResult =
	| { ok: true; usageId: string; memberPackageId: string; creditsConsumed: number }
	| { ok: false; reason: "no_match" | "insufficient_credits" | "skipped" };

export async function consumeCredit({
	tx,
	userId,
	clubShortName,
	eventId,
	eventProductId,
	creditCost,
	registrationId,
	attendanceId,
}: ConsumeCreditArgs): Promise<ConsumeCreditResult> {
	// Determine how many credits to deduct
	// - For event-based: use creditCost (null/0 = skip)
	// - For general check-in (no eventId): always 1
	const cost = eventId ? (creditCost ?? 0) : 1;

	if (cost <= 0) {
		return { ok: false, reason: "skipped" };
	}

	// Build the FIFO query
	// Event-specific: match packagePlan.productId === event.productId
	// General check-in: match packagePlan.isGeneralDropIn === true
	const now = new Date();

	// Family widening (public-shop.md decision #15, D7):
	// The registrant can also consume credits owned by any user in the same
	// FamilyGroup, scoped to the same club. If the registrant has no group,
	// fall back to just their own userId (preserves single-user behavior).
	const registrant = await tx.user.findUnique({
		where: { userId },
		select: { familyGroupId: true, clubShortName: true },
	});

	const familyMemberIds = registrant?.familyGroupId
		? (
				await tx.user.findMany({
					where: {
						familyGroupId: registrant.familyGroupId,
						clubShortName: registrant.clubShortName,
					},
					select: { userId: true },
				})
			).map((u) => u.userId)
		: [userId];

	const whereClause: Prisma.MemberPackageWhereInput = {
		clubShortName,
		userId: { in: familyMemberIds },
		status: "active",
		OR: [{ endDate: null }, { endDate: { gt: now } }],
		packagePlan: eventId
			? { productId: eventProductId ?? undefined }
			: { isGeneralDropIn: true },
	};

	// Fetch candidates sorted FIFO (soonest-to-expire first, null endDate last)
	const candidates = await tx.memberPackage.findMany({
		where: whereClause,
		orderBy: [{ endDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
		select: {
			memberPackageId: true,
			creditsTotal: true,
			creditsUsed: true,
		},
	});

	if (candidates.length === 0) {
		return { ok: false, reason: "no_match" };
	}

	// Try to atomically deduct from each candidate in FIFO order
	// updateMany with WHERE creditsUsed + cost <= creditsTotal handles race conditions.
	// If updateMany.count === 0, another concurrent deduction depleted it — try the next one.
	for (const candidate of candidates) {
		// Unlimited package (creditsTotal = null) always has room
		if (candidate.creditsTotal === null) {
			const updated = await tx.memberPackage.update({
				where: { memberPackageId: candidate.memberPackageId },
				data: { creditsUsed: { increment: cost } },
				select: { memberPackageId: true },
			});

			const usage = await tx.packageCreditUsage.create({
				data: {
					memberPackageId: updated.memberPackageId,
					eventId: eventId ?? null,
					registrationId: registrationId ?? null,
					attendanceId: attendanceId ?? null,
					creditsConsumed: cost,
				},
			});

			return {
				ok: true,
				usageId: usage.usageId,
				memberPackageId: updated.memberPackageId,
				creditsConsumed: cost,
			};
		}

		// Fixed-count package: must have enough remaining for a single-package deduction
		// (decision #60: no split across packages)
		if (candidate.creditsUsed + cost > candidate.creditsTotal) {
			continue;
		}

		// Atomic conditional update — the WHERE clause re-checks the LIVE DB value
		// of creditsUsed (not a captured literal). Returns the number of rows affected:
		// 1 → we won the race, credit was deducted; 0 → another concurrent deduction
		// depleted the package between our findMany and now → try the next candidate.
		// This is the B1 fix that closes the consumeCredit stale-read race once and for all.
		const affected = await tx.$executeRaw`
			UPDATE "MemberPackage"
			SET "creditsUsed" = "creditsUsed" + ${cost}
			WHERE "memberPackageId" = ${candidate.memberPackageId}
			  AND (
			    "creditsTotal" IS NULL
			    OR "creditsUsed" + ${cost} <= "creditsTotal"
			  )
		`;

		if (affected === 0) {
			// Concurrent deduction depleted this package — try the next candidate
			continue;
		}

		// Re-read to compute post-deduction state and flip to 'depleted' if needed
		const fresh = await tx.memberPackage.findUnique({
			where: { memberPackageId: candidate.memberPackageId },
			select: { creditsTotal: true, creditsUsed: true },
		});

		if (
			fresh?.creditsTotal !== null &&
			fresh?.creditsTotal !== undefined &&
			fresh.creditsUsed >= fresh.creditsTotal
		) {
			await tx.memberPackage.update({
				where: { memberPackageId: candidate.memberPackageId },
				data: { status: "depleted" },
			});
		}

		const usage = await tx.packageCreditUsage.create({
			data: {
				memberPackageId: candidate.memberPackageId,
				eventId: eventId ?? null,
				registrationId: registrationId ?? null,
				attendanceId: attendanceId ?? null,
				creditsConsumed: cost,
			},
		});

		return {
			ok: true,
			usageId: usage.usageId,
			memberPackageId: candidate.memberPackageId,
			creditsConsumed: cost,
		};
	}

	// No candidate had enough credits for this single deduction (multi-credit event, no single package has enough)
	return { ok: false, reason: "insufficient_credits" };
}
