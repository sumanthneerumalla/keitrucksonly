"use client";

import { CheckCircle, Play } from "lucide-react";
import { ProductPreview } from "~/app/_components/client/public/marketing/ProductPreview";
import { RotatingHeadline } from "~/app/_components/client/public/marketing/RotatingHeadline";
import { CALENDLY_URL } from "~/lib/marketing";

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-8 pb-8 md:pt-12">
			<div className="container relative z-10 mx-auto px-4">
				<div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
					<div className="max-w-[640px]">
						<div className="eyebrow">
							<span className="eyebrow-dot">●</span>
							&nbsp;&nbsp;FOR PICKLEBALL · TENNIS · PADEL CLUBS
						</div>

						<RotatingHeadline />

						<div className="mt-7 flex flex-wrap gap-3">
							<a
								href={CALENDLY_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="btn btn-primary btn-lg"
							>
								Book a 15-min demo <span className="arrow">→</span>
							</a>
							<a href="#how-it-works" className="btn btn-ghost btn-lg">
								See how it works
							</a>
							<a
								href={CALENDLY_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="btn btn-text btn-lg"
								style={{ paddingLeft: 6 }}
							>
								<Play size={16} /> Watch 90-sec tour
							</a>
						</div>

						<div className="mt-5 flex flex-wrap gap-5 text-[13.5px] text-[var(--ink-3)]">
							<span className="inline-flex items-center gap-1.5">
								<CheckCircle size={14} className="text-[var(--good)]" />
								No credit card required
							</span>
							<span className="inline-flex items-center gap-1.5">
								<CheckCircle size={14} className="text-[var(--good)]" />
								Live in under a week
							</span>
							<span className="inline-flex items-center gap-1.5">
								<CheckCircle size={14} className="text-[var(--good)]" />
								We migrate your data free
							</span>
						</div>
					</div>

					<div className="w-full">
						<ProductPreview />
					</div>
				</div>
			</div>
		</section>
	);
}

export default Hero;
