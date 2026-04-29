"use client";

import React from "react";

const COURTS = ["Court 1", "Court 2", "Court 3", "Court 4 (Indoor)"];
const HOURS = [
	"8a",
	"9a",
	"10a",
	"11a",
	"12p",
	"1p",
	"2p",
	"3p",
	"4p",
	"5p",
	"6p",
	"7p",
];

type BookingType =
	| "rental"
	| "class"
	| "league"
	| "open"
	| "lesson"
	| "available"
	| "block";

const BOOKINGS: Array<[number, number, number, string, BookingType]> = [
	[0, 1, 1.5, "M. Chen + 1", "rental"],
	[0, 5, 1, "Adult Drills", "class"],
	[0, 8, 2, "Open Play", "open"],
	[1, 0, 1, "Junior Acad.", "class"],
	[1, 2, 1.5, "R. Patel", "rental"],
	[1, 6, 1.5, "League Night", "league"],
	[1, 9, 1, "L. Kim + 3", "rental"],
	[2, 1, 1, "Coach Sam", "lesson"],
	[2, 3, 2, "Round Robin", "league"],
	[2, 7, 1.5, "Available", "available"],
	[2, 10, 1, "T. Reyes", "rental"],
	[3, 0, 2, "Block (maint.)", "block"],
	[3, 3, 1, "K. Davis", "rental"],
	[3, 5, 1.5, "Adv. Clinic", "class"],
	[3, 9, 2, "Glow Pickle", "league"],
];

const COLORS: Record<BookingType, [string, string]> = {
	rental: ["#E0E7FF", "#3730A3"],
	class: ["#D8EEDD", "#19593A"],
	league: ["#FFE2CC", "#8A3A0E"],
	open: ["#F2EFE7", "#3A382E"],
	lesson: ["#E0E7FF", "#3730A3"],
	available: ["#FAF8F3", "#6B6857"],
	block: ["#EAEAEA", "#444"],
};

export function CalendarMock() {
	const ROW = 38;
	const COLW = 64;
	const HEAD = 38;
	const LEFT = 96;
	const W = LEFT + HOURS.length * COLW;
	const H = HEAD + COURTS.length * ROW;

	return (
		<div className="p-[18px] pb-[22px] text-[var(--ink)]">
			<div className="mb-[14px] flex flex-wrap items-center justify-between gap-2">
				<div>
					<div className="font-mono text-[12px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Court calendar
					</div>
					<div className="mt-0.5 font-semibold text-[18px]">
						Saturday, May 16
					</div>
				</div>
				<div className="flex items-center gap-1.5 text-[12px] text-[var(--ink-3)]">
					<span className="kbd">⌘</span>
					<span className="kbd">K</span>
					<span className="ml-1.5">Quick book</span>
					<span className="mx-2 inline-block h-[18px] w-px bg-[var(--line)]" />
					<button
						type="button"
						className="rounded-full border border-[var(--line-2)] bg-transparent px-3 py-1 font-medium text-[13px]"
					>
						Day
					</button>
					<button
						type="button"
						className="rounded-full bg-[var(--ink)] px-3 py-1 font-medium text-[13px] text-[var(--paper)]"
					>
						Week
					</button>
					<button
						type="button"
						className="rounded-full border border-[var(--line-2)] bg-transparent px-3 py-1 font-medium text-[13px]"
					>
						Month
					</button>
				</div>
			</div>

			<div className="overflow-x-auto rounded-[12px] border border-[var(--line)] bg-[var(--paper)]">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					width="100%"
					height={H}
					style={{ minWidth: W }}
					role="img"
					aria-labelledby="calendar-mock-title"
				>
					<title id="calendar-mock-title">
						Court calendar preview — Saturday May 16
					</title>
					{HOURS.map((h, i) => (
						<g key={h}>
							<text
								x={LEFT + i * COLW + 6}
								y={20}
								fontSize="11"
								fill="var(--ink-3)"
								fontFamily="var(--font-mono)"
							>
								{h}
							</text>
							<line
								x1={LEFT + i * COLW}
								y1={HEAD}
								x2={LEFT + i * COLW}
								y2={H}
								stroke="var(--line)"
								strokeWidth="1"
							/>
						</g>
					))}
					<line x1={LEFT} y1={HEAD} x2={W} y2={HEAD} stroke="var(--line)" />

					{COURTS.map((c, i) => (
						<g key={c}>
							<text
								x={12}
								y={HEAD + i * ROW + ROW / 2 + 4}
								fontSize="12"
								fill="var(--ink-2)"
								fontWeight="500"
							>
								{c}
							</text>
							<line
								x1={0}
								y1={HEAD + (i + 1) * ROW}
								x2={W}
								y2={HEAD + (i + 1) * ROW}
								stroke="var(--line)"
							/>
						</g>
					))}

					{/* now indicator */}
					<line
						x1={LEFT + 4.2 * COLW}
						y1={HEAD}
						x2={LEFT + 4.2 * COLW}
						y2={H}
						stroke="rgb(79 70 229)"
						strokeWidth="1.5"
						strokeDasharray="3 3"
					/>
					<circle
						cx={LEFT + 4.2 * COLW}
						cy={HEAD}
						r={3}
						fill="rgb(79 70 229)"
					/>

					{BOOKINGS.map(([court, sh, dur, label, type]) => {
						const [bg, fg] = COLORS[type];
						const x = LEFT + sh * COLW + 2;
						const y = HEAD + court * ROW + 3;
						const w = dur * COLW - 4;
						const h = ROW - 6;
						const isAvailable = type === "available";
						return (
							<g key={`${court}-${sh}-${label}`}>
								<rect
									x={x}
									y={y}
									width={w}
									height={h}
									rx="6"
									fill={bg}
									stroke={isAvailable ? "var(--line-2)" : "transparent"}
									strokeDasharray={isAvailable ? "3 3" : ""}
								/>
								<rect
									x={x}
									y={y}
									width="3"
									height={h}
									rx="1.5"
									fill={fg}
									opacity={isAvailable ? 0 : 0.6}
								/>
								<text
									x={x + 9}
									y={y + 16}
									fontSize="11"
									fill={fg}
									fontWeight="600"
								>
									{label}
								</text>
							</g>
						);
					})}
				</svg>
			</div>

			<div className="mt-3 flex flex-wrap gap-4 text-[12px] text-[var(--ink-3)]">
				{(
					[
						["Rental", "#E0E7FF"],
						["Class", "#D8EEDD"],
						["League", "#FFE2CC"],
						["Lesson", "#E0E7FF"],
						["Open play", "#F2EFE7"],
						["Block", "#EAEAEA"],
					] as const
				).map(([n, c]) => (
					<span key={n} className="inline-flex items-center gap-1.5">
						<span
							className="inline-block h-2.5 w-2.5 rounded-[3px] border border-[var(--line)]"
							style={{ background: c }}
						/>
						{n}
					</span>
				))}
			</div>
		</div>
	);
}

export default CalendarMock;
