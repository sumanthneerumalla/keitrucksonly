import { CreditCard, LayoutGrid, ShieldCheck, Sparkles } from "lucide-react";

const ITEMS = [
	{
		icon: Sparkles,
		title: "Replace 4 tools with 1",
		body: "Calendar, CRM, packages, POS, comms, reports — one login.",
	},
	{
		icon: CreditCard,
		title: "No per-transaction fees",
		body: "We don't take a cut of bookings. Stripe's standard rates pass through.",
	},
	{
		icon: LayoutGrid,
		title: "Built for racquet sports",
		body: "Open play, leagues, ladders, court hierarchies — designed-in, not bolted-on.",
	},
	{
		icon: ShieldCheck,
		title: "Free white-glove migration",
		body: "We move your members, packages, and bookings. You verify; we ship it.",
	},
];

export function Differentiators() {
	return (
		<section className="bg-[var(--ink)] py-16 text-[var(--paper)]">
			<div className="container mx-auto px-4">
				<div className="mb-8 grid items-baseline gap-5 md:grid-cols-[auto_1fr]">
					<span className="inline-block min-w-[64px] border-[var(--paper)] border-t pt-2 font-mono text-[12px] text-white/55 uppercase tracking-[0.14em]">
						04 / Why us
					</span>
					<h2 style={{ color: "var(--paper)" }}>
						Four reasons we keep winning the renewal.
					</h2>
				</div>
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
					{ITEMS.map((d) => {
						const Icon = d.icon;
						return (
							<div
								key={d.title}
								className="border-white/[0.18] border-t pt-[18px]"
							>
								<Icon size={24} className="mb-3 text-[var(--brand-200)]" />
								<h3 style={{ color: "var(--paper)" }}>{d.title}</h3>
								<p className="mt-1.5 text-[15px] text-white/70">{d.body}</p>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}

export default Differentiators;
