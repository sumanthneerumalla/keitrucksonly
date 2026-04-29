"use client";

import React from "react";

const FEED: Array<
	[string, string, string, "credit" | "league" | "lesson" | "guest"]
> = [
	["Maya Chen", "Court 1", "Just now", "credit"],
	["Rohit Patel", "Court 2", "2m ago", "credit"],
	["League: Saturday A", "Court 3", "8m ago", "league"],
	["Coach Sam (lesson)", "Court 2", "12m ago", "lesson"],
	["Walk-in (paid $14)", "Open play", "18m ago", "guest"],
];

const KIND_COLORS = {
	credit: ["var(--brand-50)", "var(--brand-ink)"],
	league: ["#FFE2CC", "#8A3A0E"],
	lesson: ["#D8EEDD", "#19593A"],
	guest: ["var(--paper-2)", "var(--ink-2)"],
} as const;

const QR_PIXELS = Array.from({ length: 64 }, (_, i) => ({
	id: `qr-px-${i}`,
	filled:
		(i * 31 + 7) % 100 > 45 ||
		i < 3 ||
		(i % 8 < 3 && i < 24) ||
		(i % 8 > 4 && i < 24),
}));

export function CheckInMock() {
	return (
		<div className="p-[22px] text-[var(--ink)]">
			<div className="grid gap-[18px] sm:grid-cols-2">
				{/* Member kiosk */}
				<div className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-[18px]">
					<div className="flex items-center justify-between">
						<div className="font-mono text-[12px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
							Member kiosk
						</div>
						<span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--good)]">
							<span className="inline-block h-2 w-2 rounded-full bg-[var(--good)]" />
							Live
						</span>
					</div>
					<div className="mt-[18px] rounded-[12px] border border-[var(--line)] bg-white p-[18px]">
						<div className="flex items-center gap-[14px]">
							<div
								className="h-[88px] w-[88px] rounded-[12px] bg-[var(--ink)] p-2"
								style={{
									display: "grid",
									gridTemplate: "repeat(8, 1fr) / repeat(8, 1fr)",
									gap: 1,
								}}
							>
								{QR_PIXELS.map((px) => (
									<span
										key={px.id}
										style={{
											background: px.filled ? "white" : "transparent",
										}}
									/>
								))}
							</div>
							<div>
								<div className="text-[13px] text-[var(--ink-3)]">
									Welcome back
								</div>
								<div className="mt-0.5 font-semibold text-[22px]">
									Maya Chen
								</div>
								<div className="mt-2 text-[13px] text-[var(--ink-2)]">
									Booking: Court 1 · 9:00–10:30
								</div>
								<div className="mt-1.5 text-[13px]">
									Credits:{" "}
									<strong className="text-[var(--brand)]">8 of 12</strong>
								</div>
							</div>
						</div>
						<button
							type="button"
							className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-4 py-3 font-medium text-white shadow-sm transition-colors hover:bg-[var(--brand-ink)]"
						>
							Check in <span>→</span>
						</button>
					</div>
					<div className="mt-2.5 flex justify-center gap-3 text-[12px] text-[var(--ink-3)]">
						<span>QR scanner active</span>
						<span>·</span>
						<span>Avg 3.2s</span>
					</div>
				</div>

				{/* Live attendance feed */}
				<div className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-[18px]">
					<div className="flex items-baseline justify-between">
						<div>
							<div className="font-mono text-[12px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
								Who's on-site
							</div>
							<div className="mt-1 font-semibold text-[28px]">
								27{" "}
								<span className="font-medium text-[14px] text-[var(--ink-3)]">
									members on courts
								</span>
							</div>
						</div>
						<span className="text-[12px] text-[var(--good)]">
							↑ 12% vs. avg
						</span>
					</div>
					<div className="mt-3.5 flex flex-col gap-1.5">
						{FEED.map(([who, where, when, kind]) => {
							const [bg, fg] = KIND_COLORS[kind];
							return (
								<div
									key={`${who}-${where}`}
									className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2.5"
								>
									<div>
										<div className="font-medium text-[14px]">{who}</div>
										<div className="text-[12px] text-[var(--ink-3)]">
											{where}
										</div>
									</div>
									<span
										className="rounded-full px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em]"
										style={{ background: bg, color: fg }}
									>
										{kind}
									</span>
									<span className="text-[12px] text-[var(--ink-3)]">
										{when}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}

export default CheckInMock;
