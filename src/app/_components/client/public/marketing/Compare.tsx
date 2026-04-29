import { SectionHead } from "~/app/_components/client/public/marketing/SectionHead";

type Cell = boolean | string;

const ROWS: Array<[string, Cell, Cell, Cell]> = [
	["Built for racquet sports (courts, leagues, ladders)", true, false, false],
	["Self-serve QR check-in (kiosk-ready)", true, false, false],
	["Booking fees on top of payment processing", "none", "common", "n/a"],
	["Free data migration", true, false, "do it yourself"],
	["Modern API + webhooks", true, "limited", false],
	["Setup time", "≤ 1 week", "4–8 weeks", "ongoing"],
];

function cell(v: Cell) {
	if (v === true)
		return <span className="font-mono text-[var(--good)]">● Yes</span>;
	if (v === false)
		return <span className="font-mono text-[var(--ink-4)]">○ No</span>;
	return <span className="font-mono text-[13px] text-[var(--ink-2)]">{v}</span>;
}

export function Compare() {
	return (
		<section className="py-20 md:py-[120px]">
			<div className="container mx-auto px-4">
				<SectionHead
					num="05 / Compare"
					title="Honestly, here's how we stack up."
					lead="We're built for racquet clubs. If your operation is courts, leagues, lessons, and packages — this is the shortlist."
				/>

				<div className="overflow-x-auto rounded-2xl border border-[var(--line)]">
					<table className="w-full min-w-[720px] border-collapse text-[14px]">
						<thead>
							<tr className="bg-[var(--paper-2)]">
								<th className="px-5 py-4 text-left font-medium font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
									Capability
								</th>
								<th className="px-5 py-4 text-left font-semibold text-[16px] text-[var(--brand)]">
									Facility Presence
								</th>
								<th className="px-5 py-4 text-left text-[15px] text-[var(--ink-3)]">
									Generic studio SaaS
								</th>
								<th className="px-5 py-4 text-left text-[15px] text-[var(--ink-3)]">
									Spreadsheets &amp; clipboards
								</th>
							</tr>
						</thead>
						<tbody>
							{ROWS.map((r, i) => (
								<tr
									key={r[0]}
									className="border-[var(--line)] border-t"
									style={{ background: i % 2 ? "var(--paper)" : "transparent" }}
								>
									<td className="px-5 py-4 font-medium">{r[0]}</td>
									<td className="px-5 py-4">{cell(r[1])}</td>
									<td className="px-5 py-4">{cell(r[2])}</td>
									<td className="px-5 py-4">{cell(r[3])}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}

export default Compare;
