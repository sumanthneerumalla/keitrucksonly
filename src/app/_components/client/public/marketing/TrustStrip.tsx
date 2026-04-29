const LOGOS = [
	{ name: "Bayside Padel", mark: "BP" },
	{ name: "Crosstown Racquet", mark: "CR" },
	{ name: "Topspin Club", mark: "TS" },
	{ name: "Northgate Tennis", mark: "NT" },
	{ name: "Pickle & Co.", mark: "P&" },
];

export function TrustStrip() {
	return (
		<section className="border-[var(--line)] border-y">
			<div className="container mx-auto grid items-center gap-4 px-4 py-5 md:grid-cols-[auto_1fr_auto] md:gap-8">
				<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
					Trusted by{" "}
					<strong className="font-mono text-[var(--ink)]">240+</strong> clubs
				</div>
				<div className="flex flex-wrap items-center gap-x-9 gap-y-3 text-[var(--ink-3)]">
					{LOGOS.map((l) => (
						<span
							key={l.name}
							className="inline-flex items-center gap-2 font-semibold text-[16px] tracking-[-0.01em] opacity-70"
							title="Placeholder customer logo"
						>
							<span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[var(--ink)]/[0.14] font-bold font-mono text-[11px] text-[var(--ink)]">
								{l.mark}
							</span>
							{l.name}
						</span>
					))}
				</div>
				<span className="font-mono text-[10.5px] text-[var(--ink-4)] uppercase tracking-[0.08em]">
					{"// Placeholder logos"}
				</span>
			</div>
		</section>
	);
}

export default TrustStrip;
