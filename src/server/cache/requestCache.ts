import type { User } from "@prisma/client";

/**
 * PER-REQUEST cache tier.
 *
 * Backed by `ctx.loaders` — a fresh Map created once per request in
 * createTRPCContext and thrown away when the request ends. Because it cannot
 * outlive a request, it is automatically safe for per-user data: there is no
 * staleness and no cross-user leakage to reason about.
 *
 * Use this tier for "fetch the same thing several times within one request"
 * de-duplication (the caller's User, batched lookups via a DataLoader, etc.).
 * For data SHARED across requests/viewers, use the process tier (processCache).
 */

/** Minimal shape this tier needs from the tRPC context. `loaders` is optional so
 * hand-built contexts (server-side callers, tests) still type-check — when it's
 * absent, the loaders simply run uncached. */
export type RequestCacheContext = {
	db: {
		user: {
			findUnique: (args: {
				where: { clerkUserId: string };
			}) => Promise<User | null>;
		};
	};
	auth: {
		userId: string;
	};
	loaders?: Map<string, Promise<unknown>>;
};

/**
 * Request-scoped fetch of the caller's User row (nullable — no throw).
 *
 * This is the ONE place that turns a Clerk id into our DB User. The result is
 * memoized on ctx.loaders, so calling it many times within a single request
 * issues exactly one query. We cache the in-flight Promise (not the awaited
 * value) so even simultaneous callers share the same round-trip.
 *
 * Prefer `getCurrentUser` (throws NOT_FOUND) in handlers; use this directly only
 * when you want to handle the null case yourself. NEVER write a fresh
 * `db.user.findUnique({ where: { clerkUserId } })` — route it through here.
 */
export function loadCurrentUser(
	ctx: RequestCacheContext,
): Promise<User | null> {
	const key = `currentUser:${ctx.auth.userId}`;
	const cached = ctx.loaders?.get(key) as Promise<User | null> | undefined;
	if (cached) return cached;

	const promise = ctx.db.user.findUnique({
		where: { clerkUserId: ctx.auth.userId },
	});
	ctx.loaders?.set(key, promise);
	return promise;
}
