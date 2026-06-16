/**
 * Phase 10c — membership add-on fee menu.
 *
 * A MembershipPlan carries a flexible MENU of optional fees in its `addOnFees`
 * JSON column. At sale, staff check which apply; each selected row becomes a
 * snapshotted `FEE` invoice line (label + amount frozen at sale time). This is
 * CONFIG — the transactional money lives on the invoice line, not here.
 *
 * Client-safe (zod only): imported by the plan-config form, the sell modal, and
 * the server sale path.
 */

import { z } from "zod";

/** "once" = charged a single time at sale. "recurring" = future 10b generator
 * re-bills it each cycle (we only charge it once at sale today; the tag tells
 * the generator). */
export const ADDON_CADENCES = ["once", "recurring"] as const;
export type AddOnCadence = (typeof ADDON_CADENCES)[number];

export const membershipAddOnSchema = z.object({
	/** Stable slug identifying the menu row (so a future generator can match
	 * recurring add-ons). Generated from the label; never shown to users. */
	key: z.string().min(1).max(40),
	label: z.string().trim().min(1).max(80),
	// Int cents (#94). Allow 0 (e.g. a "second adult — included" row). $1M ceiling
	// mirrors the ad-hoc-charge per-line cap.
	amountInCents: z.number().int().min(0).max(100_000_000),
	cadence: z.enum(ADDON_CADENCES),
});
export type MembershipAddOn = z.infer<typeof membershipAddOnSchema>;

/** Max menu rows per plan — generous but bounded (keeps the sell modal sane and
 * the summed total well under the Int4 invoice columns). */
export const MAX_ADDONS_PER_PLAN = 20;

export const membershipAddOnsSchema = z
	.array(membershipAddOnSchema)
	.max(MAX_ADDONS_PER_PLAN)
	// Keys must be unique within a plan so selection-by-key is unambiguous.
	.refine(
		(rows) => new Set(rows.map((r) => r.key)).size === rows.length,
		"Add-on keys must be unique",
	);

/**
 * Safely read a plan's `addOnFees` JSON into a typed list. Returns [] for
 * null/legacy/invalid data so callers never crash on a malformed bag.
 */
export function parseMembershipAddOns(raw: unknown): MembershipAddOn[] {
	if (raw == null) return [];
	const parsed = membershipAddOnsSchema.safeParse(raw);
	return parsed.success ? parsed.data : [];
}

/** Derive a stable slug for a new menu row from its label. */
export function addOnKeyFromLabel(label: string): string {
	const base = label
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	return base || "addon";
}
