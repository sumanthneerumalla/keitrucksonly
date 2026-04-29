"use client";

import { useEffect, useState } from "react";

const HEADLINES = [
	{
		strike: "spreadsheets",
		rest: ", clipboards & 4 tools.",
		lead: "Run your racquet club from one place. Bookings, check-ins, packages, payments, and reports — under one roof, with one bill.",
	},
	{
		strike: "front-desk chaos",
		rest: ".",
		lead: "Members self-check-in. Courts book themselves. Your team finally gets out from behind the desk.",
	},
	{
		strike: "missed revenue",
		rest: ".",
		lead: "Capture every booking, every credit, every walk-in. The point-of-sale, court calendar, and league software — finally talking to each other.",
	},
];

const ROTATE_MS = 5000;
const FADE_MS = 350;

// Stack all variants in the same CSS grid cell so the container sizes to the
// longest variant. Avoids layout shift when the active headline changes.
const STACK_STYLE = { display: "grid" } as const;
const STACK_ITEM_STYLE = { gridArea: "1 / 1" } as const;

export function RotatingHeadline() {
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const [reducedMotion, setReducedMotion] = useState(false);

	useEffect(() => {
		const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(mql.matches);
		update();
		mql.addEventListener("change", update);
		return () => mql.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		if (paused || reducedMotion) return;
		const tick = window.setInterval(() => {
			setIndex((i) => (i + 1) % HEADLINES.length);
		}, ROTATE_MS);
		return () => window.clearInterval(tick);
	}, [paused, reducedMotion]);

	const transition = reducedMotion ? "none" : `opacity ${FADE_MS}ms ease`;

	return (
		<div
			onMouseEnter={() => setPaused(true)}
			onMouseLeave={() => setPaused(false)}
			onFocus={() => setPaused(true)}
			onBlur={() => setPaused(false)}
		>
			<h1 className="mt-4">
				One platform to <span className="accent">run your courts.</span>
				<br />
				<span style={STACK_STYLE} className="align-top">
					{HEADLINES.map((h, i) => (
						<span
							key={h.strike}
							aria-hidden={i !== index}
							style={{
								...STACK_ITEM_STYLE,
								opacity: i === index ? 1 : 0,
								transition,
							}}
						>
							No more <span className="strike-bar">{h.strike}</span>
							{h.rest}
						</span>
					))}
				</span>
			</h1>

			<div className="mt-5 max-w-[620px]" style={STACK_STYLE}>
				{HEADLINES.map((h, i) => (
					<p
						key={h.strike}
						className="lead"
						aria-hidden={i !== index}
						style={{
							...STACK_ITEM_STYLE,
							opacity: i === index ? 1 : 0,
							transition,
						}}
					>
						{h.lead}
					</p>
				))}
			</div>

			<div
				className="mt-3 flex gap-1.5"
				role="tablist"
				aria-label="Headline variants"
			>
				{HEADLINES.map((h, i) => (
					<button
						key={h.strike}
						type="button"
						role="tab"
						aria-selected={i === index}
						aria-label={`Headline ${i + 1}`}
						onClick={() => setIndex(i)}
						className={`h-1.5 rounded-full transition-all ${
							i === index
								? "w-6 bg-[var(--brand)]"
								: "w-1.5 bg-[var(--line-2)] hover:bg-[var(--ink-4)]"
						}`}
					/>
				))}
			</div>
		</div>
	);
}

export default RotatingHeadline;
