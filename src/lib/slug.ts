/**
 * Convert arbitrary text into a URL slug: lowercase, trimmed, with
 * spaces/non-alphanumerics collapsed to single hyphens and leading/trailing
 * hyphens stripped. Falls back to "untitled" when the input strips to empty
 * (e.g., emoji-only titles, all-punctuation input) so callers always get a
 * non-empty slug suitable for URL use.
 */
export function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug === "" ? "untitled" : slug;
}
