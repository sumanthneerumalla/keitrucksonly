"use client";

const SLOTS: Array<[string, string, string, boolean]> = [
	["6:00a", "Off-peak", "$18/hr", false],
	["9:00a", "Peak", "$32/hr", true],
	["12:00p", "Midday", "$24/hr", false],
	["6:00p", "Prime", "$38/hr", true],
	["8:00p", "Member-only", "Members", false],
];

const OPEN_PLAY_SPOTS = Array.from({ length: 16 }, (_, i) => ({
	id: `spot-${i}`,
	filled: i < 14,
	opacity: i < 14 ? 0.85 - i * 0.03 : 1,
}));

export function RentalsMock() {
	return (
		<div className="p-[22px]">
			<div className="grid gap-[18px] md:grid-cols-2">
				<div>
					<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Pricing rules — Pickleball
					</div>
					<div className="mt-3 overflow-hidden rounded-[12px] border border-[var(--line)] bg-white">
						{SLOTS.map(([t, label, price, hot], i) => (
							<div
								key={t}
								className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-3.5 px-3.5 py-3 ${i ? "border-[var(--line)] border-t" : ""}`}
							>
								<span className="w-[50px] font-mono text-[13px] text-[var(--ink-2)]">
									{t}
								</span>
								<span className="font-medium">{label}</span>
								{hot ? (
									<span className="rounded-full bg-[var(--brand-50)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--brand-ink)] uppercase tracking-[0.04em]">
										Peak
									</span>
								) : (
									<span />
								)}
								<span className="font-semibold">{price}</span>
							</div>
						))}
					</div>
				</div>

				<div className="rounded-[12px] border border-[var(--line)] bg-white p-4">
					<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Open play — Saturday 6pm
					</div>
					<div className="mt-1.5 font-semibold text-[22px]">14 / 16 spots</div>
					<div
						className="mt-3.5 grid gap-1.5"
						style={{ gridTemplateColumns: "repeat(8, 1fr)" }}
					>
						{OPEN_PLAY_SPOTS.map((spot) => (
							<span
								key={spot.id}
								className={
									spot.filled
										? ""
										: "border border-[var(--line-2)] border-dashed"
								}
								style={{
									aspectRatio: "1",
									borderRadius: 6,
									background: spot.filled ? "var(--brand)" : "var(--paper-2)",
									opacity: spot.opacity,
								}}
							/>
						))}
					</div>
					<div className="mt-3.5 text-[13px] text-[var(--ink-3)]">
						Waitlist: <strong className="text-[var(--ink)]">3 members</strong> —
						auto-promoted on cancel.
					</div>
					<button
						type="button"
						className="mt-3.5 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-3.5 py-1.5 font-medium text-[14px] text-white"
					>
						Join waitlist
					</button>
				</div>
			</div>
		</div>
	);
}

export default RentalsMock;
