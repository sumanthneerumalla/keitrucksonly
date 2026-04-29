import type { Metadata } from "next";
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

export const metadata: Metadata = {
	title: "Facility Presence — One platform to run your courts",
	description:
		"Court calendar, self-serve check-in, packages, payments, and reports — under one roof, with one bill. Built for pickleball, tennis, and padel clubs.",
};

interface HomePageProps {
	// Kept for the /club/[shortName] route which reuses HomePage. NavBar reads
	// this via AuthedLayout → router pathname extraction; the marketing Hero
	// itself doesn't need it (CTAs go to Calendly, not the join-club flow).
	clubShortName?: string;
}

export function HomePage(_props: HomePageProps) {
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

export default function Home() {
	return <HomePage />;
}
