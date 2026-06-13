import { revalidatePath } from "next/cache";

/**
 * Phase 16 D9 — mark a club's public landing page stale so the next visit
 * re-renders with fresh branding/hours/events. Call from any tRPC mutation
 * that changes content shown on the public club landing page (branding,
 * facility details, public events). The landing page's time-based ISR window
 * is the safety net for anything missed.
 *
 * Registry of mutations that must call this lives in
 * designFiles/roadmap/phase16-club-landing-pages.md.
 */
export function revalidateClub(clubShortName: string): void {
	// Internal route path (the middleware rewrite target for /<short>).
	revalidatePath(`/club/${clubShortName}`);
}
