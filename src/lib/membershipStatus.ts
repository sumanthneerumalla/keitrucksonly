/**
 * Single source of truth for how a membership's state is LABELLED + COLOURED in
 * the UI (Phase 10a — see designFiles/roadmap/phase10-memberships.md "Membership
 * Statuses"). Mirrors the `invoiceStatus.ts` derive-once pattern.
 *
 * Status has two layers:
 *  - a STORED lifecycle on `MemberMembership.status`
 *    ("active" | "cancelled" | "suspended" | "frozen" | "voided"), set by staff,
 *  - a DERIVED time-state computed from `startDate`/`endDate` on read — no cron
 *    (package pattern #27) — that only applies while stored status is "active":
 *      now < startDate            -> upcoming (blue)
 *      startDate <= now < endDate -> active   (green)
 *      now >= endDate             -> expired  (yellow)
 *      endDate == null            -> active   (indefinite term, no expiry)
 *
 * The stored lifecycle OVERRIDES the derived state: cancelled / suspended /
 * frozen all read red; voided is hidden entirely (soft-deleted mistake).
 *
 * Both the member-profile Membership tab and the Phase 7 admin check-in card
 * render badges from this one helper so the colours never drift.
 */

/** The single effective state a membership badge can show (voided is hidden). */
export type MembershipEffectiveStatus =
	| "upcoming"
	| "active"
	| "expired"
	| "cancelled"
	| "suspended"
	| "frozen"
	| "voided";

/** Badge colour tone, keyed to the spec's green/blue/yellow/red scheme. */
export type MembershipStatusTone = "active" | "upcoming" | "expired" | "ended";

export interface MembershipStatusInput {
	/** Stored lifecycle: active | cancelled | suspended | frozen | voided. */
	status: string;
	/** Term start (>= sale date). Future start => derived "upcoming". */
	startDate: Date | string;
	/** Calendar term end; null = indefinite (never derives "expired"). */
	endDate: Date | string | null;
}

export interface MembershipStatusDisplay {
	/** The resolved effective status (stored override or derived time-state). */
	effectiveStatus: MembershipEffectiveStatus;
	/** Short label for the status badge, e.g. "Active", "Upcoming", "Expired". */
	label: string;
	tone: MembershipStatusTone;
	/** True when the row should be hidden from normal lists (voided). */
	hidden: boolean;
	/**
	 * True when the row belongs under the "Show history" toggle rather than the
	 * default active view — expired or any terminal/paused stored status.
	 */
	isHistory: boolean;
}

/**
 * Resolve a membership's effective status + badge presentation. `now` is
 * injectable for testing / deterministic rendering; defaults to the call time.
 */
export function membershipStatusDisplay(
	m: MembershipStatusInput,
	now: Date = new Date(),
): MembershipStatusDisplay {
	// Stored lifecycle overrides the derived time-state. Voided is hidden;
	// cancelled/suspended/frozen all read red ("ended" tone) and live in history.
	switch (m.status) {
		case "voided":
			return {
				effectiveStatus: "voided",
				label: "Voided",
				tone: "ended",
				hidden: true,
				isHistory: true,
			};
		case "cancelled":
			return {
				effectiveStatus: "cancelled",
				label: "Cancelled",
				tone: "ended",
				hidden: false,
				isHistory: true,
			};
		case "suspended":
			return {
				effectiveStatus: "suspended",
				label: "Suspended",
				tone: "ended",
				hidden: false,
				isHistory: false,
			};
		case "frozen":
			return {
				effectiveStatus: "frozen",
				label: "Frozen",
				tone: "ended",
				hidden: false,
				isHistory: false,
			};
	}

	// Stored status is "active" (or an unknown forward value) — derive from dates.
	const start = new Date(m.startDate).getTime();
	const end = m.endDate === null ? null : new Date(m.endDate).getTime();
	const t = now.getTime();

	if (t < start) {
		return {
			effectiveStatus: "upcoming",
			label: "Upcoming",
			tone: "upcoming",
			hidden: false,
			isHistory: false,
		};
	}

	if (end !== null && t >= end) {
		return {
			effectiveStatus: "expired",
			label: "Expired",
			tone: "expired",
			hidden: false,
			isHistory: true,
		};
	}

	// startDate <= now < endDate (or indefinite term).
	return {
		effectiveStatus: "active",
		label: "Active",
		tone: "active",
		hidden: false,
		isHistory: false,
	};
}

/**
 * Tailwind classes for each tone — green=active, blue=upcoming, yellow=expired,
 * red=cancelled/suspended/frozen (spec colours). Shared by both badge sites.
 */
export const MEMBERSHIP_TONE_BADGE_STYLES: Record<
	MembershipStatusTone,
	string
> = {
	active:
		"bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
	upcoming: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300",
	expired:
		"bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
	ended: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300",
};
