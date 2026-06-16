/**
 * CSP violation report sink.
 *
 * Browsers POST here when a resource violates the Content-Security-Policy set in
 * src/middleware.ts (via the `report-uri` / `report-to` directives built in
 * src/lib/csp.ts). Two wire formats arrive depending on the browser:
 *   - report-uri (legacy, widest support): Content-Type `application/csp-report`,
 *     body `{ "csp-report": { "document-uri": ..., "blocked-uri": ... } }`
 *   - report-to / Reporting API (modern): Content-Type `application/reports+json`,
 *     body `[ { "type": "csp-violation", "body": { "documentURL": ... } }, ... ]`
 * Both are normalised into CspReport rows.
 *
 * This endpoint MUST stay public: browsers fire violation reports from their own
 * engine without credentials (the Reporting API never sends cookies), and many
 * pages here are public/logged-out — gating it behind auth would silently drop
 * the majority of legitimate reports. Instead we defend it as an open endpoint:
 *   - best-effort attribution: capture the Clerk userId IF the session cookie
 *     happened to ride along (same-origin report-uri from a logged-in user);
 *     null otherwise. Never required.
 *   - per-IP rate limiting + body/count caps so it can't be flooded.
 *   - payload validation: only store things that actually look like CSP reports.
 * Every value is untrusted input — we only ever store it, never act on it — and
 * we always return 204 so a malformed or hostile report never surfaces an error.
 */

import { auth } from "@clerk/nextjs/server";
import type { Prisma } from "@prisma/client";
import { db } from "~/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSP reports are tiny; cap body + count so the public endpoint can't be used to
// burn memory or flood the table in a single request.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_REPORTS_PER_REQUEST = 20;
const MAX_FIELD_CHARS = 4000;

// Per-IP fixed-window rate limit. In-memory (single container — see infra notes);
// resets on restart, which is fine for abuse-dampening. Bounded so a flood of
// distinct IPs can't grow the map without limit.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 60;
const RATE_MAP_MAX_KEYS = 10_000;
const rateHits = new Map<string, { count: number; resetAt: number }>();

/** Returns true if this IP is over its per-window budget (and should be dropped). */
function isRateLimited(ip: string, now: number): boolean {
	const entry = rateHits.get(ip);
	if (!entry || now >= entry.resetAt) {
		// Opportunistic cleanup so the map can't grow unbounded under an IP flood.
		if (rateHits.size > RATE_MAP_MAX_KEYS) {
			for (const [k, v] of rateHits) if (now >= v.resetAt) rateHits.delete(k);
		}
		rateHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
		return false;
	}
	entry.count += 1;
	return entry.count > RATE_MAX_PER_WINDOW;
}

/** Client IP from Caddy's X-Forwarded-For (first hop), falling back to X-Real-IP. */
function clientIp(req: Request): string {
	const xff = req.headers.get("x-forwarded-for");
	if (xff) return xff.split(",")[0]?.trim().slice(0, 64) ?? "unknown";
	return req.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}

const str = (v: unknown): string | null =>
	typeof v === "string" && v.length > 0 ? v.slice(0, MAX_FIELD_CHARS) : null;
const num = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Map one report object (either wire format) to a CspReport row. report-uri uses
 * hyphenated keys; the Reporting API uses camelCase — `pick` tries both.
 */
function toRow(
	report: Record<string, unknown>,
	meta: { userAgent: string | null; clerkUserId: string | null; ip: string },
): Prisma.CspReportCreateManyInput {
	const pick = (hyphen: string, camel: string) =>
		report[hyphen] ?? report[camel];
	return {
		clerkUserId: meta.clerkUserId,
		ip: meta.ip === "unknown" ? null : meta.ip,
		disposition: str(report.disposition),
		documentUri: str(pick("document-uri", "documentURL")),
		referrer: str(report.referrer),
		blockedUri: str(pick("blocked-uri", "blockedURL")),
		effectiveDirective: str(pick("effective-directive", "effectiveDirective")),
		// report-uri sends `violated-directive`; the Reporting API folds it into
		// `effectiveDirective`, so fall back to that.
		violatedDirective: str(pick("violated-directive", "effectiveDirective")),
		originalPolicy: str(pick("original-policy", "originalPolicy")),
		sourceFile: str(pick("source-file", "sourceFile")),
		lineNumber: num(pick("line-number", "lineNumber")),
		columnNumber: num(pick("column-number", "columnNumber")),
		scriptSample: str(pick("script-sample", "sample")),
		statusCode: num(pick("status-code", "statusCode")),
		userAgent: meta.userAgent,
		raw: report as Prisma.InputJsonValue,
	};
}

/** A row is worth storing only if it carries at least one real CSP field. */
function isMeaningful(row: Prisma.CspReportCreateManyInput): boolean {
	return Boolean(
		row.effectiveDirective ||
			row.violatedDirective ||
			row.blockedUri ||
			row.documentUri,
	);
}

export async function POST(req: Request): Promise<Response> {
	try {
		const ip = clientIp(req);
		if (isRateLimited(ip, Date.now())) {
			return new Response(null, { status: 429 });
		}

		const body = await req.text();
		if (!body || body.length > MAX_BODY_BYTES) {
			return new Response(null, { status: 204 });
		}

		const parsed: unknown = JSON.parse(body);
		const userAgent = req.headers.get("user-agent")?.slice(0, 1000) ?? null;

		// Best-effort attribution: present only when the Clerk session cookie rode
		// along (same-origin, logged-in). auth() returns null userId otherwise —
		// never throws, never blocks the report.
		const { userId } = await auth();
		const meta = { userAgent, clerkUserId: userId ?? null, ip };

		// Pull the report object(s) out of whichever envelope arrived.
		const reports: Record<string, unknown>[] = [];
		if (Array.isArray(parsed)) {
			// Reporting API: [{ type, body }, ...]
			for (const entry of parsed) {
				const inner = (entry as Record<string, unknown> | null)?.body;
				if (inner && typeof inner === "object") {
					reports.push(inner as Record<string, unknown>);
				}
			}
		} else if (parsed && typeof parsed === "object") {
			// report-uri: { "csp-report": {...} } (fall back to the root object).
			const inner = (parsed as Record<string, unknown>)["csp-report"];
			reports.push(
				inner && typeof inner === "object"
					? (inner as Record<string, unknown>)
					: (parsed as Record<string, unknown>),
			);
		}

		const rows = reports
			.slice(0, MAX_REPORTS_PER_REQUEST)
			.map((r) => toRow(r, meta))
			.filter(isMeaningful);
		if (rows.length > 0) {
			await db.cspReport.createMany({ data: rows });
		}
	} catch {
		// Swallow: a bad report must never become a client-visible error.
	}
	return new Response(null, { status: 204 });
}
