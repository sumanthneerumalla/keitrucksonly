/**
 * Build a Google Maps search URL from address parts (B4 — a link, not an
 * embed: no third-party script loads on our pages). Falsy parts are dropped.
 * Shared by the club landing locations section, the club footer, and event
 * pages so "open in Google Maps" behaves identically everywhere.
 */
export function googleMapsSearchUrl(
	...parts: (string | null | undefined)[]
): string {
	const query = parts.filter(Boolean).join(", ");
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
