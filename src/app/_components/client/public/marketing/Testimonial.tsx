const STATS: Array<[string, string]> = [
	["+34%", "court utilization in 60 days"],
	["−52%", "front-desk hours per week"],
	["3.2s", "average member check-in time"],
	["$18k", "package revenue captured per month"],
];

export function Testimonial() {
	return (
		<section className="py-20 md:py-[120px]">
			<div className="container mx-auto grid grid-cols-1 items-center gap-12 px-4 lg:grid-cols-[1.3fr_1fr] lg:gap-16">
				<figure className="m-0">
					<div className="mb-3.5 font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
						{"// Placeholder testimonial"}
					</div>
					<blockquote
						className="m-0 text-[var(--ink)] leading-[1.15] tracking-[-0.02em]"
						style={{ fontSize: "clamp(26px, 3vw, 40px)" }}
					>
						“We replaced four tools and a shared Google Sheet. The kiosk paid
						for itself in the first month — front desk hours dropped by half.”
					</blockquote>
					<figcaption className="mt-6 flex items-center gap-3">
						<span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ink)] font-mono font-semibold text-[var(--paper)]">
							JR
						</span>
						<div>
							<div className="font-semibold">Jordan Reyes</div>
							<div className="text-[14px] text-[var(--ink-3)]">
								GM, Bayside Padel · 6 courts, 1,400 members
							</div>
						</div>
					</figcaption>
				</figure>

				<div className="grid grid-cols-2 gap-3.5">
					{STATS.map(([v, l]) => (
						<div
							key={l}
							className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-5"
						>
							<div className="font-semibold text-[36px] leading-none tracking-[-0.03em]">
								{v}
							</div>
							<div className="mt-1.5 text-[13.5px] text-[var(--ink-2)]">
								{l}
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

export default Testimonial;
