"use client";

import { CheckCircle } from "lucide-react";
import { useState } from "react";
import { CALENDLY_URL } from "~/lib/marketing";

export interface PlanPricing {
	/** Price per month when billed monthly. */
	monthly: number;
	/** Price per month when billed annually (i.e. annualTotal / 12). */
	yearly: number;
}

export interface Plan {
	id: string;
	name: string;
	forWho: string;
	/** null = quote-driven plan; show the CTA button only, no price number. */
	pricing: PlanPricing | null;
	anchor: string;
	cta: string;
	popular: boolean;
	includes: string[];
}

type BillingPeriod = "monthly" | "yearly";

/**
 * Compute the headline savings % shown on the toggle. Uses the first plan
 * that has both a non-zero monthly and yearly price (i.e. excludes Free).
 */
function computeSavingsPct(plans: Plan[]): number {
	const sample = plans.find(
		(p) => p.pricing && p.pricing.monthly > 0 && p.pricing.yearly > 0,
	);
	if (!sample?.pricing) return 0;
	const { monthly, yearly } = sample.pricing;
	return Math.round((1 - yearly / monthly) * 100);
}

function BillingToggle({
	period,
	setPeriod,
	savingsPct,
}: {
	period: BillingPeriod;
	setPeriod: (p: BillingPeriod) => void;
	savingsPct: number;
}) {
	return (
		<div aria-label="Billing period" className="mb-10 flex justify-center">
			<div className="inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--paper)] p-1">
				<button
					type="button"
					aria-pressed={period === "monthly"}
					onClick={() => setPeriod("monthly")}
					className={`rounded-full px-5 py-2 font-medium text-[14px] transition-colors ${
						period === "monthly"
							? "bg-[var(--ink)] text-[var(--paper)]"
							: "text-[var(--ink-2)] hover:text-[var(--ink)]"
					}`}
				>
					Monthly
				</button>
				<button
					type="button"
					aria-pressed={period === "yearly"}
					onClick={() => setPeriod("yearly")}
					className={`flex items-center gap-2 rounded-full px-5 py-2 font-medium text-[14px] transition-colors ${
						period === "yearly"
							? "bg-[var(--ink)] text-[var(--paper)]"
							: "text-[var(--ink-2)] hover:text-[var(--ink)]"
					}`}
				>
					<span>Yearly</span>
					{savingsPct > 0 ? (
						<span
							className={`rounded-full px-1.5 py-0.5 font-mono font-semibold text-[10px] uppercase tracking-[0.06em] ${
								period === "yearly"
									? "bg-[var(--brand-200)] text-[var(--ink)]"
									: "bg-[var(--brand-50)] text-[var(--brand-ink)]"
							}`}
						>
							Save {savingsPct}%
						</span>
					) : null}
				</button>
			</div>
		</div>
	);
}

function PlanCard({ p, period }: { p: Plan; period: BillingPeriod }) {
	const popular = p.popular;
	const isYearly = period === "yearly";
	const displayPrice = p.pricing
		? isYearly
			? p.pricing.yearly
			: p.pricing.monthly
		: null;
	const showAnnualCallout =
		p.pricing != null && p.pricing.monthly > 0 && isYearly;
	const yearlyTotal = p.pricing ? p.pricing.yearly * 12 : 0;
	const subtitle = showAnnualCallout
		? `Billed annually as $${yearlyTotal.toLocaleString()}/yr — ${p.anchor}`
		: p.anchor;

	return (
		<div
			className={`relative flex flex-col rounded-[22px] p-8 ${
				popular
					? "bg-[var(--ink)] text-[var(--paper)]"
					: "border border-[var(--line)] bg-[var(--paper)] text-[var(--ink)]"
			}`}
			style={
				popular
					? {
							boxShadow: "0 32px 80px -30px rgba(79,70,229,0.5)",
							border: "1px solid var(--ink)",
						}
					: {
							boxShadow:
								"0 1px 0 rgba(20,19,14,.04), 0 1px 2px rgba(20,19,14,.05)",
						}
			}
		>
			{popular ? (
				<span className="-top-3 absolute left-6 rounded-full bg-[var(--brand)] px-2.5 py-1 font-mono font-semibold text-[11px] text-white uppercase tracking-[0.1em]">
					Most popular
				</span>
			) : null}
			<div
				className="font-mono text-[11px] uppercase tracking-[0.12em]"
				style={{ color: popular ? "rgba(250,248,243,0.6)" : "var(--ink-3)" }}
			>
				{p.name}
			</div>
			<div
				className="mt-2 min-h-[42px] text-[14px]"
				style={{ color: popular ? "rgba(250,248,243,0.7)" : "var(--ink-2)" }}
			>
				{p.forWho}
			</div>

			{p.pricing ? (
				<div className="mt-5 flex items-baseline gap-1.5">
					<span className="font-semibold text-[56px] leading-none tracking-[-0.03em]">
						${displayPrice}
					</span>
					<span
						className="text-[14px]"
						style={{
							color: popular ? "rgba(250,248,243,0.6)" : "var(--ink-3)",
						}}
					>
						/ month
					</span>
				</div>
			) : null}
			<div
				className={`${p.pricing ? "mt-1.5" : "mt-5"} text-[13px]`}
				style={{ color: popular ? "rgba(250,248,243,0.55)" : "var(--ink-3)" }}
			>
				{subtitle}
			</div>

			<a
				href={CALENDLY_URL}
				target="_blank"
				rel="noopener noreferrer"
				className={popular ? "btn btn-primary" : "btn btn-secondary"}
				style={{ marginTop: 22, justifyContent: "center" }}
			>
				{p.cta} <span className="arrow">→</span>
			</a>

			<ul className="m-0 mt-6 flex list-none flex-col gap-2.5 p-0">
				{p.includes.map((it) => (
					<li key={it} className="flex items-start gap-2.5 text-[14px]">
						<CheckCircle
							size={16}
							className="mt-0.5 flex-shrink-0"
							style={{
								color: popular ? "var(--brand-200)" : "var(--brand)",
							}}
						/>
						<span>{it}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function PlansSection({ plans }: { plans: Plan[] }) {
	const [period, setPeriod] = useState<BillingPeriod>("monthly");
	const savingsPct = computeSavingsPct(plans);

	return (
		<section className="pb-16">
			<div className="container mx-auto px-4">
				{/* Billing toggle hidden while plans are quote-driven (no prices). */}
				{plans.some((p) => p.pricing) && (
					<BillingToggle
						period={period}
						setPeriod={setPeriod}
						savingsPct={savingsPct}
					/>
				)}
				<div className="grid grid-cols-1 items-stretch gap-[22px] lg:grid-cols-3">
					{plans.map((p) => (
						<PlanCard key={p.id} p={p} period={period} />
					))}
				</div>
				<div className="mt-6 flex flex-wrap justify-center gap-4 text-[13.5px] text-[var(--ink-3)]">
					<span className="inline-flex items-center gap-1.5">
						<CheckCircle size={14} className="text-[var(--good)]" />
						No credit card to start
					</span>
					<span className="inline-flex items-center gap-1.5">
						<CheckCircle size={14} className="text-[var(--good)]" />
						Cancel anytime
					</span>
					<span className="inline-flex items-center gap-1.5">
						<CheckCircle size={14} className="text-[var(--good)]" />
						Free migration on Growth & Custom
					</span>
				</div>
			</div>
		</section>
	);
}
