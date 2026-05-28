"use client";

import { CheckCircle } from "lucide-react";
import { ProductPreview } from "~/app/_components/client/public/marketing/ProductPreview";
import { RotatingHeadline } from "~/app/_components/client/public/marketing/RotatingHeadline";
import { CALENDLY_URL } from "~/lib/marketing";

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-8 pb-8 md:pt-12">
			<div className="container relative z-10 mx-auto px-4">
				{/* grid-cols-1 forces a single 1fr column below lg, so the wide
				 * ProductPreview content (CalendarMock has min-width: 864) can't
				 * size the implicit grid track to its own max-content and force
				 * the H1 wider than the viewport. */}
				<div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
					<div className="min-w-0 max-w-[640px]">
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

					{/* On lg+, let the preview bleed past the container's right edge
					 * (extends ~10vw beyond its grid column). The section's
					 * overflow-hidden clips anything that goes past the viewport
					 * right, giving the same "preview extends off-screen" effect
					 * tourny.ca uses. Below lg the preview stacks under hero copy,
					 * so we keep w-full there. */}
					<div className="w-full min-w-0 lg:w-[calc(100%_+_10vw)]">
						<ProductPreview />
					</div>
				</div>
			</div>
		</section>
	);
}

export default Hero;
