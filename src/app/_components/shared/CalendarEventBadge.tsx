"use client";

import type { CalendarEvent as IlamyCalendarEvent } from "@ilamy/calendar";

interface EventData {
	eventType?: string;
	maxParticipants?: number | null;
	currentRegistrations?: number;
	priceInCents?: number | null;
}

interface CalendarEventBadgeProps {
	event: IlamyCalendarEvent;
}

export function CalendarEventBadge({ event }: CalendarEventBadgeProps) {
	const data = event.data as EventData | undefined;
	const eventType = data?.eventType;
	const maxParticipants = data?.maxParticipants ?? null;
	const currentRegistrations = data?.currentRegistrations ?? 0;
	const priceInCents = data?.priceInCents ?? null;

	const isFull =
		maxParticipants !== null && currentRegistrations >= maxParticipants;
	const showCapacity =
		(eventType === "BOOKABLE" || eventType === "COACHING_SLOT") &&
		maxParticipants !== null;
	const showPrice =
		(eventType === "BOOKABLE" || eventType === "COACHING_SLOT") &&
		priceInCents !== null;

	const formattedPrice =
		priceInCents !== null
			? new Intl.NumberFormat("en-US", {
					style: "currency",
					currency: "USD",
					minimumFractionDigits: 0,
				}).format(priceInCents / 100)
			: null;

	// When renderEvent is provided, ilamy skips its own colored wrapper and calls
	// us directly — so we must replicate the background/text color ourselves.
	// Ilamy default fallbacks: bg-blue-500 text-white. We use the same hex
	// equivalents so events with no stored color still look styled.
	const bgColor = event.backgroundColor ?? "#3b82f6";
	const textColor = event.color ?? "#ffffff";

	return (
		<div
			className="flex h-full w-full items-center gap-1 overflow-hidden rounded-md border-[1.5px] border-white/30 px-1.5 py-0.5"
			style={{ backgroundColor: bgColor, color: textColor }}
		>
			<span className="min-w-0 flex-1 truncate font-medium text-xs leading-tight">
				{event.title}
			</span>
			{showCapacity && (
				<span
					className={`shrink-0 rounded px-1 py-0.5 font-semibold text-[10px] leading-none ${
						isFull ? "bg-red-100 text-red-700" : "bg-white/40 text-current"
					}`}
				>
					{isFull ? "Full" : `${currentRegistrations}/${maxParticipants}`}
				</span>
			)}
			{showPrice && formattedPrice && (
				<span className="shrink-0 rounded bg-white/40 px-1 py-0.5 font-semibold text-[10px] text-current leading-none">
					{formattedPrice}
				</span>
			)}
		</div>
	);
}
