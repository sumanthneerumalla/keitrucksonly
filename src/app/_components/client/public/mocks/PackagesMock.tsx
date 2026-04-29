"use client";

const PACKS: Array<[string, string, string, number, string, string]> = [
	[
		"Pickleball 10-pack",
		"$180",
		"Expires 90d",
		142,
		"var(--brand-50)",
		"var(--brand-ink)",
	],
	["Tennis Unlimited", "$220/mo", "Auto-renew", 86, "#D8EEDD", "#19593A"],
	["Padel Drop-in", "$24", "Single-use", 41, "#FFE2CC", "#8A3A0E"],
	["Junior Academy", "$320", "Term", 28, "var(--paper-2)", "var(--ink-2)"],
];

const FIFO: Array<[string, string, string]> = [
	["Apr 18", "−1", "Court 1"],
	["Apr 14", "−1", "Court 2"],
	["Apr 09", "−1", "Open play"],
];

export function PackagesMock() {
	return (
		<div className="p-[22px]">
			<div className="grid gap-[18px] md:grid-cols-[1.1fr_1fr]">
				<div>
					<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Active packages
					</div>
					<div className="mt-3 flex flex-col gap-2">
						{PACKS.map(([name, price, exp, sold, bg, fg]) => (
							<div
								key={name}
								className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-[12px] border border-[var(--line)] bg-white px-3.5 py-3"
							>
								<span
									className="inline-flex h-9 w-9 items-center justify-center rounded-lg font-bold font-mono"
									style={{ background: bg, color: fg }}
								>
									{name[0]}
								</span>
								<div>
									<div className="font-semibold text-[14px]">{name}</div>
									<div className="text-[12px] text-[var(--ink-3)]">{exp}</div>
								</div>
								<div className="font-semibold text-[16px]">{price}</div>
								<div className="text-right text-[12px] text-[var(--ink-3)]">
									{sold} sold
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="rounded-[12px] border border-[var(--line)] bg-white p-4">
					<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Maya's wallet
					</div>
					<div className="mt-1.5 font-semibold text-[22px]">
						8 of 12 credits
					</div>
					<div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--paper-2)]">
						<div
							className="h-full bg-[var(--brand)]"
							style={{ width: "66%" }}
						/>
					</div>
					<div className="mt-2 text-[12px] text-[var(--ink-3)]">
						Oldest credit expires{" "}
						<strong className="text-[var(--warn)]">in 6 days</strong>
					</div>

					<div className="mt-4 border-[var(--line)] border-t p-3">
						<div className="mb-1.5 text-[12px] text-[var(--ink-3)]">
							FIFO usage log
						</div>
						{FIFO.map(([d, c, w], i) => (
							<div
								key={`${d}-${w}`}
								className={`flex justify-between py-1.5 text-[13px] ${i < FIFO.length - 1 ? "border-[var(--line)] border-b border-dashed" : ""}`}
							>
								<span className="font-mono text-[var(--ink-3)]">{d}</span>
								<span className="text-[var(--ink-2)]">{w}</span>
								<span className="font-semibold">{c}</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export default PackagesMock;
