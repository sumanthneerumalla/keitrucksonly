import { z } from "zod";

/**
 * Phase 16 Step 2 — app-validated shapes for the Json branding/hours columns
 * (Club.socialLinks, ClubFacility.operatingHours). Same Json-bag pattern as
 * Club.membershipPreferences: the DB stores Json, this module is the single
 * source of truth for the shape.
 */

export const DAYS_OF_WEEK = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const DAY_LABELS: Record<DayOfWeek, string> = {
	mon: "Monday",
	tue: "Tuesday",
	wed: "Wednesday",
	thu: "Thursday",
	fri: "Friday",
	sat: "Saturday",
	sun: "Sunday",
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// One open–close interval per day (D4; deliberate v1 simplification — split
// hours would extend the day value to an array WITHOUT a DB migration).
// HH:mm strings compare correctly as strings, so open < close is a plain
// string comparison.
const dayIntervalSchema = z
	.object({
		open: z.string().regex(HHMM, "Use 24h HH:mm"),
		close: z.string().regex(HHMM, "Use 24h HH:mm"),
	})
	.refine((v) => v.open < v.close, {
		message: "Opening time must be before closing time",
	});

/** Missing key or null = closed that day. */
export const operatingHoursSchema = z
	.object({
		mon: dayIntervalSchema.nullable(),
		tue: dayIntervalSchema.nullable(),
		wed: dayIntervalSchema.nullable(),
		thu: dayIntervalSchema.nullable(),
		fri: dayIntervalSchema.nullable(),
		sat: dayIntervalSchema.nullable(),
		sun: dayIntervalSchema.nullable(),
	})
	.partial();

export type OperatingHours = z.infer<typeof operatingHoursSchema>;

const socialUrl = z.string().trim().url().max(500);

/** Keys are fixed platforms; values are absolute profile URLs. */
export const socialLinksSchema = z
	.object({
		facebook: socialUrl.optional(),
		instagram: socialUrl.optional(),
		x: socialUrl.optional(),
		youtube: socialUrl.optional(),
		tiktok: socialUrl.optional(),
	})
	.strict();

export type SocialLinks = z.infer<typeof socialLinksSchema>;

export const SOCIAL_PLATFORMS: { key: keyof SocialLinks; label: string }[] = [
	{ key: "facebook", label: "Facebook" },
	{ key: "instagram", label: "Instagram" },
	{ key: "x", label: "X (Twitter)" },
	{ key: "youtube", label: "YouTube" },
	{ key: "tiktok", label: "TikTok" },
];
