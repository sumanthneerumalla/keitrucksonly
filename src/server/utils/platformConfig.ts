/**
 * Phase 12a — env-first / DB-fallback config reader.
 *
 * Interim no-SSH workaround so the owner can configure Stripe (and future
 * processor) secrets via Prisma Studio + platform-admin tRPC mutations
 * instead of editing `.env` on the server. When env vars can be set again,
 * delete the rows in `PlatformConfig` — env always wins.
 *
 * Lookup order:
 *   1. `process.env[envVarName]` — primary source.
 *   2. `PlatformConfig` table by `key` — fallback.
 *   3. `null` — neither set.
 *
 * Caching: ONLY the DB lookup is cached, with a 60s TTL. Env vars are read
 * fresh every call (cheap), so a restart with new env values takes effect
 * immediately. The 60s TTL on the DB path keeps webhook + checkout hot paths
 * off the DB without making rotation painful — a Prisma Studio edit becomes
 * effective within a minute, no app restart needed.
 *
 * Negative results (no env + no row) are cached too, so a missing config
 * key doesn't hammer the DB on every request.
 */

import { db } from "~/server/db";

const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { value: string | null; expiresAt: number }>();

/**
 * Read a configuration value with env-first, DB-fallback semantics.
 *
 * @param envVarName e.g. `STRIPE_SECRET_KEY` — read fresh from `process.env`.
 * @param dbKey      e.g. `stripe_secret_key` — key in the `PlatformConfig`
 *                   table (lowercase snake_case mirror of the env name).
 */
export async function getPlatformConfig(
	envVarName: string,
	dbKey: string,
): Promise<string | null> {
	// Env-first. Always read fresh — process.env access is cheap and lets a
	// restart with new env vars take effect immediately.
	const envValue = process.env[envVarName];
	if (envValue && envValue.trim() !== "") return envValue;

	// DB fallback (cached 60s, including negative results).
	const cached = cache.get(dbKey);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	const row = await db.platformConfig.findUnique({ where: { key: dbKey } });
	const value = row?.value ?? null;
	cache.set(dbKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
	return value;
}

/**
 * Clear the in-process cache for a single key (e.g., after a write through
 * an admin mutation). Optional — the cache refreshes within 60s anyway.
 */
export function invalidatePlatformConfigCache(dbKey: string): void {
	cache.delete(dbKey);
}
