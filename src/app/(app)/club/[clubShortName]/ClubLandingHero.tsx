import Link from "next/link";
import { JoinClubButton } from "~/app/(app)/club/[clubShortName]/JoinClubButton";
import { CONTENT_IMAGE_URL } from "~/lib/article";

interface ClubLandingHeroProps {
	clubShortName: string;
	clubName: string;
	tagline: string | null;
	location: string | null;
	heroImageId: string | null;
}

/**
 * Phase 16 — the club landing hero. Server-rendered (the club name/tagline/
 * location are the page's primary crawlable content). Three jobs-to-be-done
 * CTAs: book a court (→ calendar), book an event (→ on-page events section),
 * and join (client component, hidden for existing members).
 */
export function ClubLandingHero({
	clubShortName,
	clubName,
	tagline,
	location,
	heroImageId,
}: ClubLandingHeroProps) {
	const base = `/club/${clubShortName}`;
	const primaryCta =
		"inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 font-medium text-[var(--ink)] text-sm shadow-sm transition-transform hover:scale-[1.02]";
	const secondaryCta =
		"inline-flex items-center justify-center rounded-lg border border-white/40 px-6 py-3 font-medium text-sm text-white transition-colors hover:bg-white/10";

	return (
		<section className="relative isolate overflow-hidden bg-[var(--ink)]">
			{heroImageId && (
				<>
					{/* biome-ignore lint/performance/noImgElement: arbitrary remote ContentImage via /api/content-image — Next/Image not applicable */}
					<img
						src={CONTENT_IMAGE_URL(heroImageId)}
						alt=""
						className="absolute inset-0 h-full w-full object-cover"
					/>
					<div className="absolute inset-0 bg-black/55" />
				</>
			)}
			<div className="container relative mx-auto px-4 py-20 text-center md:py-28">
				<h1 className="font-bold text-4xl text-white tracking-tight md:text-5xl">
					{clubName}
				</h1>
				{tagline && (
					<p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
						{tagline}
					</p>
				)}
				{location && (
					<p className="mt-3 font-medium text-white/70">
						Located in {location}
					</p>
				)}
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<Link href={`${base}/calendar`} className={primaryCta}>
						Book a Court
					</Link>
					<a href="#events" className={secondaryCta}>
						Book an Event
					</a>
					<JoinClubButton
						clubShortName={clubShortName}
						className={secondaryCta}
					/>
				</div>
			</div>
		</section>
	);
}
