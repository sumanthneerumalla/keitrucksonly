/**
 * Shared helpers for the club-onboarding funnel.
 *
 * Every flow that needs to send a logged-out / not-yet-joined user through
 * `/join` builds the URL with `buildJoinUrl` instead of hand-concatenating, so
 * there is ONE place that owns the param names + encoding. The optional `next`
 * is an internal "return here when done" path consumed only by `/join` and
 * `/profile` (it is NOT a Clerk param — it rides inside the `/join` URL that we
 * hand to Clerk's forceRedirectUrl/redirect_url).
 */

/**
 * Validate a `next` return-to value. Returns the path if it is a safe app
 * internal path, otherwise null. Guards against open redirects:
 * - must be an absolute path ("/...")
 * - reject protocol-relative ("//host") and backslash bypass ("/\\host")
 */
export function safeInternalPath(
	next: string | null | undefined,
): string | null {
	if (!next) return null;
	if (!next.startsWith("/")) return null;
	if (next.startsWith("//") || next.startsWith("/\\")) return null;
	return next;
}

/**
 * Build a `/join` funnel URL. All params are optional:
 * - clubShortName / facilityId: preselect (both → auto-join, club only → picker)
 * - next: where to send the user once they're onboarded (sanitized)
 */
export function buildJoinUrl({
	clubShortName,
	facilityId,
	next,
}: {
	clubShortName?: string | null;
	facilityId?: string | null;
	next?: string | null;
} = {}): string {
	const params = new URLSearchParams();
	if (clubShortName) params.set("clubShortName", clubShortName);
	if (facilityId) params.set("facilityId", facilityId);
	const safeNext = safeInternalPath(next);
	if (safeNext) params.set("next", safeNext);
	const qs = params.toString();
	return qs ? `/join?${qs}` : "/join";
}

export type JoinIntent = {
	clubShortName?: string | null;
	facilityId?: string | null;
	next?: string | null;
};

const JOIN_INTENT_KEY = "fp.joinIntent";

/**
 * Stash the join-funnel target in sessionStorage right before handing off to
 * Clerk. Clerk's auth redirect strips the query string from forceRedirectUrl,
 * so this side channel is what actually carries clubShortName/facilityId/next
 * across the sign-in/up hop. Survives the full round-trip (incl. OAuth) because
 * sessionStorage is per-tab and the tab returns to the same origin.
 */
export function stashJoinIntent(intent: JoinIntent): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.setItem(JOIN_INTENT_KEY, JSON.stringify(intent));
	} catch {}
}

/** Read AND clear the stashed join intent (single use). */
export function readJoinIntent(): JoinIntent | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.sessionStorage.getItem(JOIN_INTENT_KEY);
		if (!raw) return null;
		window.sessionStorage.removeItem(JOIN_INTENT_KEY);
		return JSON.parse(raw) as JoinIntent;
	} catch {
		return null;
	}
}
