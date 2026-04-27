/**
 * Shared list of IANA timezones presented in user/facility timezone pickers.
 *
 * Why this lives in /lib (not duplicated per page):
 * The same eight zones appear in the user profile page and the facility manager
 * page. Adding a new zone (e.g. another Europe entry for an international club)
 * should be a one-line edit here, not a hunt through every Select component.
 *
 * Why a curated list (not the full ~600 IANA zones):
 * The first customer is a US badminton club. Surfacing the 600 IANA zones in a
 * dropdown is overwhelming and slow. The curated list covers US + the most
 * common international markets we'd expand to. If a club asks for a zone not
 * here, add it — it's not gated on schema or migration.
 *
 * Default fallback `America/New_York` is set at the schema layer (User.timeZone
 * and ClubFacility.timezone both default to it). Don't change the default
 * casually — `consumeCredit` and various dashboard queries assume New York
 * timezone for date math when no explicit zone is set.
 */
export const TIMEZONE_OPTIONS: ReadonlyArray<{
	value: string;
	label: string;
}> = [
	{ value: "America/New_York", label: "Eastern Time (ET)" },
	{ value: "America/Chicago", label: "Central Time (CT)" },
	{ value: "America/Denver", label: "Mountain Time (MT)" },
	{ value: "America/Los_Angeles", label: "Pacific Time (PT)" },
	{ value: "Europe/London", label: "London (GMT)" },
	{ value: "Europe/Paris", label: "Paris (CET)" },
	{ value: "Asia/Tokyo", label: "Tokyo (JST)" },
	{ value: "Australia/Sydney", label: "Sydney (AEDT)" },
] as const;

export const DEFAULT_TIMEZONE = "America/New_York";
