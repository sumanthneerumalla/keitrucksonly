/**
 * Shared user-creation helpers — single source of truth for the
 * "Clerk find-or-create + local User row + UserClub at default facility"
 * pattern. Used by:
 *   - admin Create-User modal (`user.createUser` mutation)
 *   - shop guest register (`shop.guestRegisterForFreeEvent`)
 *   - Phase C Stripe webhook (when Phase 12 ships)
 *
 * Decision #24 (Option A — Clerk-first split): the Clerk HTTP call must
 * happen OUTSIDE any DB transaction so we never hold a DB connection
 * during a network round-trip. Callers should:
 *   1. await `findOrCreateClerkUserId(...)` (no transaction).
 *   2. open `db.$transaction(async (tx) => { ... })` and call
 *      `findOrCreateLocalUserAccount({ db: tx, clerkUserId, ... })` inside.
 *
 * If the DB transaction fails after Clerk succeeded, the brand-new Clerk
 * user persists as an orphan. The next attempt with the same email finds
 * the orphan via `getUserList` and reuses it. Future cleanup path =
 * extend the existing `OrphanedPurchase` table (Phase C, decision #21)
 * with a `clerk_no_local_user` reason.
 *
 * See public-shop.md decision #14 (TD-P7) for default-facility selection.
 */

import { clerkClient } from "@clerk/nextjs/server";
import type { Prisma, PrismaClient, UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Phase 12a — webhook-friendly persistent failure marker (phase12 §23 #5).
 * Thrown when Clerk's `getUserList({ emailAddress })` returns `data.length > 1`
 * (multiple Clerk users share the email — usually a misconfigured Clerk app /
 * dev key used in prod). Silently taking `[0]` could attach a paid purchase to
 * the wrong account; the orphan queue gives a human a chance to triage instead.
 *
 * The webhook handler catches this and writes an `OrphanedPurchase` row with
 * `reason: 'clerk_create_failed'` (or a more specific reason), returning 200
 * to Stripe so retries stop.
 */
export class ClerkPersistentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClerkPersistentError";
	}
}

// ============================================================
// findOrCreateClerkUserId — pure Clerk, NO database access
// ============================================================

export interface FindOrCreateClerkUserIdInput {
	email: string;
	firstName: string;
	lastName: string;
}

export interface FindOrCreateClerkUserIdResult {
	clerkUserId: string;
	wasJustCreated: boolean;
}

/**
 * Find-or-create a Clerk user by email. Pure Clerk — does not touch the
 * database. Safe to call outside a `$transaction` (and SHOULD be — see
 * decision #24 / Option A).
 *
 * Tries `clerk.users.createUser` first. On `form_identifier_exists`
 * (HTTP 422), falls back to `clerk.users.getUserList({ emailAddress })`
 * to look up the existing Clerk user. Any other failure surfaces as
 * `INTERNAL_SERVER_ERROR` (matches existing error UX).
 */
export async function findOrCreateClerkUserId({
	email,
	firstName,
	lastName,
}: FindOrCreateClerkUserIdInput): Promise<FindOrCreateClerkUserIdResult> {
	const clerk = await clerkClient();
	try {
		const clerkUser = await clerk.users.createUser({
			emailAddress: [email],
			firstName,
			lastName,
			skipPasswordRequirement: true,
		});
		return { clerkUserId: clerkUser.id, wasJustCreated: true };
	} catch (err: unknown) {
		// If email already exists in Clerk, find the existing user.
		const e = err as {
			errors?: Array<{ code?: string }>;
			status?: number;
		};
		if (
			e?.errors?.[0]?.code === "form_identifier_exists" ||
			e?.status === 422
		) {
			const existingClerkUsers = await clerk.users.getUserList({
				emailAddress: [email],
			});
			// Phase 12a (phase12 §23 #5) — multi-Clerk-user guard. Silent
			// misattachment of paid purchases would be unrecoverable; route to the
			// orphan queue instead by throwing a `ClerkPersistentError` the webhook
			// handler explicitly handles. Indicates a misconfigured Clerk app
			// (e.g. dev/staging key used in prod).
			if (existingClerkUsers.data.length > 1) {
				throw new ClerkPersistentError(
					"Multiple Clerk users found for email — refusing to attach",
				);
			}
			const existingClerk = existingClerkUsers.data[0];
			if (!existingClerk) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Email exists in auth system but user not found.",
				});
			}
			return { clerkUserId: existingClerk.id, wasJustCreated: false };
		}
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create user account.",
		});
	}
}

// ============================================================
// findOrCreateLocalUserAccount — pure DB, takes a tx client
// ============================================================

export interface FindOrCreateLocalUserAccountInput {
	db: DbClient;
	clerkUserId: string;
	email: string;
	firstName: string;
	lastName: string;
	clubShortName: string;
	role: UserType;
	/**
	 * Optional explicit facility ID. If omitted, the helper picks the first
	 * ACTIVE facility ordered alphabetically by name (decision #14 / TD-P7 —
	 * intentionally fragile; replaced by `Club.defaultFacilityId` later).
	 */
	facilityId?: string;
	/**
	 * If true, throws CONFLICT when the user already has a UserClub at the
	 * resolved facility (instead of returning idempotently). Admin Create-User
	 * mutation sets this so the operator gets a clear "already a member"
	 * error rather than a silent no-op.
	 */
	requireNewMembership?: boolean;
}

export interface FindOrCreateLocalUserAccountResult {
	userId: string;
	isNewUser: boolean;
}

/**
 * Find-or-create the local `User` row keyed by `clerkUserId`, then
 * find-or-create a `UserClub` membership at the resolved facility, and
 * mirror the active context (clubShortName, activeFacilityId, userType)
 * onto the User row when a new membership is created.
 *
 * Pure DB — does NOT call Clerk. Accepts either a `PrismaClient` or a
 * `Prisma.TransactionClient`, so callers can compose this with other
 * writes inside a `$transaction`.
 *
 * Returns `{ userId, isNewUser }`. `isNewUser` is true only when a
 * brand-new local `User` row was inserted (not when an existing User got
 * a new UserClub).
 */
export async function findOrCreateLocalUserAccount({
	db,
	clerkUserId,
	email,
	firstName,
	lastName,
	clubShortName,
	role,
	facilityId,
	requireNewMembership,
}: FindOrCreateLocalUserAccountInput): Promise<FindOrCreateLocalUserAccountResult> {
	// Resolve default facility if not explicitly given.
	// Decision #14 / TD-P7: first ACTIVE facility ordered alphabetically.
	// Intentionally fragile — will be replaced by Club.defaultFacilityId on
	// the first multi-facility customer.
	let resolvedFacilityId = facilityId;
	if (!resolvedFacilityId) {
		const defaultFacility = await db.clubFacility.findFirst({
			where: { clubShortName, isActive: true },
			orderBy: { name: "asc" },
			select: { facilityId: true },
		});
		if (!defaultFacility) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Club has no active facilities — cannot create user.",
			});
		}
		resolvedFacilityId = defaultFacility.facilityId;
	} else {
		// If a facility was passed in, sanity check it belongs to this club.
		const fac = await db.clubFacility.findUnique({
			where: { facilityId: resolvedFacilityId },
			select: { clubShortName: true },
		});
		if (!fac || fac.clubShortName !== clubShortName) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Facility does not belong to the target club.",
			});
		}
	}

	// Find or create the local User row keyed by clerkUserId.
	let user = await db.user.findUnique({ where: { clerkUserId } });
	let isNewUser = false;
	if (!user) {
		user = await db.user.create({
			data: {
				clerkUserId,
				firstName,
				lastName,
				email,
				userType: role,
				clubShortName,
				activeFacilityId: resolvedFacilityId,
			},
		});
		isNewUser = true;
	}

	// Find or create UserClub at this facility.
	const existingMembership = await db.userClub.findUnique({
		where: {
			userId_facilityId: {
				userId: user.userId,
				facilityId: resolvedFacilityId,
			},
		},
	});

	if (existingMembership) {
		if (requireNewMembership) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "User is already a member of this facility.",
			});
		}
	} else {
		await db.userClub.create({
			data: {
				userId: user.userId,
				clubShortName,
				facilityId: resolvedFacilityId,
				role,
			},
		});
		// Mirror the active context onto the User row (matches createUser mutation).
		await db.user.update({
			where: { userId: user.userId },
			data: {
				clubShortName,
				activeFacilityId: resolvedFacilityId,
				userType: role,
			},
		});
	}

	return {
		userId: user.userId,
		isNewUser,
	};
}

// ============================================================
// createUserAccount — DEPRECATED thin wrapper, kept for back-compat
// ============================================================

export interface CreateUserAccountInput {
	db: DbClient;
	email: string;
	firstName: string;
	lastName: string;
	clubShortName: string;
	role: UserType;
	facilityId?: string;
}

export interface CreateUserAccountResult {
	userId: string;
	clerkUserId: string;
	isNewUser: boolean;
}

/**
 * @deprecated Use `findOrCreateClerkUserId` (outside any transaction) +
 * `findOrCreateLocalUserAccount` (inside `$transaction`) instead. This
 * wrapper bundles both calls and therefore makes a Clerk HTTP request
 * while a DB connection may be held open — see decision #24 (Option A,
 * Clerk-first split) for why we moved away from this pattern.
 *
 * Retained only to avoid breaking any callers we miss during the
 * refactor. Remove once all call sites use the split helpers.
 */
export async function createUserAccount({
	db,
	email,
	firstName,
	lastName,
	clubShortName,
	role,
	facilityId,
}: CreateUserAccountInput): Promise<CreateUserAccountResult> {
	const { clerkUserId } = await findOrCreateClerkUserId({
		email,
		firstName,
		lastName,
	});

	const { userId, isNewUser } = await findOrCreateLocalUserAccount({
		db,
		clerkUserId,
		email,
		firstName,
		lastName,
		clubShortName,
		role,
		facilityId,
	});

	return { userId, clerkUserId, isNewUser };
}
