"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const STORAGE_KEY = "fp-strip-dismissed-v1";

export function Strip() {
	// Render visible by default to avoid CLS during hydration. If the user has
	// dismissed, the effect hides it on the next paint — at most one frame of
	// flicker for previously-dismissed users, vs. layout-jump for everyone.
	const [dismissed, setDismissed] = useState(false);
	const pathname = usePathname();

	useEffect(() => {
		try {
			if (localStorage.getItem(STORAGE_KEY) === "1") setDismissed(true);
		} catch {}
	}, []);

	const dismiss = () => {
		setDismissed(true);
		try {
			localStorage.setItem(STORAGE_KEY, "1");
		} catch {}
	};

	if (dismissed) return null;

	const onPricing = pathname === "/pricing";

	return (
		<div className="bg-[var(--ink)] text-[13px] text-[var(--paper)]">
			<div className="container mx-auto flex items-center justify-center gap-3 px-4 py-2 text-center">
				<span className="hidden items-center justify-center rounded-full bg-[var(--brand)] px-2 py-[2px] font-mono font-semibold text-[10.5px] text-white uppercase tracking-[0.08em] sm:inline-flex">
					Now in beta
				</span>
				<span className="leading-snug">
					Replacing 4–6 tools (and 12+ spreadsheets) for racquet clubs
					nationwide.
					{onPricing ? null : (
						<>
							{" "}
							<Link
								href="/pricing"
								className="border-[var(--brand-100)] border-b border-dotted pb-[1px] text-[var(--brand-100)]"
							>
								See plans →
							</Link>
						</>
					)}
				</span>
				<button
					type="button"
					onClick={dismiss}
					aria-label="Dismiss announcement"
					className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-white/60 hover:text-white"
				>
					<X size={14} />
				</button>
			</div>
		</div>
	);
}

export default Strip;
