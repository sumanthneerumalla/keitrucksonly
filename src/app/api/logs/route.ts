import { auth } from "@clerk/nextjs/server";
import { UserType } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { db } from "~/server/db";

// Tail of the container's runtime log. The log file is populated by
// docker-entrypoint.sh which tees the app's stdout/stderr to
// /tmp/runtime.log on container start (see docker-entrypoint.sh).
//
// Auth: PLATFORM_ADMIN only. Mirrors the tRPC `adminProcedure` gate in
// src/server/api/trpc.ts — look up the DB user by clerkUserId, check role.
//
// Usage:
//   GET /api/logs            → entire log file (since the current container started)
//   GET /api/logs?lines=500  → last 500 lines (capped at MAX_LINES)
//   Visit in a browser while signed in as a PLATFORM_ADMIN — session
//   cookie carries the auth automatically.
const LOG_PATH = "/tmp/runtime.log";
const MAX_LINES = 50000;

export async function GET(req: Request) {
	const { userId: clerkUserId } = await auth();
	if (!clerkUserId) {
		return new Response("unauthorized", { status: 401 });
	}

	const user = await db.user.findUnique({
		where: { clerkUserId },
		select: { userType: true },
	});
	if (!user || user.userType !== UserType.PLATFORM_ADMIN) {
		return new Response("forbidden", { status: 403 });
	}

	try {
		const content = await readFile(LOG_PATH, "utf8");
		const url = new URL(req.url);
		const linesParam = url.searchParams.get("lines");
		// Default: return the entire file (since current container start).
		// With ?lines=N: tail to last N lines (capped at MAX_LINES for safety).
		let body = content;
		if (linesParam !== null) {
			const requested = Number.parseInt(linesParam, 10);
			const n = Math.max(
				10,
				Math.min(Number.isFinite(requested) ? requested : MAX_LINES, MAX_LINES),
			);
			body = content.split("\n").slice(-n).join("\n");
		}
		return new Response(body, {
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	} catch (e) {
		return new Response(
			`logs unavailable: ${e instanceof Error ? e.message : "unknown"}`,
			{ status: 503 },
		);
	}
}
