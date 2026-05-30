"use client";

import { Activity } from "lucide-react";
import { api } from "~/trpc/react";

/**
 * Phase 9a — Activity timeline for an event's Activity tab on
 * /events/[eventId]. Reads from `calendar.listEventStatusLog`
 * (RegistrationStatusLog rows for every registration on this event, newest
 * first). Each row is a status change (REGISTERED → CHECKED_IN /
 * NO_SHOW / LATE_CANCEL / RESCHEDULED), including the affected member and
 * the staff who made the change.
 *
 * Reads from the RegistrationStatusLog table (NOT AuditLog) — registration
 * status changes have their own pre-AuditLog audit table that we surface
 * here without consolidating (see HANDOFF #122's "deferred follow-ups").
 */

interface EventStatusLogTimelineProps {
	eventId: string;
}

const STATUS_LABEL: Record<string, string> = {
	REGISTERED: "Registered",
	CHECKED_IN: "Checked in",
	EARLY_CANCEL: "Early cancel",
	LATE_CANCEL: "Late cancel",
	RESCHEDULED: "Rescheduled",
	NO_SHOW: "No-show",
};

const SOURCE_LABEL: Record<string, string> = {
	admin_dashboard: "Admin dashboard",
	self_service: "Self-service",
	system: "System",
};

function formatTimestamp(d: Date | string): string {
	return new Date(d).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatPersonName(p: {
	firstName: string | null;
	lastName: string | null;
}): string {
	return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "(no name)";
}

export default function EventStatusLogTimeline({
	eventId,
}: EventStatusLogTimelineProps) {
	const query = api.calendar.listEventStatusLog.useQuery(
		{ eventId, limit: 200 },
		{ enabled: !!eventId },
	);

	if (query.isLoading) {
		return (
			<div className="space-y-3 py-2">
				<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
				<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
				<div className="h-10 animate-pulse rounded bg-[var(--muted)]" />
			</div>
		);
	}

	if (query.isError) {
		return (
			<p className="py-2 text-[var(--muted-foreground)] text-xs">
				Couldn't load activity. {query.error.message}
			</p>
		);
	}

	const rows = query.data?.items ?? [];

	if (rows.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] border-dashed py-10 text-center">
				<Activity size={18} className="mb-2 text-[var(--muted-foreground)]" />
				<p className="text-[var(--muted-foreground)] text-sm">
					No registration activity yet for this event.
				</p>
			</div>
		);
	}

	return (
		<ul className="divide-y divide-[var(--border)]">
			{rows.map((row) => {
				const memberName = formatPersonName(row.user);
				const actorName = formatPersonName(row.changedByUser);
				const newStatus = STATUS_LABEL[row.newStatus] ?? row.newStatus;
				const oldStatus = row.oldStatus
					? (STATUS_LABEL[row.oldStatus] ?? row.oldStatus)
					: null;
				const sourceLabel =
					row.source && SOURCE_LABEL[row.source]
						? SOURCE_LABEL[row.source]
						: null;
				return (
					<li key={row.logId} className="py-3 first:pt-0">
						<div className="flex items-baseline justify-between gap-3">
							<span className="text-[var(--foreground)] text-sm">
								<span className="font-medium">{memberName}</span> ·{" "}
								<span className="font-medium">{newStatus}</span>
								{oldStatus && (
									<span className="text-[var(--muted-foreground)] text-xs">
										{" "}
										(from {oldStatus})
									</span>
								)}
							</span>
							<span className="shrink-0 text-[var(--muted-foreground)] text-xs">
								{formatTimestamp(row.createdAt)}
							</span>
						</div>
						<div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[var(--muted-foreground)] text-xs">
							<span>by {actorName}</span>
							{sourceLabel && (
								<>
									<span aria-hidden>·</span>
									<span>{sourceLabel}</span>
								</>
							)}
							{row.reason && (
								<>
									<span aria-hidden>·</span>
									<span className="italic">"{row.reason}"</span>
								</>
							)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
