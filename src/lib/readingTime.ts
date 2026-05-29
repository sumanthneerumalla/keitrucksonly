/**
 * Estimate reading time in whole minutes from an HTML body: strip tags, count
 * words, divide by 200 wpm, ceil, with a floor of 1 minute.
 */
export function readingTimeMinutes(html: string): number {
	const text = html.replace(/<[^>]*>/g, " ");
	const words = text.split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.ceil(words / 200));
}
