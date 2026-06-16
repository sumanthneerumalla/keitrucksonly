"use client";

import { useEffect, useState } from "react";

/**
 * Trailing debounce: returns `value` once it has been stable for `ms`.
 *
 * The repo-standard debounce for search typeaheads (replaces the hand-rolled
 * `setTimeout` + second-state pattern that used to be copy-pasted per search
 * box). Pass the already-trimmed query if the consumer wants trimming.
 */
export function useDebouncedValue<T>(value: T, ms = 300): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return debounced;
}
