import { CheckCircle, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import React from "react";
import { CTASection } from "~/app/_components/client/public/marketing/CTASection";
import { FAQ } from "~/app/_components/client/public/marketing/FAQ";
import { SectionHead } from "~/app/_components/client/public/marketing/SectionHead";
import { CALENDLY_URL } from "~/lib/marketing";
import { type Plan, PlansSection } from "./PlansClient";

export const metadata: Metadata = {
	title: "Pricing | Facility Presence",
	// Pricing hidden — previous description cited Free up to 100 members and $300/mo ($250/mo annual) for 3 locations.
	description:
		"Honest pricing for racquet clubs. No per-transaction fees. Let's talk about the plan that fits your facility.",
};

// Yearly pricing is "2 months free" — pay 10 months when billing annually.
// Growth: $300/mo monthly  →  $250/mo billed annually  ($3,000/yr)
const PLANS: Plan[] = [
	{
		id: "free",
		name: "Free",
		forWho: "Solo operators",
		// Pricing hidden — quote-driven; the "Let's talk" button is the only CTA.
		// pricing: { monthly: 0, yearly: 0 },
		pricing: null,
		anchor: "100 members, 1 location",
		cta: "Let's talk",
		popular: false,
		includes: [
			"Court calendar",
			"Self-serve QR check-in",
			"Member CRM (100 members)",
			"Packages & credits",
			"Stripe-powered POS",
			"Email receipts",
			"Basic reports",
			"Community support",
		],
	},
	{
		id: "growth",
		name: "Growth",
		forWho: "Independent clubs running leagues, lessons, retail",
		// Pricing hidden — quote-driven; the "Let's talk" button is the only CTA.
		// pricing: { monthly: 300, yearly: 250 },
		pricing: null,
		anchor: "3 locations, unlimited members",
		cta: "Let's talk",
		popular: true,
		includes: [
			"Everything in Free",
			"Up to 3 locations",
			"Leagues & ladders",
			"Open play + waitlists",
			"Branded email + SMS automations",
			"Inventory & house accounts",
			"Cohort & utilization reports",
			"Free white-glove migration",
			"Priority support (4-hr response)",
		],
	},
	{
		id: "scale",
		name: "Custom",
		forWho: "4+ locations, enterprise",
		pricing: null,
		anchor: "Unlimited locations, SSO, dedicated CSM",
		cta: "Let's talk",
		popular: false,
		includes: [
			"Everything in Growth",
			"Unlimited locations",
			"Multi-location dashboards & roles",
			"SSO (SAML)",
			"Custom roles & permissions",
			"API + webhooks",
			"SOC 2 reports under NDA",
			"Dedicated CSM",
			"Phone support (1-hr response)",
		],
	},
];

type Cell = boolean | string;

const ROW_GROUPS: Array<{
	group: string;
	rows: Array<[string, Cell, Cell, Cell]>;
}> = [
	{
		group: "Operations",
		rows: [
			["Locations", "1", "Up to 3", "Unlimited"],
			["Active members", "100", "Unlimited", "Unlimited"],
			["Court calendar (day/week/month)", true, true, true],
			["Self-serve QR check-in", true, true, true],
			["Recurring bookings & blocks", true, true, true],
			["Member-only windows", false, true, true],
		],
	},
	{
		group: "Programs & Revenue",
		rows: [
			["Packages, credits, memberships", true, true, true],
			["FIFO credit usage", true, true, true],
			["Court rentals + peak pricing", true, true, true],
			["Open play with capacity caps", false, true, true],
			["Leagues & ladders", false, true, true],
			["Family & corporate accounts", false, true, true],
		],
	},
	{
		group: "Member experience",
		rows: [
			["Member iOS + Android app", true, true, true],
			["Branded sender domain", false, true, true],
			["Triggered email automations", "3 flows", "Unlimited", "Unlimited"],
			["SMS notifications", "Add-on", true, true],
		],
	},
	{
		group: "Reporting & data",
		rows: [
			["Standard reports", true, true, true],
			["Cohort churn & utilization", false, true, true],
			["Scheduled email exports", false, true, true],
			["API access & webhooks", false, "Limited", "Full"],
			["Data warehouse sync (BigQuery, Snowflake)", false, false, true],
		],
	},
	{
		group: "Security & support",
		rows: [
			["PCI DSS via Stripe", true, true, true],
			["SOC 2 Type II", true, true, true],
			["Single sign-on (SAML)", false, false, true],
			["Custom roles & permissions", false, false, true],
			["Support response", "Community", "4 hours", "1 hour + phone"],
			["Dedicated CSM", false, false, true],
		],
	},
];

const PRICING_FAQS: Array<[string, string]> = [
	[
		"Do you charge per transaction?",
		"No. Your subscription is the only number you'll see from us. Stripe's standard processing rates pass through unchanged — we don't add a markup or take a slice.",
	],
	[
		"What if I outgrow my plan?",
		"We email you when you approach the limit on your plan (members on Free, locations on Growth). Upgrade is one click, prorated to the day. We never surprise-bill you for an overage.",
	],
	[
		"Is there a setup fee?",
		// Pricing hidden — previous answer cited a $499 one-time migration fee.
		"No setup fee. Migration is free on Growth and Custom. On Free, we provide a self-serve import tool, or a one-time assisted migration — let's talk.",
	],
	["What's the contract?", "Month-to-month. No lock-in, no termination fee."],
	[
		"Do you have nonprofit or municipal pricing?",
		// Pricing hidden — previous answer cited 25% off Growth.
		"Yes. Public parks, school programs, and 501(c)(3) clubs qualify for discounted pricing. Get in touch with your designation and let's talk.",
	],
	[
		"What counts as a 'location'?",
		"A physical facility with its own courts, staff schedule, and member roster. Two clubs across town are two locations. Two adjacent buildings sharing one front desk are one.",
	],
];

function PageHero() {
	return (
		<section className="pt-8 pb-8 md:pt-12">
			<div className="container mx-auto px-4 text-center">
				<div className="eyebrow">
					<span className="eyebrow-dot">●</span>
					&nbsp;&nbsp;PRICING
				</div>
				<h1 className="mx-auto mt-3.5 max-w-[880px]">
					Honest pricing.
					<br />
					<span className="accent">No per-transaction fees.</span>
				</h1>
				<p className="lead mx-auto mt-5 max-w-[640px]">
					One subscription, no booking surcharges, no Stripe markup. The price
					you see is the price you pay — including free data migration on Growth
					and Custom.
				</p>
			</div>
		</section>
	);
}

/* Pricing hidden — ROI dollar comparison disabled.
function ROIComparison() {
	const stack: Array<[string, number]> = [
		["Booking software", 99],
		["POS (Square Plus)", 60],
		["Email tool (Mailchimp Standard)", 35],
		["Spreadsheets, Calendly, etc.", 15],
		["Front-desk hours saved (10 hr/wk × $20)", 800],
	];
	const total = stack.reduce((a, [, v]) => a + v, 0);
	// Compare ROI against Growth's monthly price (conservative — most clubs start
	// monthly). Falls back to 0 if Growth is removed; the layout still renders.
	const fp = PLANS.find((p) => p.id === "growth")?.pricing?.monthly ?? 0;

	return (
		<section className="bg-[var(--paper-2)] py-20 md:py-[120px]">
			<div className="container mx-auto px-4">
				<SectionHead
					num="02 / ROI"
					title="Most clubs save more than they spend."
					lead="A typical 3-location Growth club, doing the math."
				/>

				<div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.2fr_auto_1fr]">
					<div className="rounded-[18px] border border-[var(--line)] bg-[var(--paper)] p-6">
						<div className="font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.1em]">
							Your current stack
						</div>
						{stack.map(([n, v], i) => (
							<div
								key={n}
								className={`grid grid-cols-[1fr_auto] py-3 ${i ? "border-[var(--line)] border-t" : ""}`}
							>
								<span>{n}</span>
								<span className="font-semibold">${v}/mo</span>
							</div>
						))}
						<div className="mt-1.5 grid grid-cols-[1fr_auto] gap-2.5 border-[var(--ink)] border-t-2 pt-3">
							<span className="font-semibold">Effective monthly cost</span>
							<span className="font-semibold text-[22px]">
								${total.toLocaleString()}/mo
							</span>
						</div>
					</div>

					<div className="flex flex-row items-center justify-center gap-2.5 font-mono text-[12px] text-[var(--ink-3)] uppercase tracking-[0.06em] lg:flex-col">
						<span className="lg:hidden">↓</span>
						<span className="hidden lg:inline">→</span>
						<span>Replace with</span>
						<span className="lg:hidden">↓</span>
						<span className="hidden lg:inline">↓</span>
					</div>

					<div className="rounded-[18px] border border-[var(--ink)] bg-[var(--ink)] p-6 text-[var(--paper)]">
						<div className="font-mono text-[11px] text-white/55 uppercase tracking-[0.1em]">
							Facility Presence Growth
						</div>
						<div className="mt-3.5 leading-none">
							<span className="font-semibold text-[60px] tracking-[-0.03em]">
								${fp}
							</span>
							<span className="ml-1.5 text-[16px] text-white/60">/mo</span>
						</div>
						<div
							className="mt-[18px] rounded-[12px] border border-white/[0.08] p-3.5"
							style={{ background: "rgba(79,70,229,0.18)" }}
						>
							<div className="text-[13px] text-white/70">
								Net monthly savings
							</div>
							<div className="font-semibold text-[36px] text-[var(--brand-200)] tracking-[-0.02em]">
								${(total - fp).toLocaleString()}
							</div>
						</div>
						<div className="mt-3.5 text-[12px] text-white/55">
							Plus: one login, one bill, one number to call.
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
*/

function ComparisonTable() {
	const cell = (v: Cell, popular: boolean) => {
		if (v === true)
			return (
				<CheckCircle
					size={18}
					style={{
						color: popular ? "var(--brand)" : "var(--good)",
					}}
				/>
			);
		if (v === false)
			return <span className="text-[18px] text-[var(--ink-4)]">—</span>;
		return <span className="text-[13.5px] text-[var(--ink-2)]">{v}</span>;
	};

	return (
		<section className="py-20 md:py-[120px]">
			<div className="container mx-auto px-4">
				<SectionHead
					num="02 / Compare"
					title="Compare every plan, line by line."
				/>
				<div className="overflow-x-auto rounded-2xl border border-[var(--line)]">
					<table className="w-full min-w-[760px] border-collapse">
						<thead>
							<tr className="bg-[var(--paper-2)]">
								<th
									className="px-5 py-4 text-left font-medium font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]"
									style={{ width: "40%" }}
								>
									What's included
								</th>
								{PLANS.map((p) => (
									<th
										key={p.id}
										className="px-5 py-4 text-left font-semibold text-[18px]"
										style={{ color: p.popular ? "var(--brand)" : "var(--ink)" }}
									>
										{p.name}
										{p.popular ? (
											<span className="ml-1.5 inline-block rounded-full bg-[var(--brand-50)] px-1.5 py-0.5 align-middle font-mono text-[10px] text-[var(--brand-ink)] uppercase tracking-[0.06em]">
												★
											</span>
										) : null}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{ROW_GROUPS.map((g) => (
								<React.Fragment key={g.group}>
									<tr>
										<td
											colSpan={4}
											className="border-[var(--line)] border-t bg-[var(--paper)] px-5 pt-4 pb-2 font-mono text-[11px] text-[var(--ink-3)] uppercase tracking-[0.12em]"
										>
											{g.group}
										</td>
									</tr>
									{g.rows.map((r) => (
										<tr key={r[0]} className="border-[var(--line)] border-t">
											<td className="px-5 py-3.5 font-medium text-[14.5px]">
												{r[0]}
											</td>
											{r.slice(1).map((v, j) => {
												const planId = PLANS[j]?.id ?? `col-${j}`;
												return (
													<td
														key={planId}
														className="px-5 py-3.5"
														style={{
															background: PLANS[j]?.popular
																? "rgba(79,70,229,0.04)"
																: "transparent",
														}}
													>
														{cell(v as Cell, PLANS[j]?.popular ?? false)}
													</td>
												);
											})}
										</tr>
									))}
								</React.Fragment>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}

function Guarantee() {
	return (
		<section className="py-20 md:py-[120px]">
			<div className="container mx-auto px-4">
				<div className="grid grid-cols-1 items-center gap-8 rounded-[22px] border border-[var(--line)] bg-[var(--paper)] p-10 lg:grid-cols-[auto_1fr_auto]">
					<div className="inline-flex h-24 w-24 items-center justify-center rounded-3xl bg-[var(--brand-50)] text-[var(--brand)]">
						<ShieldCheck size={44} />
					</div>
					<div>
						<div className="eyebrow mb-1.5">
							<span className="eyebrow-dot">●</span>
							&nbsp;&nbsp;Operator guarantee
						</div>
						<h3 style={{ fontSize: 26 }}>45 days. No card. No contract.</h3>
						<p className="mt-1.5 max-w-[600px] text-[var(--ink-2)]">
							If we can't beat your current stack on cost, time saved, or member
							experience in 45 days, we'll help you migrate to whatever's next —
							and refund anything you've paid us.
						</p>
					</div>
					<a
						href={CALENDLY_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="btn btn-primary btn-lg"
					>
						Let's talk <span className="arrow">→</span>
					</a>
				</div>
			</div>
		</section>
	);
}

export default function PricingPage() {
	return (
		<div className="marketing-page">
			<PageHero />
			<PlansSection plans={PLANS} />
			{/* Pricing hidden — ROI dollar comparison removed. */}
			{/* <ROIComparison /> */}
			<ComparisonTable />
			<Guarantee />
			<FAQ
				num="03 / FAQ"
				title="Pricing questions, answered."
				items={PRICING_FAQS}
			/>
			<CTASection />
		</div>
	);
}
