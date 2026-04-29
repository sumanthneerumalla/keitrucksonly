"use client";

const FLOWS: Array<[string, string, number]> = [
	["Booking confirmation", "Triggered: court booked", 1284],
	["24-hr reminder", "Triggered: 24h before", 986],
	["No-show fee notice", "Triggered: 15min after", 34],
	["Win-back: 30 days", "Audience: lapsed members", 142],
];

export function CommsMock() {
	return (
		<div className="p-[22px]">
			<div className="grid gap-[18px] md:grid-cols-2">
				<div>
					<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Active automations
					</div>
					<div className="mt-2.5 overflow-hidden rounded-[12px] border border-[var(--line)] bg-white">
						{FLOWS.map(([n, t, c], i) => (
							<div
								key={n}
								className={`grid grid-cols-[1fr_auto] items-center px-3.5 py-3 ${i ? "border-[var(--line)] border-t" : ""}`}
							>
								<div>
									<div className="font-medium">{n}</div>
									<div className="text-[12px] text-[var(--ink-3)]">{t}</div>
								</div>
								<div className="text-right">
									<div className="font-semibold">{c.toLocaleString()}</div>
									<div className="text-[11px] text-[var(--ink-3)]">
										sent / 30d
									</div>
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="rounded-[12px] border border-[var(--line)] bg-white p-4 text-[14px]">
					<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Preview · 24-hr reminder
					</div>
					<div className="mt-2.5 rounded-lg bg-[var(--paper-2)] p-3.5 text-[13px] text-[var(--ink-3)]">
						From: courts@yourclub.com
					</div>
					<div className="mt-2.5 font-semibold text-[19px]">
						Maya, see you tomorrow at 9am
					</div>
					<p className="mt-2 text-[var(--ink-2)]">
						Court 1 · 9:00–10:30. Bring water and a towel — and your QR for
						check-in.
					</p>
					<button
						type="button"
						className="mt-2 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-3.5 py-1.5 font-medium text-[14px] text-white"
					>
						View QR pass
					</button>
				</div>
			</div>
		</div>
	);
}

export default CommsMock;
