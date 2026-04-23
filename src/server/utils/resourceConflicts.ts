import type { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

/**
 * Checks for blocking event conflicts on a resource for a given time range.
 * Returns the conflicting events (non-recurring only — recurring conflicts are
 * handled client-side via rrule expansion; server-side recurring expansion is
 * reserved for the dedicated checkConflicts query procedure).
 */
export async function checkResourceConflicts({
	db,
	resourceId,
	start,
	end,
	excludeEventId,
}: {
	db: TxClient;
	resourceId: string;
	start: Date;
	end: Date;
	excludeEventId?: string;
}): Promise<Array<{ eventId: string; title: string; start: Date; end: Date }>> {
	return db.calendarEvent.findMany({
		where: {
			resourceId,
			isDeleted: false,
			isBlocking: true,
			rrule: null,
			eventId: excludeEventId ? { not: excludeEventId } : undefined,
			start: { lt: end },
			end: { gt: start },
		},
		select: {
			eventId: true,
			title: true,
			start: true,
			end: true,
		},
	});
}
