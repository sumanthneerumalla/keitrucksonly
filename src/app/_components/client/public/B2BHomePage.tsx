import { Hero } from "~/app/_components/client/public/Hero";
import { CTASection } from "~/app/_components/client/public/marketing/CTASection";
import { Compare } from "~/app/_components/client/public/marketing/Compare";
import { Differentiators } from "~/app/_components/client/public/marketing/Differentiators";
import { FAQ } from "~/app/_components/client/public/marketing/FAQ";
import { FeatureGrid } from "~/app/_components/client/public/marketing/FeatureGrid";
import { HowItWorks } from "~/app/_components/client/public/marketing/HowItWorks";
import { Testimonial } from "~/app/_components/client/public/marketing/Testimonial";
import { TrustStrip } from "~/app/_components/client/public/marketing/TrustStrip";
import { HydrateClient } from "~/trpc/server";

// B2B (club-owner-facing) sales homepage. Club landing pages no longer render
// this (Phase 16) — it is the body of `/` only.
export function B2BHomePage() {
	return (
		<HydrateClient>
			<div className="marketing-page">
				<Hero />
				<TrustStrip />
				<FeatureGrid />
				<HowItWorks />
				<Testimonial />
				<Differentiators />
				<Compare />
				<FAQ />
				<CTASection />
			</div>
		</HydrateClient>
	);
}
