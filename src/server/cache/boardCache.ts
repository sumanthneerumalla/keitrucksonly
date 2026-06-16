import type { PrismaClient } from "@prisma/client";
import { makeTtlCache } from "./processCache";

/**
 * PER-PROCESS cache for the drop-in board read.
 *
 * The board is polled every ~3s by every viewer (kiosk + each authed client),
 * and each read fans out into ~7 round-trips (session + check-ins + assignments
 * + participants + parties + members + users). Without caching, N viewers of one
 * session generate N×7 round-trips every 3 seconds for identical data.
 *
 * This cache collapses all polls of the same session within a short window into
 * ONE underlying load, shared via in-flight coalescing.
 *
 * Freshness model (why there's no explicit invalidation on every mutation):
 *   - Only the two hot POLLING reads (getBoard / getPublicBoard) read through
 *     this cache. Every mutation reads the UNCACHED loader, so the acting user
 *     always sees their own change immediately in the mutation's response.
 *   - Other viewers converge within TTL_MS (≤1.5s) on their next poll — below
 *     the 3s poll interval, so the delay is imperceptible on a live board.
 *   - `bustBoard` is exported for the rare case where you want a change visible
 *     to other viewers faster than the TTL; it is intentionally NOT wired into
 *     every mutation (that churn isn't worth ≤1.5s).
 */
const TTL_MS = 1500;

const cache = makeTtlCache<string, unknown>({ name: "board", ttlMs: TTL_MS });

function keyFor(eventId: string, occurrenceDate: Date): string {
	return `${eventId}:${occurrenceDate.toISOString()}`;
}

type BoardLoader<T> = (
	db: PrismaClient,
	eventId: string,
	occurrenceDate: Date,
) => Promise<T>;

/**
 * Cached read of a board session. Pass the underlying (uncached) loader — this
 * keeps boardCache free of any dependency on the dropIn router's types and
 * avoids an import cycle. Identical concurrent calls share one load.
 */
export function loadBoardCached<T>(
	db: PrismaClient,
	eventId: string,
	occurrenceDate: Date,
	loader: BoardLoader<T>,
): Promise<T> {
	return cache.getOrLoad(keyFor(eventId, occurrenceDate), () =>
		loader(db, eventId, occurrenceDate),
	) as Promise<T>;
}

/** Drop the cached board for one session so the next poll reloads immediately. */
export function bustBoard(eventId: string, occurrenceDate: Date): void {
	cache.bust(keyFor(eventId, occurrenceDate));
}
