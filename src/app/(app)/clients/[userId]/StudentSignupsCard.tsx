"use client";

import { Calendar, Repeat, Ticket } from "lucide-react";
import Link from "next/link";
import dayjs from "~/lib/dayjs-config";
import { type RouterOutputs, api } from "~/trpc/react";

interface StudentSignupsCardProps {
	userId: string;
}

type EventSignup =
	RouterOutputs["calendar"]["getEventRegistrationsForUser"]["eventSignups"][number];
type SeriesSignup =
	RouterOutputs["calendar"]["getEventRegistrationsForUser"]["seriesSignups"][number];

export default function StudentSignupsCard({
	userId,
}: StudentSignupsCardProps) {
	const { data, isLoading } =
		api.calendar.getEventRegistrationsForUser.useQuery(
			{ userId },
			{ enabled: !!userId },
		);

	const eventSignups = data?.eventSignups ?? [];
	const seriesSignups = data?.seriesSignups ?? [];
	const total = eventSignups.length + seriesSignups.length;

	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
			<div className="mb-3 flex items-center justify-between">
				<h4 className="flex items-center gap-2 font-semibold text-[var(--foreground)] text-sm">
					<Ticket size={14} />
					Event Sign-ups
				</h4>
			</div>

			{isLoading ? (
				<p className="text-[var(--muted-foreground)] text-xs">Loading...</p>
			) : total === 0 ? (
				<p className="text-[var(--muted-foreground)] text-xs">
					No active event sign-ups.
				</p>
			) : (
				<div className="space-y-4">
					<Subsection
						icon={<Calendar size={12} />}
						title="Upcoming events"
						count={eventSignups.length}
						emptyText="No upcoming events."
					>
						{eventSignups.map((s) => (
							<EventRow key={s.registrationId} signup={s} />
						))}
					</Subsection>

					<Subsection
						icon={<Repeat size={12} />}
						title="Series enrollments"
						count={seriesSignups.length}
						emptyText="Not enrolled in any series."
					>
						{seriesSignups.map((s) => (
							<SeriesRow key={s.registrationId} signup={s} />
						))}
					</Subsection>
				</div>
			)}
		</div>
	);
}

function Subsection({
	icon,
	title,
	count,
	emptyText,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	count: number;
	emptyText: string;
	children: React.ReactNode;
}) {
	return (
		<section>
			<h5 className="mb-2 flex items-center gap-1.5 font-medium text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
				{icon}
				{title} ({count})
			</h5>
			{count === 0 ? (
				<p className="text-[var(--muted-foreground)] text-xs">{emptyText}</p>
			) : (
				<div className="space-y-2">{children}</div>
			)}
		</section>
	);
}

function EventRow({ signup }: { signup: EventSignup }) {
	return (
		<Link
			href={`/events/${signup.event.eventId}`}
			className="block rounded border border-[var(--border)] p-2 text-sm transition-colors hover:bg-[var(--muted)]"
		>
			<p className="font-medium text-[var(--foreground)]">
				{signup.event.title}
			</p>
			<p className="text-[var(--muted-foreground)] text-xs">
				{dayjs(signup.occurrenceDate).format("ddd, MMM D YYYY · h:mm A")}
			</p>
			{signup.event.resource && (
				<p className="text-[var(--muted-foreground)] text-xs">
					{signup.event.resource.title}
				</p>
			)}
		</Link>
	);
}

function SeriesRow({ signup }: { signup: SeriesSignup }) {
	return (
		<Link
			href={`/events/${signup.event.eventId}`}
			className="block rounded border border-[var(--border)] p-2 text-sm transition-colors hover:bg-[var(--muted)]"
		>
			<p className="font-medium text-[var(--foreground)]">
				{signup.event.title}
			</p>
			<p className="text-[var(--muted-foreground)] text-xs">
				Next session:{" "}
				{dayjs(signup.nextSession).format("ddd, MMM D YYYY · h:mm A")}
			</p>
			{signup.event.resource && (
				<p className="text-[var(--muted-foreground)] text-xs">
					{signup.event.resource.title}
				</p>
			)}
		</Link>
	);
}
