/**
 * Money formatting helpers. All amounts in this codebase are integer cents
 * (matching the `*InCents` schema columns); never floats.
 */

/** Format integer cents as USD currency, e.g. 12345 -> "$123.45". */
export function formatCents(cents: number): string {
	return (cents / 100).toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
	});
}
