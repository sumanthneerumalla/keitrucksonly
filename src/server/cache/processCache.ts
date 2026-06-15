/**
 * PER-PROCESS cache tier — an in-memory TTL cache with in-flight coalescing.
 *
 * Use for data that is SHARED across requests/viewers and tolerates a little
 * staleness (e.g. a live board polled every few seconds by many clients). Do
 * NOT use it for per-user data that must be fresh — use the request-scoped tier
 * (requestCache.ts) for that.
 *
 * How it behaves:
 *   - getOrLoad caches the in-flight Promise (not the resolved value), so many
 *     simultaneous callers for the same key share ONE underlying load — the
 *     same "coalescing" trick as the request cache, just at a longer scope.
 *   - Entries expire after ttlMs. A rejected load is evicted immediately, so a
 *     transient error is never pinned for the whole window.
 *
 * Why a plain Map works across requests: the backing store is module-level
 * state kept alive by the long-running Node process (the same reason the Prisma
 * client in ~/server/db.ts is a singleton). It is stashed on globalThis so it
 * also survives Next.js dev hot-reload (identical trick to db.ts). No special
 * Next.js/React caching API is involved.
 *
 * Scope caveat: this is PER PROCESS. Each server instance keeps its own store —
 * intentional for now. If a cache ever needs cross-instance consistency or to
 * survive restarts, swap the backing for a distributed store (Redis) behind
 * this same { getOrLoad, bust } interface; callers won't change.
 */

type Entry<V> = { value: Promise<V>; expiresAt: number };

export type TtlCache<K, V> = {
	/** Return the cached value for `key` if still fresh, otherwise run `loader`,
	 * cache its in-flight promise for `ttlMs`, and return it. */
	getOrLoad: (key: K, loader: () => Promise<V>) => Promise<V>;
	/** Drop `key` so the next getOrLoad reloads (use after a write that changes
	 * the underlying data and you want it visible before the TTL elapses). */
	bust: (key: K) => void;
	/** Drop everything. */
	clear: () => void;
	/** Current number of entries (mostly for tests/diagnostics). */
	size: () => number;
};

// One registry of named stores, kept on globalThis so it survives dev
// hot-reload (see module doc). In production it's just a long-lived module Map.
const globalForCache = globalThis as unknown as {
	__ttlCaches?: Map<string, Map<unknown, Entry<unknown>>>;
};
const registry =
	globalForCache.__ttlCaches ?? new Map<string, Map<unknown, Entry<unknown>>>();
globalForCache.__ttlCaches = registry;

/**
 * Create (or, across a dev hot-reload, reuse) a named per-process TTL cache.
 * `name` must be unique per cache — it keys the shared registry.
 */
export function makeTtlCache<K, V>(opts: {
	name: string;
	ttlMs: number;
}): TtlCache<K, V> {
	const { name, ttlMs } = opts;
	let store = registry.get(name) as Map<K, Entry<V>> | undefined;
	if (!store) {
		store = new Map<K, Entry<V>>();
		registry.set(name, store as unknown as Map<unknown, Entry<unknown>>);
	}
	const s = store;

	return {
		getOrLoad(key, loader) {
			const hit = s.get(key);
			if (hit && hit.expiresAt > Date.now()) return hit.value;

			const value = loader();
			s.set(key, { value, expiresAt: Date.now() + ttlMs });
			// Don't pin a failed load for the whole TTL — evict it (but only if it
			// hasn't already been replaced by a newer load for the same key).
			value.catch(() => {
				const cur = s.get(key);
				if (cur && cur.value === value) s.delete(key);
			});
			return value;
		},
		bust(key) {
			s.delete(key);
		},
		clear() {
			s.clear();
		},
		size() {
			return s.size;
		},
	};
}
