"use client";

import { useSearchParams } from "next/navigation";
import { safeInternalPath } from "~/lib/onboardingUrl";

/**
 * Read the sanitized `next` return-to path from the URL. Returns null when
 * absent or unsafe. Used identically by `/join` and `/profile` so the read
 * logic can't drift between them.
 */
export function useReturnTo(): string | null {
	const searchParams = useSearchParams();
	return safeInternalPath(searchParams.get("next"));
}
