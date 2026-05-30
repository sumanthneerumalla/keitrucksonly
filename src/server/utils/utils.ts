import { auth } from "@clerk/nextjs/server";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { isOnboardedUser } from "~/lib/utils";
import { db } from "~/server/db";

// Define a simplified context type for our helper functions
export type ContextWithAuth = {
	db: {
		user: {
			findUnique: (args: {
				where: { clerkUserId: string };
			}) => Promise<User | null>;
		};
	};
	auth: {
		userId: string;
	};
};

/**
 * Helper function to get the current user or throw an error
 * @param ctx The tRPC context with auth and database access
 * @returns The current user object
 * @throws TRPCError if user is not found
 */
export async function getCurrentUser(ctx: ContextWithAuth): Promise<User> {
	const user = await ctx.db.user.findUnique({
		where: { clerkUserId: ctx.auth.userId },
	});

	if (!user) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "User not found. Please complete your profile setup first.",
		});
	}

	return user;
}

/**
 * Narrowing guard for "fetched X or 404". Replaces the
 * `const x = await db...; if (!x) throw new TRPCError({ code: "NOT_FOUND" })`
 * boilerplate. Takes an already-fetched value (not a promise) so it works with
 * any query shape — `findUnique`, `findFirst`, includes, etc. — and narrows the
 * value to NonNullable for the rest of the handler.
 *
 * NOTE: this is deliberately NOT used for the security-conscious "exists but
 * not in your club" checks that return NOT_FOUND to prevent cross-tenant
 * enumeration. Those keep their bespoke messages and live in-handler.
 */
export function assertFound<T>(
	value: T | null | undefined,
	message = "Resource not found",
): asserts value is NonNullable<T> {
	if (value === null || value === undefined) {
		throw new TRPCError({ code: "NOT_FOUND", message });
	}
}

/**
 * Helper function to check if user is admin
 * @param user The user object to check
 * @returns Boolean indicating if user has admin role
 */
// Re-export role helpers from shared lib (pure functions, no server deps)
export {
	isPlatformAdmin,
	isClubAdmin,
	isAnyAdmin,
	isFacilityOrAbove,
	isStaffOrAbove,
	hasCoachingAccess,
} from "~/lib/utils";
import {
	isAnyAdmin,
	isClubAdmin,
	isFacilityOrAbove,
	isPlatformAdmin,
} from "~/lib/utils";

/** @deprecated Use isPlatformAdmin() instead */
export function isAdmin(user: { userType: string }): boolean {
	return isPlatformAdmin(user);
}

// Re-export role hierarchy & assignment helpers from shared lib
export {
	ROLE_HIERARCHY,
	canAssignRole,
	assignableRoles,
	canManageUser,
} from "~/lib/utils";

export type AdminUserResult =
	| { success: true; user: User }
	| { success: false; error: "Unauthorized" | "NotOnboarded" | "Forbidden" };

/**
 * Helper function to get the current admin user from Clerk session
 * Used only for the custom endpoints defined at /src/app/api/studio/route.ts
 * for the prisma studio dashboard
 * Validates: authenticated, onboarded, and admin
 * @returns Result object with user or error
 */
export async function getAdminUser(): Promise<AdminUserResult> {
	const session = await auth();

	if (!session?.userId) {
		return { success: false, error: "Unauthorized" };
	}

	const user = await db.user.findUnique({
		where: { clerkUserId: session.userId },
	});

	if (!user || !isOnboardedUser(user)) {
		return { success: false, error: "NotOnboarded" };
	}

	if (!isPlatformAdmin(user)) {
		return { success: false, error: "Forbidden" };
	}

	return { success: true, user };
}

/**
 * Helper function to check if user can create collections
 * @param user The user object to check
 * @returns Boolean indicating if user can create collections
 */
export function canCreateCollections(user: User): boolean {
	return user.userType === UserType.STUDENT || isFacilityOrAbove(user);
}

/**
 * Helper function to check if user can access a specific resource
 * @param user The current user
 * @param resourceOwnerId The user ID of the resource owner
 * @returns Boolean indicating if the user can access the resource
 */
export function canAccessResource(
	user: User,
	resourceOwnerId: string,
	resourceOwner?: { clubShortName?: string | null },
): boolean {
	if (user.userId === resourceOwnerId) return true;
	if (isPlatformAdmin(user)) return true;
	if (
		isClubAdmin(user) &&
		resourceOwner?.clubShortName &&
		user.clubShortName === resourceOwner.clubShortName
	)
		return true;
	return false;
}

/**
 * Access control middleware for video collections
 * Checks if user is collection owner or assigned coach
 * @param user The current user
 * @param collection The video collection with assigned coach info
 * @returns Boolean indicating if user has access
 */
export function canAccessVideoCollection(
	user: User,
	collection: {
		userId: string;
		assignedCoachId?: string | null;
		uploadedByUserId?: string | null;
		user?: { clubShortName?: string | null } | null;
	},
): boolean {
	// Check if user is collection owner
	if (user.userId === collection.userId) {
		return true;
	}

	// Check if user is assigned coach
	if (
		collection.assignedCoachId &&
		user.userId === collection.assignedCoachId
	) {
		return true;
	}

	// Check if user uploaded the collection on behalf of the owner
	if (
		collection.uploadedByUserId &&
		user.userId === collection.uploadedByUserId
	) {
		return true;
	}

	// Facility users can view collections owned by users in the same club
	if (
		user.userType === UserType.FACILITY &&
		collection.user?.clubShortName &&
		user.clubShortName === collection.user.clubShortName
	) {
		return true;
	}

	// Platform admin sees everything; club admin sees their club only
	if (isPlatformAdmin(user)) {
		return true;
	}
	if (
		isClubAdmin(user) &&
		collection.user?.clubShortName &&
		user.clubShortName === collection.user.clubShortName
	) {
		return true;
	}

	return false;
}

/**
 * Throws appropriate authorization error for video collection access
 * @param user The current user
 * @param collection The video collection with assigned coach info
 * @throws TRPCError if user doesn't have access
 */
export function requireVideoCollectionAccess(
	user: User,
	collection: {
		userId: string;
		assignedCoachId?: string | null;
		uploadedByUserId?: string | null;
		user?: { clubShortName?: string | null } | null;
	},
): void {
	if (!canAccessVideoCollection(user, collection)) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You are not authorized to access this collection",
		});
	}
}

/**
 * Validates that a club exists and returns its full information
 * @param db Prisma client
 * @param clubShortName The club identifier to validate
 * @returns Club information
 * @throws TRPCError if club doesn't exist
 */
export async function validateAndGetClub(
	db: PrismaClient,
	clubShortName: string,
): Promise<{ clubShortName: string; clubName: string }> {
	const club = await db.club.findUnique({
		where: { clubShortName },
		select: { clubShortName: true, clubName: true },
	});

	if (!club) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid club identifier",
		});
	}

	return club;
}

/**
 * Checks if two entities are in the same club
 * @param user User with clubShortName
 * @param other Entity with optional clubShortName
 * @returns true if both are in the same club
 */
export function isSameClub(
	user: { clubShortName: string },
	other: { clubShortName?: string | null },
): boolean {
	return !!other.clubShortName && user.clubShortName === other.clubShortName;
}

/**
 * Throwing counterpart to {@link isSameClub} for the "you may only touch your
 * own club's resources" authorization guard. By default a PLATFORM_ADMIN is
 * allowed through (the common case for owner-or-admin writes) and a mismatch
 * raises FORBIDDEN.
 *
 * `code`/`message` are overridable because some call sites deliberately use
 * NOT_FOUND to avoid leaking cross-tenant existence. This helper only covers
 * the case where the resource's club is already known; FK-validation checks
 * (e.g. "does this facility belong to my club") that fold a null-check into the
 * same branch are left in-handler on purpose.
 */
export function assertSameClub(
	user: { clubShortName: string; userType: UserType },
	resourceClub: string | null | undefined,
	opts?: {
		allowPlatformAdmin?: boolean;
		code?: "FORBIDDEN" | "NOT_FOUND" | "BAD_REQUEST";
		message?: string;
	},
): void {
	const allowPlatformAdmin = opts?.allowPlatformAdmin ?? true;
	if (allowPlatformAdmin && isPlatformAdmin(user)) return;
	if (resourceClub !== user.clubShortName) {
		throw new TRPCError({
			code: opts?.code ?? "FORBIDDEN",
			message: opts?.message ?? "You can only access your own club's resources",
		});
	}
}

// ---------------------------------------------------------------------------
// User shape returned to the frontend by getOrCreateProfile / updateProfile
// ---------------------------------------------------------------------------

type UserWithProfiles = Prisma.UserGetPayload<{
	include: { studentProfile: true; coachProfile: true; club: true };
}>;

export type UserForFrontend = {
	userId: string;
	activeFacilityId: string | null;
	clerkUserId: string;
	email?: string | null;
	firstName?: string | null;
	lastName?: string | null;
	profileImage?: string | null;
	timeZone?: string | null;
	clubShortName: string;
	clubName: string;
	createdAt: Date;
	updatedAt: Date;
	userType: UserWithProfiles["userType"];
	studentProfile: {
		studentProfileId: string;
		displayUsername: string | null;
		skillLevel: string | null;
		goals: string | null;
		bio: string | null;
		profileImageUrl?: string | null;
	} | null;
	coachProfile: {
		coachProfileId: string;
		displayUsername: string | null;
		bio: string | null;
		experience: string | null;
		specialties: string[];
		teachingStyles: string[];
		headerImage: string | null;
		rate: number;
		isActive: boolean;
		isVerified: boolean;
		profileImageUrl?: string | null;
	} | null;
};

/**
 * Converts a Prisma user row (with included profiles + club) into the
 * frontend-safe shape: binary profile images become base64 data URLs, raw
 * binary fields are stripped, and only the profile relevant to the user's
 * current userType is exposed (admins get both).
 */
export function formatUserForFrontend(raw: UserWithProfiles): UserForFrontend {
	const studentProfileUrl = raw.studentProfile?.profileImage
		? binaryToBase64DataUrl(
				raw.studentProfile.profileImage,
				raw.studentProfile.profileImageType ?? "image/png",
			)
		: null;

	const coachProfileUrl = raw.coachProfile?.profileImage
		? binaryToBase64DataUrl(
				raw.coachProfile.profileImage,
				raw.coachProfile.profileImageType ?? "image/png",
			)
		: null;

	const studentProfile = raw.studentProfile
		? {
				studentProfileId: raw.studentProfile.studentProfileId,
				displayUsername: raw.studentProfile.displayUsername,
				skillLevel: raw.studentProfile.skillLevel,
				goals: raw.studentProfile.goals,
				bio: raw.studentProfile.bio,
				profileImageUrl: studentProfileUrl,
			}
		: null;

	const coachProfile = raw.coachProfile
		? {
				coachProfileId: raw.coachProfile.coachProfileId,
				displayUsername: raw.coachProfile.displayUsername,
				bio: raw.coachProfile.bio,
				experience: raw.coachProfile.experience,
				specialties: raw.coachProfile.specialties,
				teachingStyles: raw.coachProfile.teachingStyles,
				headerImage: raw.coachProfile.headerImage,
				rate: raw.coachProfile.rate,
				isActive: raw.coachProfile.isActive,
				isVerified: raw.coachProfile.isVerified,
				profileImageUrl: coachProfileUrl,
			}
		: null;

	const base: UserForFrontend = {
		userId: raw.userId,
		activeFacilityId: raw.activeFacilityId,
		clerkUserId: raw.clerkUserId,
		email: raw.email,
		firstName: raw.firstName,
		lastName: raw.lastName,
		profileImage: raw.profileImage ? String(raw.profileImage) : null,
		timeZone: raw.timeZone,
		clubShortName: raw.clubShortName,
		clubName: raw.club?.clubName ?? "",
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		userType: raw.userType,
		studentProfile,
		coachProfile,
	};

	// Admins see both profiles; coaches hide studentProfile; students/facility hide coachProfile
	if (isAnyAdmin(raw)) return base;
	if (raw.userType === UserType.COACH) return { ...base, studentProfile: null };
	return { ...base, coachProfile: null };
}

/**
 * Helper function to convert binary image data to a base64 data URL
 * @param imageData Binary image data
 * @param mimeType MIME type of the image
 * @returns Base64 encoded data URL
 */
export function binaryToBase64DataUrl(
	imageData: Buffer | Uint8Array | null,
	mimeType = "image/png",
): string | null {
	if (!imageData) return null;

	try {
		// Convert binary data to base64 string
		const base64String = Buffer.from(imageData).toString("base64");
		return `data:${mimeType};base64,${base64String}`;
	} catch (error) {
		console.error("Error converting binary to base64:", error);
		return null;
	}
}

/**
 * Process a base64 image string into a Buffer
 * @param imageData Base64 encoded image data or data URL
 * @param maxSizeBytes Maximum allowed size in bytes (default: 3MB)
 * @returns Buffer containing the binary image data
 * @throws TRPCError if image exceeds maximum size or if imageData is undefined
 */
export function processBase64Image(
	imageData: string,
	maxSizeBytes: number = 3 * 1024 * 1024,
): Buffer {
	// Validate input
	if (!imageData) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "No image data provided",
		});
	}

	try {
		// Extract the base64 data (remove the data:image/png;base64, prefix if present)
		const base64Data = imageData.includes("base64,")
			? imageData.split("base64,")[1]
			: imageData;

		// Convert base64 to binary - ensure base64Data is a string
		const binaryData = Buffer.from(base64Data as string, "base64");

		// Check size
		if (binaryData.length > maxSizeBytes) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Image size must be less than ${Math.round(maxSizeBytes / (1024 * 1024))}MB`,
			});
		}

		return binaryData;
	} catch (error) {
		if (error instanceof TRPCError) throw error;

		console.error("Error processing base64 image:", error);
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid image data format",
		});
	}
}
