import { MapPin, Navigation } from "lucide-react";
import { googleMapsSearchUrl } from "~/lib/maps";

interface EventLocationProps {
	facility: {
		name: string;
		streetAddress: string | null;
		city: string | null;
		state: string | null;
		zipCode: string | null;
	} | null;
}

/**
 * Phase 16 — server-rendered "where is this" block at the bottom of every
 * event page (both /events/[id] and the club-chromed /<short>/events/[id]).
 * Shows the facility name + address with a one-click Google Maps "Directions"
 * link. Renders nothing when there's no facility/address to show.
 */
export function EventLocation({ facility }: EventLocationProps) {
	if (!facility) return null;
	const cityState = [
		facility.city,
		[facility.state, facility.zipCode].filter(Boolean).join(" "),
	]
		.filter(Boolean)
		.join(", ");
	const addressParts = [facility.streetAddress, cityState].filter(Boolean);
	if (addressParts.length === 0) return null;
	const address = addressParts.join(", ");
	const mapsUrl = googleMapsSearchUrl(facility.name, address);

	return (
		<section className="container mx-auto max-w-3xl px-4 pb-12">
			<div className="flex items-start justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
				<div className="flex items-start gap-2">
					<MapPin size={18} className="mt-0.5 shrink-0 text-[var(--primary)]" />
					<div>
						<div className="font-semibold text-[var(--foreground)]">
							{facility.name}
						</div>
						<div className="text-[var(--muted-foreground)] text-sm">
							{address}
						</div>
					</div>
				</div>
				<a
					href={mapsUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 font-medium text-[var(--foreground)] text-sm transition-colors hover:bg-[var(--accent)]"
				>
					<Navigation size={15} />
					Directions
				</a>
			</div>
		</section>
	);
}
