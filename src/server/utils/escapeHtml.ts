/**
 * Escape a plain-text string for safe interpolation into an HTML context.
 *
 * Replaces the five characters that have special meaning in HTML/XML so that
 * the result can be embedded inside element content or attribute values without
 * being interpreted as markup.
 *
 * Use this whenever you build an HTML email body by interpolating
 * database-sourced strings (e.g. event titles, club names, user names).
 * For user-authored rich HTML (e.g. email-groups composer), use
 * `sanitizeEmailHtml` from `~/server/services/email/sanitize` instead.
 */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}
