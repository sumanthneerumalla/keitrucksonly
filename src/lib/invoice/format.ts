/**
 * Shared invoice formatting helpers — used by BOTH the on-screen invoice view
 * (InvoiceDetail.tsx, client) and the PDF renderer (server). Client-safe: only
 * depends on ~/lib/money + the Intl APIs.
 *
 * Date locale is a PARAMETER, not hard-coded, because the two surfaces
 * intentionally differ:
 *   - the web view passes the default (`[]` → the viewer's browser locale);
 *   - the PDF passes "en-US" so server-rendered output is deterministic
 *     regardless of the Node host's locale (Docker images vs laptops drift).
 * Keeping the option object here (one place) removes the prior drift risk while
 * preserving each surface's behavior exactly.
 */

import { formatCents } from "~/lib/money";

/** "First Last", trimmed; "(no name)" when both parts are empty/null. */
export function formatPersonName(p: {
	firstName: string | null;
	lastName: string | null;
}): string {
	const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
	return name || "(no name)";
}

/**
 * Render an amount that may be negative (account credit / carried-forward
 * credit line) as "−$X" with a Unicode minus (U+2212), avoiding a bare "-$".
 */
export function signedCents(cents: number): string {
	return cents < 0 ? `−${formatCents(Math.abs(cents))}` : formatCents(cents);
}

/** e.g. "Jun 13, 2026". `locale` defaults to the runtime default (`[]`). */
export function formatInvoiceDate(
	date: Date | string,
	locale: string | string[] = [],
): string {
	return new Date(date).toLocaleDateString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

/** e.g. "Jun 13, 2026, 3:45 PM". `locale` defaults to the runtime default. */
export function formatInvoiceDateTime(
	date: Date | string,
	locale: string | string[] = [],
): string {
	return new Date(date).toLocaleString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}
