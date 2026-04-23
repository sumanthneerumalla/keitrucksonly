"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/app/_components/shared/Button";
import dayjs from "~/lib/dayjs-config";
import { type RouterOutputs, api } from "~/trpc/react";

interface AttendanceHistoryCardProps {
	userId: string;
}

type Attendance =
	RouterOutputs["checkin"]["getMemberAttendanceHistory"]["attendances"][number];

const SOURCE_LABEL: Record<string, string> = {
	staff: "Staff",
	self: "Self",
	scan: "Scan",
};

export default function AttendanceHistoryCard({
	userId,
}: AttendanceHistoryCardProps) {
	const [cursor, setCursor] = useState<string | undefined>(undefined);
	const [accumulated, setAccumulated] = useState<Attendance[]>([]);
	const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

	const { data, isLoading, isFetching } =
		api.checkin.getMemberAttendanceHistory.useQuery(
			{ userId, limit: 20, cursor },
			{ enabled: !!userId },
		);

	useEffect(() => {
		if (!data) return;
		setAccumulated((prev) => {
			const next = [...prev];
			const nextSeen = new Set(seenIds);
			for (const a of data.attendances) {
				if (!nextSeen.has(a.attendanceId)) {
					next.push(a);
					nextSeen.add(a.attendanceId);
				}
			}
			setSeenIds(nextSeen);
			return next;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [data]);

	const nextCursor = data?.nextCursor ?? null;

	return (
		<div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
			<div className="mb-3 flex items-center justify-between">
				<h4 className="flex items-center gap-2 font-semibold text-[var(--foreground)] text-sm">
					<CalendarDays size={14} />
					Attendance History
				</h4>
			</div>

			{isLoading && accumulated.length === 0 ? (
				<p className="text-[var(--muted-foreground)] text-xs">Loading...</p>
			) : accumulated.length === 0 ? (
				<p className="text-[var(--muted-foreground)] text-xs">
					No attendance records yet.
				</p>
			) : (
				<div className="space-y-2">
					{accumulated.map((a) => (
						<div
							key={a.attendanceId}
							className="rounded border border-[var(--border)] p-2 text-sm"
						>
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<p className="font-medium text-[var(--foreground)]">
										{a.event
											? a.event.title
											: "General facility check-in"}
									</p>
									<p className="text-[var(--muted-foreground)] text-xs">
										{dayjs(a.checkedInAt).format(
											"ddd, MMM D YYYY · h:mm A",
										)}
									</p>
									<p className="text-[var(--muted-foreground)] text-xs">
										{a.facility.name}
									</p>
								</div>
								<span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[var(--muted-foreground)] text-xs">
									{SOURCE_LABEL[a.source] ?? a.source}
								</span>
							</div>
							{a.notes && (
								<p className="mt-1 whitespace-pre-wrap text-[var(--muted-foreground)] text-xs">
									{a.notes}
								</p>
							)}
						</div>
					))}

					{nextCursor && (
						<div className="flex justify-center pt-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setCursor(nextCursor)}
								disabled={isFetching}
							>
								{isFetching ? "Loading..." : "Load more"}
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
