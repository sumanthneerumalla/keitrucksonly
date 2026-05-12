import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

function deployedAgo(iso: string | undefined): string | undefined {
	if (!iso || iso === "unknown") return undefined;
	const buildMs = new Date(iso).getTime();
	if (Number.isNaN(buildMs)) return undefined;
	const diffMin = Math.floor((Date.now() - buildMs) / 60_000);
	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	const hours = Math.floor(diffMin / 60);
	if (hours < 24) return `${hours}h ${diffMin % 60}m ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ${hours % 24}h ago`;
}

// Per-phase deploy timing is written by the cron poll scripts into
// /app/.deploy-info.json via `docker exec` after a successful redeploy
// (see scripts/poll-*-redeploy.sh). The file lives in the container's
// writable layer — survives `docker restart`, but is wiped when a new
// container is created on the next redeploy.
//
// 1-second in-memory cache avoids hitting the FS on every health probe
// (docker healthcheck fires every 30s, plus visitor footer fetches).
let cachedDeploy: unknown = null;
let cachedAt = 0;

async function readDeployInfo(): Promise<unknown> {
	if (Date.now() - cachedAt < 1000) return cachedDeploy;
	try {
		cachedDeploy = JSON.parse(
			await readFile("/app/.deploy-info.json", "utf8"),
		);
	} catch {
		// File missing — pick the most informative status.
		const hasBuildSha =
			!!process.env.BUILD_SHA && process.env.BUILD_SHA !== "unknown";
		const uptimeSec = Math.floor(process.uptime());
		if (!hasBuildSha) {
			cachedDeploy = {
				status: "unavailable",
				note: "no deploy info — likely local dev or untracked container",
			};
		} else if (uptimeSec < 60) {
			cachedDeploy = {
				status: "pending",
				note: `container started ${uptimeSec}s ago; deploy file not yet written`,
			};
		} else {
			cachedDeploy = {
				status: "stale",
				note: `container has been up for ${uptimeSec}s with no deploy file — likely auto-restarted (OOM, crash, manual restart) since the last redeploy. Next redeploy will repopulate.`,
				uptimeSeconds: uptimeSec,
			};
		}
	}
	cachedAt = Date.now();
	return cachedDeploy;
}

/**
 * Health check endpoint for Docker and monitoring systems
 * Returns basic health information about the application
 */
export async function GET() {
	try {
		const buildSha = process.env.BUILD_SHA;
		const buildTimestamp = process.env.BUILD_TIMESTAMP;

		const healthData = {
			status: "ok",
			timestamp: new Date().toISOString(),
			uptime: process.uptime(),
			environment: process.env.NODE_ENV,
			version: process.env.npm_package_version || "unknown",
			buildSha: buildSha || "unknown",
			buildShaShort: buildSha ? buildSha.slice(0, 7) : "unknown",
			buildTimestamp: buildTimestamp || "unknown",
			deployedAgo: deployedAgo(buildTimestamp),
			deploy: await readDeployInfo(),
		};

		return NextResponse.json(healthData, { status: 200 });
	} catch (error) {
		console.error("Health check failed:", error);
		return NextResponse.json(
			{ status: "error", message: "Health check failed" },
			{ status: 500 },
		);
	}
}
