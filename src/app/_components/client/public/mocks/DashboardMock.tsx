"use client";

import React from "react";

const SERIES = [22, 28, 25, 32, 30, 38, 36, 42, 45, 48, 44, 52, 58, 56, 62];

const STATS: Array<[string, string, string]> = [
	["Revenue", "$18,420", "+14%"],
	["Court hours", "412", "+6%"],
	["Active members", "1,284", "+22"],
];

const WORKLIST: Array<[string, string, string, boolean]> = [
	["⚠︎", "3 expired packages — auto-renew?", "Revenue", true],
	["✦", "Glow Pickle league: 2 spots open", "Programs", false],
	["✉", "Court 4 maintenance @ 11pm", "Ops", false],
	["$", "Stripe payout $4,210 cleared", "Finance", false],
	["✓", "47 check-ins so far today", "", false],
];

export function DashboardMock() {
	const W = 280;
	const H = 80;
	const max = Math.max(...SERIES);
	const min = Math.min(...SERIES);
	const path = SERIES.map((v, i) => {
		const x = (i / (SERIES.length - 1)) * W;
		const y = H - ((v - min) / (max - min)) * (H - 8) - 4;
		return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
	}).join(" ");
	const area = `${path} L${W} ${H} L0 ${H} Z`;

	return (
		<div className="p-[22px] text-[var(--ink)]">
			<div className="grid gap-[18px] lg:grid-cols-[1.2fr_1fr]">
				<div>
					<div className="font-mono text-[12px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						This week
					</div>
					{/*
					 * Container query on the stats grid so the value font scales
					 * with the grid's actual width — not the viewport. The
					 * dashboard sits inside a narrow nested column at 1024–1280px
					 * viewports, where a fixed 22px font runs longer values like
					 * "$18,420" past the box edge. clamp(15px, 7cqi, 22px) keeps
					 * the value readable down to a ~85px stat box without
					 * clipping, and caps at 22px once there's room.
					 */}
					<div className="@container mt-3 grid grid-cols-3 gap-3">
						{STATS.map(([l, v, d]) => (
							<div
								key={l}
								className="min-w-0 rounded-[12px] border border-[var(--line)] bg-white @[260px]:p-3.5 p-2.5"
							>
								<div className="@[260px]:text-[12px] text-[11px] text-[var(--ink-3)]">
									{l}
								</div>
								<div className="mt-1 truncate font-semibold text-[clamp(15px,7cqi,22px)] tracking-[-0.02em]">
									{v}
								</div>
								<div className="mt-1 @[260px]:text-[12px] text-[11px] text-[var(--good)]">
									{d}
								</div>
							</div>
						))}
					</div>

					<div className="mt-3 rounded-[12px] border border-[var(--line)] bg-white p-4">
						<div className="flex items-baseline justify-between">
							<div>
								<div className="font-semibold text-[13px]">
									Bookings per day
								</div>
								<div className="text-[12px] text-[var(--ink-3)]">
									Last 14 days · all courts
								</div>
							</div>
							<div className="text-[12px] text-[var(--ink-3)]">
								Avg <strong className="text-[var(--ink)]">40</strong> / day
							</div>
						</div>
						<svg
							viewBox={`0 0 ${W} ${H}`}
							width="100%"
							height={H}
							className="mt-2.5"
							role="img"
							aria-labelledby="bookings-spark-title"
						>
							<title id="bookings-spark-title">
								Bookings per day, last 14 days, all courts
							</title>
							<defs>
								<linearGradient id="spark-grad" x1="0" x2="0" y1="0" y2="1">
									<stop
										offset="0%"
										stopColor="rgb(79 70 229)"
										stopOpacity="0.25"
									/>
									<stop
										offset="100%"
										stopColor="rgb(79 70 229)"
										stopOpacity="0"
									/>
								</linearGradient>
							</defs>
							<path d={area} fill="url(#spark-grad)" />
							<path
								d={path}
								fill="none"
								stroke="rgb(79 70 229)"
								strokeWidth="1.8"
							/>
						</svg>
					</div>
				</div>

				<div className="rounded-[12px] border border-[var(--line)] bg-white p-4">
					<div className="font-semibold text-[13px]">Today's worklist</div>
					<div className="text-[12px] text-[var(--ink-3)]">
						Auto-prioritized
					</div>
					<div className="mt-3 flex flex-col gap-2">
						{WORKLIST.map(([sym, txt, tag, hot]) => (
							<div
								key={txt}
								className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[10px] border border-[var(--line)] px-3 py-2.5"
								style={{ background: hot ? "var(--brand-50)" : "var(--paper)" }}
							>
								<span
									className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-[12px] text-white"
									style={{ background: hot ? "var(--brand)" : "var(--ink)" }}
								>
									{sym}
								</span>
								<span className="text-[13.5px]">{txt}</span>
								{tag ? (
									<span className="font-mono text-[10.5px] text-[var(--ink-3)] uppercase tracking-[0.06em]">
										{tag}
									</span>
								) : (
									<span />
								)}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export default DashboardMock;
