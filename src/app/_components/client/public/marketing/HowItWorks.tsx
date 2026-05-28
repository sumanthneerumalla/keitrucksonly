import { Clock } from "lucide-react";
import { SectionHead } from "~/app/_components/client/public/marketing/SectionHead";

const STEPS = [
	{
		n: "01",
		title: "We migrate your data",
		body: "Send us a member CSV, your booking exports, and your Stripe keys. We do the rest — no IT lift.",
		time: "≤ 5 days",
	},
	{
		n: "02",
		title: "Set up courts & pricing",
		body: "Hours, peak rates, member-only windows, packages. Templates for clubs that look like yours.",
		time: "≈ 30 min",
	},
	{
		n: "03",
		title: "Train your front desk",
		body: "Two 30-minute sessions. We send video walkthroughs your part-time staff actually watches.",
		time: "1 hour total",
	},
	{
		n: "04",
		title: "Go live, with us on call",
		body: "Soft launch the kiosk on a Saturday. We pair-shift with you for the first 72 hours.",
		time: "Day 7",
	},
];

export function HowItWorks() {
	return (
		<section
			id="how-it-works"
			className="bg-[var(--paper-2)] py-20 md:py-[120px]"
		>
			<div className="container mx-auto px-4">
				<SectionHead
					num="03 / Onboarding"
					title="From signed contract to first check-in in seven days."
					lead="A real timeline. The questions buyers actually ask: how long, who lifts, when does my data move."
				/>

				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
					{STEPS.map((s) => (
						<div key={s.n} className="border-[var(--ink)] border-t pt-7">
							<span className="font-mono text-[12px] text-[var(--ink-3)] uppercase tracking-[0.12em]">
								{s.n}
							</span>
							<h3 className="mt-3 mb-2">{s.title}</h3>
							<p className="text-[15px] text-[var(--ink-2)]">{s.body}</p>
							<span className="mt-3.5 inline-flex items-center gap-1 rounded-full bg-[var(--brand-50)] px-2.5 py-1 font-mono text-[11px] text-[var(--brand-ink)] tracking-[0.06em]">
								<Clock size={11} />
								{s.time}
							</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

export default HowItWorks;
