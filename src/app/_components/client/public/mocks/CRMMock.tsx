"use client";

const MEMBERS: Array<[string, string, string, "Active" | "Lapsed"]> = [
	["Maya Chen", "10-pack · 8 left", "VIP", "Active"],
	["Rohit Patel", "Tennis Unlimited", "League", "Active"],
	["Lia Kim", "Drop-in", "—", "Lapsed"],
	["Theo Reyes", "Junior Academy", "Coach req.", "Active"],
	["Kara Davis", "Pickleball 10-pack", "—", "Active"],
];

export function CRMMock() {
	return (
		<div className="p-[22px]">
			<div className="flex items-center gap-2.5">
				<div className="flex flex-1 items-center gap-2 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2.5">
					<span className="kbd">⌘</span>
					<span className="kbd">K</span>
					<span className="text-[13px] text-[var(--ink-3)]">
						Search 1,284 members, bookings, payments…
					</span>
				</div>
				<button
					type="button"
					className="rounded-full bg-[var(--ink)] px-3.5 py-2 font-medium text-[14px] text-[var(--paper)]"
				>
					+ New member
				</button>
			</div>

			<div className="mt-3.5 overflow-hidden rounded-[12px] border border-[var(--line)] bg-white">
				<div className="grid grid-cols-[1.4fr_1.4fr_1fr_auto] bg-[var(--paper-2)] px-3.5 py-2.5 font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.06em]">
					<span>Member</span>
					<span>Plan</span>
					<span>Tags</span>
					<span>Status</span>
				</div>
				{MEMBERS.map((m) => {
					const initials = m[0]
						.split(" ")
						.map((w) => w[0])
						.join("");
					return (
						<div
							key={m[0]}
							className="grid grid-cols-[1.4fr_1.4fr_1fr_auto] items-center border-[var(--line)] border-t px-3.5 py-3"
						>
							<div className="flex items-center gap-2.5">
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink)] font-mono font-semibold text-[11px] text-[var(--paper)]">
									{initials}
								</span>
								<span className="font-medium">{m[0]}</span>
							</div>
							<span className="text-[13.5px] text-[var(--ink-2)]">{m[1]}</span>
							<span className="font-mono text-[11px] text-[var(--ink-3)]">
								{m[2]}
							</span>
							<span
								className="rounded-full px-2 py-0.5 font-mono text-[11px]"
								style={{
									background: m[3] === "Active" ? "#D8EEDD" : "var(--paper-2)",
									color: m[3] === "Active" ? "#19593A" : "var(--ink-3)",
								}}
							>
								{m[3]}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export default CRMMock;
