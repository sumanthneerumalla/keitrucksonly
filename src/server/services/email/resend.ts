import { TRPCError } from "@trpc/server";
import { convert } from "html-to-text";
import DOMPurify from "isomorphic-dompurify";
import { Resend } from "resend";
import { getConfig } from "~/server/utils/config";

// ─── Client ─────────────────────────────────────────────────────────────────

export async function getResendClient(): Promise<Resend> {
	const apiKey = await getConfig("RESEND_API_KEY");
	if (!apiKey) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"Email sending is not configured. Set RESEND_API_KEY (env var or PlatformConfig row) and RESEND_FROM_EMAIL.",
		});
	}
	return new Resend(apiKey);
}

// ─── Address helpers ─────────────────────────────────────────────────────────

export async function getFromAddress(user: {
	firstName: string | null;
	lastName: string | null;
}): Promise<string> {
	const fromEmail = await getConfig("RESEND_FROM_EMAIL");
	if (!fromEmail) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "RESEND_FROM_EMAIL is not configured.",
		});
	}
	const display = getDisplayName(user);
	return `${display} <${fromEmail}>`;
}

export function getDisplayName(user: {
	firstName: string | null;
	lastName: string | null;
}): string {
	return `${user.firstName ?? "Shuttle"} ${user.lastName ?? "Mentor"}`;
}

// ─── Retry (429-only, exponential backoff) ───────────────────────────────────

const RETRY_DELAYS_MS = [1000, 2000, 4000];

export async function withRetry<T>(
	fn: () => Promise<T>,
	maxAttempts = 3,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err: any) {
			const status = err?.statusCode ?? err?.status ?? err?.response?.status;
			if (status !== 429) throw err;
			lastError = err;
			if (attempt < maxAttempts - 1) {
				await new Promise((res) => setTimeout(res, RETRY_DELAYS_MS[attempt]));
			}
		}
	}
	throw lastError;
}

// ─── Batch response parsing ──────────────────────────────────────────────────

/**
 * Extract the per-email Resend IDs from a `batch.send` success response.
 *
 * For resend@6, the awaited result is `{ data, error }` where, on success,
 * `data` is `{ data: [{ id }, …] }` (the IDs are nested one level deep). The
 * array is returned in the same order as the input batch, so `ids[i]` maps to
 * `batch[i]`. We return `(string | null)[]` so callers can detect any missing
 * id and treat that recipient as un-tracked rather than silently "sent".
 *
 * Use this in BOTH the send and retry paths so the two never drift apart.
 */
export function extractBatchEmailIds(data: unknown): (string | null)[] {
	const inner = (data as { data?: { id?: string }[] } | null)?.data;
	if (!Array.isArray(inner)) return [];
	return inner.map((d) => d?.id ?? null);
}

// ─── HTML sanitization ───────────────────────────────────────────────────────

const ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"h1",
	"h2",
	"h3",
	"h4",
	"ul",
	"ol",
	"li",
	"a",
	"img",
	"blockquote",
	"hr",
	"span",
	"div",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
];

const ALLOWED_ATTR = [
	"href",
	"src",
	"alt",
	"target",
	"rel",
	"style",
	"width",
	"height",
];

export function sanitizeEmailHtml(html: string): string {
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
	}) as string;
}

// ─── Plain-text conversion ───────────────────────────────────────────────────

export function htmlToText(html: string): string {
	return convert(html, {
		wordwrap: 80,
		selectors: [
			{ selector: "a", options: { hideLinkHrefIfSameAsText: true } },
			{ selector: "img", format: "skip" },
			{ selector: "h1", options: { uppercase: false } },
			{ selector: "h2", options: { uppercase: false } },
			{ selector: "h3", options: { uppercase: false } },
		],
	});
}
