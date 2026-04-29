"use client";

const ITEMS: Array<[string, string, number]> = [
	["Selkirk Vanguard Paddle", "$169.00", 1],
	["Drop-in court fee", "$14.00", 1],
	["Lemon-lime Gatorade", "$3.50", 2],
];

const INVENTORY: Array<[string, string, "good" | "warn" | "bad"]> = [
	["Selkirk Vanguard", "Stock 8", "good"],
	["Wilson Kaos restring", "Stock 4", "warn"],
	["Gatorade lemon-lime", "Stock 32", "good"],
	["Babolat overgrip", "Stock 2", "bad"],
];

export function POSMock() {
	const subtotal = 190.0;
	return (
		<div className="p-[22px]">
			<div className="grid gap-[18px] md:grid-cols-[1.4fr_1fr]">
				<div className="rounded-[12px] border border-[var(--line)] bg-white p-4">
					<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Cart · Maya Chen
					</div>
					<div className="mt-2.5">
						{ITEMS.map(([n, p, q], i) => (
							<div
								key={n}
								className={`grid grid-cols-[1fr_auto_auto] gap-3.5 py-3 ${i ? "border-[var(--line)] border-t" : ""}`}
							>
								<span className="font-medium">{n}</span>
								<span className="font-mono text-[var(--ink-3)]">×{q}</span>
								<span className="font-semibold">{p}</span>
							</div>
						))}
					</div>
					<div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2.5 border-[var(--ink)] border-t-2 pt-2.5">
						<span className="text-[var(--ink-3)]">Subtotal</span>
						<span className="font-semibold">${subtotal.toFixed(2)}</span>
						<span className="text-[var(--ink-3)]">House account</span>
						<span className="font-semibold text-[var(--brand)]">−$3.50</span>
						<span className="font-semibold text-[22px]">Total</span>
						<span className="font-semibold text-[22px]">
							${(subtotal - 3.5).toFixed(2)}
						</span>
					</div>
					<div className="mt-3.5 flex gap-2">
						<button
							type="button"
							className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-4 py-2.5 font-medium text-white"
						>
							Tap to pay <span>→</span>
						</button>
						<button
							type="button"
							className="rounded-full border border-[var(--line-2)] bg-transparent px-4 py-2.5 font-medium"
						>
							Add to tab
						</button>
					</div>
				</div>

				<div className="rounded-[12px] border border-[var(--line)] bg-white p-4">
					<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.08em]">
						Inventory alerts
					</div>
					{INVENTORY.map(([n, s, k], i) => (
						<div
							key={n}
							className={`grid grid-cols-[1fr_auto] py-2.5 ${i ? "border-[var(--line)] border-t" : ""}`}
						>
							<span className="text-[13.5px]">{n}</span>
							<span
								className="font-mono text-[12px]"
								style={{
									color:
										k === "good"
											? "var(--good)"
											: k === "warn"
												? "var(--warn)"
												: "#B83A3A",
								}}
							>
								{s}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export default POSMock;
