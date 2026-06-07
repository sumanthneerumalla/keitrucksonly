/**
 * getConfig — the one canonical way to read a server-side config value or
 * secret. Resolves env-first, then the `PlatformConfig` DB table, so a value
 * can be supplied EITHER as an environment variable OR as a DB row with no
 * code change.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RESOLUTION ORDER (first hit wins)
 *   1. process.env[KEY]      — environment variable, read fresh every call
 *   2. PlatformConfig table  — DB row whose `key` === KEY (cached 60s)
 *   3. null                  — not configured anywhere
 *
 *   A managed secrets service (Infisical/Doppler/Vault), if we ever adopt one,
 *   slots in between 2 and 3 — every call site keeps working unchanged.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ONE NAMING RULE
 *   The SAME UPPER_SNAKE_CASE name is used in all three places: the env var,
 *   the `PlatformConfig.key` row, and the string passed to getConfig. No
 *   lowercase mirror, no prefix rewriting — e.g. `STRIPE_SECRET_KEY` and
 *   `NEXT_PUBLIC_APP_URL` are stored under those EXACT names. Pick the
 *   canonical env-var name and use it verbatim everywhere.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HOW TO MAKE A NEW KEY DB-BACKABLE  (future agents: follow this format)
 *   On the SERVER, read it with:   const v = await getConfig("MY_KEY");
 *   That's the whole pattern. If the env var is set it wins; otherwise, if a
 *   `PlatformConfig` row with key="MY_KEY" exists, that value is used. To
 *   configure it without a redeploy, add/edit that row (e.g. via Prisma
 *   Studio); the change is live within 60s. Do NOT build a second lookup
 *   path — route every env-or-DB read through getConfig so there is exactly
 *   one consistent way to do this across the codebase.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHEN NOT TO USE THIS
 *   • Server-only. It touches the DB via Prisma, so it CANNOT run in client
 *     components or Next.js edge middleware. For a value the browser needs,
 *     call getConfig on the server and pass the result down as a prop.
 *   • Not for `DATABASE_URL` — it is the credential needed to reach the DB
 *     (chicken-and-egg), so it must come from the environment.
 *   • Not for keys a third-party SDK reads from `process.env` itself (e.g.
 *     Clerk's CLERK_SECRET_KEY) — there is no call site of ours to route
 *     through getConfig, so those stay env-only.
 *
 * Caching: only the DB lookup is cached (60s TTL, negative results included).
 * Env values are read fresh every call, so a restart with new env vars takes
 * effect immediately, while a DB-row edit takes effect within the TTL.
 */

import { db } from "~/server/db";

const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { value: string | null; expiresAt: number }>();

/**
 * Read a config value, env-first then DB-fallback. `key` is the canonical
 * UPPER_SNAKE_CASE name, used identically as the env var and the
 * `PlatformConfig.key` row (e.g. "STRIPE_SECRET_KEY"). Returns null when set
 * in neither place.
 */
export async function getConfig(key: string): Promise<string | null> {
	// 1. Environment variable — read fresh (cheap; a restart with new env
	//    values takes effect immediately).
	const envValue = process.env[key];
	if (envValue && envValue.trim() !== "") return envValue;

	// 2. PlatformConfig DB row, keyed by the SAME name (cached 60s, incl. misses).
	const cached = cache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	const row = await db.platformConfig.findUnique({ where: { key } });
	const value = row?.value ?? null;

	// (A managed secrets service lookup would slot in here, before caching.)

	cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
	return value;
}

/**
 * Drop the cached DB value for one key — call after writing a PlatformConfig
 * row through an admin mutation so the change is visible immediately rather
 * than within the 60s TTL. Optional; the cache refreshes on its own.
 */
export function invalidateConfigCache(key: string): void {
	cache.delete(key);
}
