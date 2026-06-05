import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility for merging Tailwind CSS classes
 * - Combines classes with clsx for conditional classes
 * - Uses tailwind-merge to resolve class conflicts
 * - Maintains the same API as the original cn function
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Color-picker defaults for the Manage Resources form (Resource Type and
// per-Resource forms). Used as the starting hex shown when an operator
// opts into "Customize colors" without picking anything.
//
// - Text default = brand indigo: a recognizable starting point that
//   operators are likely to override anyway.
// - Bg default = warm paper: matches the calendar's neutral cell
//   background, so opting into custom text-color but leaving the bg as-is
//   stays visually consistent with the rest of the calendar.
//
// These are NOT applied as a fallback at render time — resources without
// stored colors render via the [data-calendar-root] cascade (paper bg,
// ink text). They're purely UI placeholders for the form's color pickers.
// ---------------------------------------------------------------------------

export const DEFAULT_COLOR = "#4F46E5"; // matches --primary / --brand
export const DEFAULT_BG_COLOR = "#FAF8F3"; // matches --paper

// ---------------------------------------------------------------------------
// Role helpers — pure functions, safe for both server and client components.
// Accepts any object with a userType string (Prisma User, tRPC response, etc.)
// ---------------------------------------------------------------------------

type HasUserType = { userType: string };

export function isPlatformAdmin(user: HasUserType): boolean {
	return user.userType === "PLATFORM_ADMIN";
}

export function isClubAdmin(user: HasUserType): boolean {
	return user.userType === "CLUB_ADMIN";
}

export function isAnyAdmin(user: HasUserType): boolean {
	return isPlatformAdmin(user) || isClubAdmin(user);
}

export function isFacilityOrAbove(user: HasUserType): boolean {
	return user.userType === "FACILITY" || isAnyAdmin(user);
}

export function isStaffOrAbove(user: HasUserType): boolean {
	return isFacilityOrAbove(user) || user.userType === "COACH";
}

/** Coach, club admin, or platform admin — for coaching notes, dashboard metrics, media access */
export function hasCoachingAccess(user: HasUserType): boolean {
	return user.userType === "COACH" || isAnyAdmin(user);
}

// ---------------------------------------------------------------------------
// Role hierarchy & assignment — client-safe (string literals, no Prisma enum)
// ---------------------------------------------------------------------------

export const ROLE_HIERARCHY: Record<string, number> = {
	STUDENT: 0,
	COACH: 1,
	FACILITY: 2,
	CLUB_ADMIN: 3,
	PLATFORM_ADMIN: 4,
};

export function canAssignRole(
	assignerType: string,
	targetRole: string,
): boolean {
	if (assignerType === "PLATFORM_ADMIN") return true;
	return (
		(ROLE_HIERARCHY[targetRole] ?? 0) < (ROLE_HIERARCHY[assignerType] ?? 0)
	);
}

export function assignableRoles(callerType: string): string[] {
	return Object.keys(ROLE_HIERARCHY).filter((role) =>
		canAssignRole(callerType, role),
	);
}

/** Caller must strictly outrank target to manage them (edit profile, change role, remove). */
export function canManageUser(callerType: string, targetType: string): boolean {
	return (ROLE_HIERARCHY[callerType] ?? 0) > (ROLE_HIERARCHY[targetType] ?? 0);
}

// ---------------------------------------------------------------------------

export function isOnboardedUser(user: {
	firstName?: string | null;
	lastName?: string | null;
	email?: string | null;
	gender?: string | null;
}): boolean {
	const firstName = user.firstName?.trim() ?? "";
	const lastName = user.lastName?.trim() ?? "";
	const email = user.email?.trim() ?? "";
	const gender = user.gender?.trim() ?? "";

	// Gender is required for onboarding (B1) — set-once, feeds GBR's rating category.
	return (
		firstName.length > 0 &&
		lastName.length > 0 &&
		email.length > 0 &&
		gender.length > 0
	);
}
