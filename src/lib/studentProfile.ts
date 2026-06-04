/**
 * Shared, framework-agnostic helpers for the loose StudentProfile.profileData
 * JSON blob (TD-1). The canonical editable shape lives in
 * src/app/(app)/clients/[userId]/ProfileFieldsCard.tsx; this module mirrors
 * it for SERVER-side readers (tRPC routers, the invoice renderer) so the
 * parsing rule lives in exactly one place.
 */

export type StudentProfileData = {
	phone?: string;
	// dateOfBirth removed — promoted to the global User.dateOfBirth column
	// (see designFiles/per-club-profiles.md §4b).
	medicalNotes?: string;
	allergies?: string;
	generalNotes?: string;
};

/**
 * Read `phone` out of a StudentProfile.profileData blob. Defensive: returns
 * null when the profile / blob / phone / shape is missing or blank, so a
 * caller can simply omit the line.
 */
export function phoneFromProfileData(blob: unknown): string | null {
	if (!blob || typeof blob !== "object") return null;
	const phone = (blob as StudentProfileData).phone;
	if (typeof phone !== "string") return null;
	const trimmed = phone.trim();
	return trimmed.length > 0 ? trimmed : null;
}
