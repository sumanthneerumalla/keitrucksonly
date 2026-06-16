"use client";

import { Facebook, Globe, Instagram, Twitter, Youtube } from "lucide-react";
import Link from "next/link";
import type React from "react";
import {
	DAYS_OF_WEEK,
	DAY_LABELS,
	operatingHoursSchema,
} from "~/lib/clubProfile";
import { googleMapsSearchUrl } from "~/lib/maps";
import { api } from "~/trpc/react";

interface ClubFooterProps {
	clubShortName: string;
}

/** Format a "HH:mm" 24h string into a friendly "h:mm AM/PM". */
function formatTime(hhmm: string): string {
	const [h, m] = hhmm.split(":");
	const hour = Number(h);
	const minute = m ?? "00";
	const period = hour >= 12 ? "PM" : "AM";
	const hour12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${hour12}:${minute} ${period}`;
}

function SocialIcon({
	href,
	label,
	children,
}: {
	href: string;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={label}
			className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10"
		>
			{children}
		</a>
	);
}

export function ClubFooter({ clubShortName }: ClubFooterProps) {
	const { data } = api.clubs.getPublicBranding.useQuery(
		{ clubShortName },
		{ staleTime: 1000 * 60 * 5 },
	);

	if (!data) {
		return null;
	}

	const { club, facilities } = data;

	// Narrow the Json socialLinks bag to the typed shape.
	const social =
		club.socialLinks && typeof club.socialLinks === "object"
			? (club.socialLinks as Record<string, unknown>)
			: {};
	const socialUrl = (key: string): string | null =>
		typeof social[key] === "string" && social[key]
			? (social[key] as string)
			: null;
	const fb = socialUrl("facebook");
	const ig = socialUrl("instagram");
	const x = socialUrl("x");
	const youtube = socialUrl("youtube");
	const tiktok = socialUrl("tiktok");
	const hasSocial = Boolean(fb || ig || x || youtube || tiktok);

	return (
		<footer className="bg-[var(--ink)] text-white/70">
			<div className="container mx-auto px-4 py-16 md:py-20">
				<div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3">
					{/* Club identity */}
					<div className="lg:pr-6">
						<div className="font-bold text-lg text-white">{club.clubName}</div>
						{club.tagline && (
							<p className="mt-4 max-w-[320px] text-sm text-white/60">
								{club.tagline}
							</p>
						)}
						{club.websiteUrl && (
							<a
								href={club.websiteUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="mt-4 inline-flex items-center gap-1.5 text-[14.5px] text-white/75 hover:text-white"
							>
								<Globe size={14} />
								Visit website
							</a>
						)}
						{hasSocial && (
							<div className="mt-5 flex flex-wrap gap-2">
								{fb && (
									<SocialIcon href={fb} label="Facebook">
										<Facebook size={14} />
									</SocialIcon>
								)}
								{ig && (
									<SocialIcon href={ig} label="Instagram">
										<Instagram size={14} />
									</SocialIcon>
								)}
								{x && (
									<SocialIcon href={x} label="X">
										<Twitter size={14} />
									</SocialIcon>
								)}
								{youtube && (
									<SocialIcon href={youtube} label="YouTube">
										<Youtube size={14} />
									</SocialIcon>
								)}
								{tiktok && (
									<SocialIcon href={tiktok} label="TikTok">
										<span className="font-bold text-[11px]">TT</span>
									</SocialIcon>
								)}
							</div>
						)}
					</div>

					{/* Facilities: NAP (local-SEO signal) */}
					{facilities.map((f) => {
						const cityState = [
							f.city,
							[f.state, f.zipCode].filter(Boolean).join(" "),
						]
							.filter(Boolean)
							.join(", ");
						const phoneDigits = f.phone?.replace(/[^\d+]/g, "");
						return (
							<div key={f.facilityId}>
								<h4 className="mb-4 font-medium font-mono text-[11px] text-white/50 uppercase tracking-[0.14em]">
									{f.name}
								</h4>
								<address className="space-y-1 text-[14.5px] text-white/75 not-italic">
									{(f.streetAddress || cityState) && (
										<a
											href={googleMapsSearchUrl(
												f.name,
												f.streetAddress,
												cityState,
											)}
											target="_blank"
											rel="noopener noreferrer"
											className="block hover:text-white"
										>
											{f.streetAddress && <div>{f.streetAddress}</div>}
											{cityState && <div>{cityState}</div>}
										</a>
									)}
									{f.phone && phoneDigits && (
										<a
											href={`tel:${phoneDigits}`}
											className="block hover:text-white"
										>
											{f.phone}
										</a>
									)}
									{f.email && (
										<a
											href={`mailto:${f.email}`}
											className="block hover:text-white"
										>
											{f.email}
										</a>
									)}
								</address>

								{/* Hours — only when configured */}
								{(() => {
									const parsed = operatingHoursSchema.safeParse(
										f.operatingHours,
									);
									if (!f.operatingHours || !parsed.success) {
										return null;
									}
									const hours = parsed.data;
									return (
										<dl className="mt-4 space-y-0.5 text-[13px] text-white/60">
											{DAYS_OF_WEEK.map((day) => {
												const interval = hours[day];
												return (
													<div key={day} className="flex justify-between gap-3">
														<dt className="text-white/50">{DAY_LABELS[day]}</dt>
														<dd>
															{interval
																? `${formatTime(interval.open)} – ${formatTime(interval.close)}`
																: "Closed"}
														</dd>
													</div>
												);
											})}
										</dl>
									);
								})()}
							</div>
						);
					})}
				</div>

				<div className="mt-12 flex flex-col gap-4 border-white/10 border-t pt-6 text-white/50 text-xs sm:flex-row sm:items-center sm:justify-between">
					<span>
						© {new Date().getFullYear()} {club.clubName}
					</span>
					<a
						href="https://facilitypresence.com"
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-white"
					>
						Powered by Facility Presence
					</a>
				</div>
			</div>
		</footer>
	);
}

export default ClubFooter;
