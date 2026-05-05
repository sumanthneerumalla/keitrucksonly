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
