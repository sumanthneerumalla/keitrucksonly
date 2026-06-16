/**
 * Central home for caching. Every cache in the app should live here so there is
 * one obvious place to look for "is this already cached, and how?".
 *
 * Pick a tier by asking two questions:
 *   1. WHO must share the value?   just this request → this instance → ...
 *   2. How STALE can it be?        never → a few seconds → ...
 *
 * Tiers we support today:
 *
 *   ┌───────────────┬───────────────────────┬───────────────┬───────────────────┐
 *   │ tier          │ scope (who shares)    │ staleness     │ file              │
 *   ├───────────────┼───────────────────────┼───────────────┼───────────────────┤
 *   │ per-request   │ one server request    │ none          │ requestCache.ts   │
 *   │ per-process   │ one server instance   │ short TTL      │ processCache.ts   │
 *   └───────────────┴───────────────────────┴───────────────┴───────────────────┘
 *
 * Rule of thumb:
 *   - per-USER or must-be-FRESH  → request scope (requestCache, on ctx.loaders)
 *   - SHARED + a little stale OK  → process scope (processCache, module-level TTL)
 *
 * Each cached *concept* gets exactly ONE named accessor (e.g. loadCurrentUser,
 * loadBoardCached). Call sites use that accessor — they never touch a Map
 * directly. That keeps the storage swappable (e.g. promote a process cache to a
 * distributed/Redis cache later) without changing any caller.
 *
 * Not built yet (deliberately — YAGNI): a distributed tier (Redis) for
 * cross-instance consistency. The processCache interface (getOrLoad/bust) is
 * shaped so that swap is a one-file change if/when it's ever needed.
 */

// --- per-request tier ---------------------------------------------------------
export { loadCurrentUser, type RequestCacheContext } from "./requestCache";

// --- per-process tier (mechanism) --------------------------------------------
export { makeTtlCache, type TtlCache } from "./processCache";

// --- per-process tier (concepts) ---------------------------------------------
export { loadBoardCached, bustBoard } from "./boardCache";
