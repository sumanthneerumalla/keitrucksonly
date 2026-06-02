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
		"How long is a contract?",
		"Month-to-month after a free first month. No annual lock-in, no setup fees, no termination penalty.",
	],
	[
		"Do you charge per transaction?",
		"No. We don't take a cut of your bookings or POS sales. Stripe's standard processing rates pass through to you.",
	],
	[
		"What about my existing data?",
		"We migrate it for free. Members, bookings, packages, payment history — verified row-by-row before we cut over.",
	],
	[
		"Is there a member-facing app?",
		"A member app for iOS and Android is on our roadmap. Today, members book courts, see credits, and check in by QR through a responsive web app.",
	],
];

export function FAQ({
	num = "06 / FAQ",
	title = "Questions buyers actually ask.",
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
