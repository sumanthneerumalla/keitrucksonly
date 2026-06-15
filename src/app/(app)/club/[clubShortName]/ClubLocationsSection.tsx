import { MapPin, Phone } from "lucide-react";
import { getHoursRows } from "~/lib/clubProfile";

interface FacilityInfo {
	facilityId: string;
	name: string;
	streetAddress: string | null;
	city: string | null;
	state: string | null;
	zipCode: string | null;
	phone: string | null;
	email: string | null;
	operatingHours: unknown;
	description: string | null;
}

function fullAddress(f: FacilityInfo): string | null {
	const cityState = [f.city, [f.state, f.zipCode].filter(Boolean).join(" ")]
		.filter(Boolean)
		.join(", ");
	const parts = [f.streetAddress, cityState].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : null;
}

// Google Maps search link (B4 — a link, not an embed: no third-party load).
function mapsLink(f: FacilityInfo): string {
	const query = [f.name, fullAddress(f)].filter(Boolean).join(", ");
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Phase 16 — per-facility "Locations & hours" section. Server-rendered NAP
 * (name/address/phone) is a local-SEO signal. Every block is conditional on
 * data, so a half-configured facility still renders cleanly.
 */
export function ClubLocationsSection({
	facilities,
}: {
	facilities: FacilityInfo[];
}) {
	if (facilities.length === 0) return null;

	return (
		<section id="locations" className="border-[var(--line)] border-t">
			<div className="container mx-auto px-4 py-14">
				<h2 className="mb-8 font-bold text-2xl text-[var(--foreground)]">
					{facilities.length > 1 ? "Locations & hours" : "Location & hours"}
				</h2>
				<div className="grid gap-8 md:grid-cols-2">
					{facilities.map((f) => {
						const address = fullAddress(f);
						const hours = getHoursRows(f.operatingHours);
						return (
							<div
								key={f.facilityId}
								className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6"
							>
								<h3 className="font-semibold text-[var(--foreground)] text-lg">
									{f.name}
								</h3>
								{f.description && (
									<p className="mt-2 text-[var(--muted-foreground)] text-sm">
										{f.description}
									</p>
								)}
								<div className="mt-4 space-y-1.5 text-sm">
									{address && (
										<a
											href={mapsLink(f)}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-start gap-2 text-[var(--foreground)] hover:text-[var(--primary)]"
										>
											<MapPin size={15} className="mt-0.5 shrink-0" />
											<span>{address}</span>
										</a>
									)}
									{f.phone && (
										<a
											href={`tel:${f.phone}`}
											className="flex items-center gap-2 text-[var(--foreground)] hover:text-[var(--primary)]"
										>
											<Phone size={15} className="shrink-0" />
											<span>{f.phone}</span>
										</a>
									)}
								</div>
								{hours && (
									<dl className="mt-4 space-y-1 border-[var(--line)] border-t pt-4 text-sm">
										{hours.map((row) => (
											<div
												key={row.label}
												className="flex justify-between gap-4"
											>
												<dt className="text-[var(--muted-foreground)]">
													{row.label}
												</dt>
												<dd className="text-[var(--foreground)]">{row.text}</dd>
											</div>
										))}
									</dl>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
