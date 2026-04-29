"use client";

import { useState } from "react";
import { SectionHead } from "~/app/_components/client/public/marketing/SectionHead";

interface FAQProps {
	num?: string;
	title?: string;
	items?: Array<[string, string]>;
}

const DEFAULT_ITEMS: Array<[string, string]> = [
	[
		'What does "Presence" mean?',
		"It's the live picture of your facility: who's checked in, what court they're on, what they paid, what's owed. Every screen in the app starts from that one source of truth.",
	],
	[
		"How long is a typical contract?",
		"Month-to-month after a free first month. No annual lock-in, no setup fees, no termination penalty.",
	],
	[
		"Do you charge per transaction?",
		"No. We don't take a cut of your bookings or POS sales. Stripe's standard processing rates pass through to you.",
	],
	[
		"What happens to my existing data?",
		"We migrate it for free. Members, bookings, packages, payment history — verified row-by-row before we cut over.",
	],
	[
		"Is there a member-facing app?",
		"Yes — iOS and Android, plus a responsive web app. Members book courts, see credits, and check in with QR.",
	],
	[
		"What about compliance?",
		"SOC 2 Type II, PCI DSS via Stripe, and standard GDPR/CCPA tooling. Audit reports available on request under NDA.",
	],
];

export function FAQ({
	num = "06 / FAQ",
	title = "Six questions buyers actually ask.",
	items = DEFAULT_ITEMS,
}: FAQProps) {
	const [open, setOpen] = useState<number | null>(0);
	return (
		<section className="bg-[var(--paper-2)] py-20 md:py-[120px]">
			<div className="container mx-auto px-4">
				<SectionHead num={num} title={title} />
				<div className="max-w-[880px]">
					{items.map(([q, a], i) => {
						const isOpen = open === i;
						return (
							<div key={q} className="border-[var(--line)] border-t py-5">
								<button
									type="button"
									onClick={() => setOpen(isOpen ? null : i)}
									aria-expanded={isOpen}
									className="flex w-full cursor-pointer items-center justify-between gap-4 text-left font-medium text-[22px] text-[var(--ink)] tracking-[-0.01em]"
								>
									<span>{q}</span>
									<span
										className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[18px] transition-colors ${isOpen ? "bg-[var(--brand)] text-white" : "bg-[var(--paper)] text-[var(--ink)]"}`}
									>
										{isOpen ? "−" : "+"}
									</span>
								</button>
								{isOpen ? (
									<p className="mt-3.5 max-w-[700px] text-[16.5px] text-[var(--ink-2)]">
										{a}
									</p>
								) : null}
							</div>
						);
					})}
					<div className="border-[var(--line)] border-t" />
				</div>
			</div>
		</section>
	);
}

export default FAQ;
