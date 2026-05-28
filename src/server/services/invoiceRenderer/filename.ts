/**
 * Phase 9b — invoice PDF filename builder.
 *
 * Convention (decided 2026-05-25):
 *   "<ConsumerLast>_<ConsumerFirst>_<InvoiceNumber>.pdf"
 *
 * Consumer name (not payer) — staff and members both refer to "Uri's
 * invoice", and saving to a folder per-member sorts naturally.
 *
 * Sanitization:
 *   - Strip everything but ASCII alphanumerics, dash, and underscore so the
 *     filename survives email clients, Windows, macOS, and the
 *     Content-Disposition header without quoting tricks.
 *
 * Edge cases:
 *   - `formatPersonName` (in ./assemble.ts) returns the literal sentinel
 *     `"(no name)"` when both firstName and lastName are blank. If we just
 *     sanitize that we get `name_no_<InvoiceNumber>.pdf` which looks
 *     misleadingly like a real surname. So we detect the sentinel and
 *     route to the fallback below.
 *   - A name that's pure non-ASCII (CJK, Devanagari, emoji) strips to
 *     empty after sanitization. In that case we ALSO fall back so we
 *     never emit a leading underscore-only filename.
 *   - Fallback uses the invoice number (always present, always
 *     recognizable to both staff and member) rather than an opaque
 *     id slice.
 */

import type { RenderableInvoice } from "./types";

/** Sentinel returned by formatPersonName in ./assemble.ts when a person
 * has neither firstName nor lastName. Treated as empty for filename
 * purposes so we don't ship "name_no_INV-000003.pdf". */
const NO_NAME_SENTINEL = "(no name)";

const FILENAME_SAFE_PUNCT = /[^a-zA-Z0-9_-]+/g;

function sanitizeSegment(s: string | null | undefined): string {
	if (!s) return "";
	return s.replace(FILENAME_SAFE_PUNCT, "").slice(0, 60);
}

export function buildInvoiceFilename(dto: RenderableInvoice): string {
	const consumerFullName = dto.consumer.fullName;
	const trimmed = consumerFullName.trim();
	const effective = trimmed === NO_NAME_SENTINEL ? "" : trimmed;

	// Split on the LAST space so "Mary Anne Smith" → first="Mary Anne", last="Smith"
	// rather than truncating mid-name. Multi-word last names like "Van Damme"
	// won't survive, but it's an edge case we can revisit.
	const lastSpace = effective.lastIndexOf(" ");
	const firstName = lastSpace >= 0 ? effective.slice(0, lastSpace) : "";
	const lastName = lastSpace >= 0 ? effective.slice(lastSpace + 1) : effective;

	const safeLast = sanitizeSegment(lastName);
	const safeFirst = sanitizeSegment(firstName);
	const safeNumber = sanitizeSegment(dto.meta.invoiceNumber) || "INV";

	const parts = [safeLast, safeFirst, safeNumber].filter((p) => p.length > 0);
	const stem =
		parts.length > 0 && (safeLast.length > 0 || safeFirst.length > 0)
			? parts.join("_")
			: `Invoice_${safeNumber}`;
	return `${stem}.pdf`;
}
