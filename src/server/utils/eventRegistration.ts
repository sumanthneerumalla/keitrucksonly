/**
 * Shared registration helpers — extracted from calendar.ts so that both
 * `registerForEvent` (self-serve, STUDENT-only) and `staffRegister` (staff
 * registers another member) use the same capacity/duplicate/credit-deduction
 * logic. See TD-2 in designFiles/roadmap/customer-feedback-ui-sprint.md.
 *
 * These helpers do NOT cover caller-specific authorization:
 *   - `registerForEvent` is responsible for its own STUDENT gate + public-event
 *     membership check.
 *   - `staffRegister` is responsible for the staff-vs-target same-club check.
 * Anything else (event existence, capacity, dup-check, tx body) lives here.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { RegistrationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { consumeCredit } from "./consumeCredit";

type TxClient = Prisma.TransactionClient;
type DbClient = PrismaClient | TxClient;

export type RegistrationSource =
	| "self_service"
	| "admin_dashboard"
	| "system";

/**
 * The shape returned by `assertRegistrable` — the event row with a `_count` of
 * active registrations already baked in. Callers use this in the tx body.
 */
export type RegistrableEvent = Awaited<
	ReturnType<typeof loadEventWithCount>
>;

async function loadEventWithCount(db: DbClient, eventId: string) {
	return db.calendarEvent.findUnique({
		where: { eventId, isDeleted: false },
		include: {
			_count: {
				select: {
					registrations: {
						where: {
							status: {
								in: [
									RegistrationStatus.REGISTERED,
									RegistrationStatus.CHECKED_IN,
								],
							},
						},
					},
				},
			},
		},
	});
}

/**
 * Validate that an event can be registered for by `userId`:
 *   - Event exists and is not a BLOCK
 *   - There is remaining capacity
 *   - The user does not already have an active REGISTERED row for this
 *     (eventId, instanceDate)
 *
 * Returns the event (with count) for the caller to pass into `createRegistrationTx`.
 * Throws TRPCError on any failure — use BAD_REQUEST messages tuned to whether the
 * caller is a student (`selfServe: true`) or staff.
 */
export async function assertRegistrable({
	db,
	eventId,
	userId,
	instanceDate,
	selfServe = false,
}: {
	db: DbClient;
	eventId: string;
	userId: string;
	instanceDate?: Date | null;
	selfServe?: boolean;
}): Promise<NonNullable<RegistrableEvent>> {
	const event = await loadEventWithCount(db, eventId);

	if (!event) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
	}

	if (event.eventType === "BLOCK") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Block events cannot be registered for",
		});
	}

	if (
		event.maxParticipants !== null &&
		event._count.registrations >= event.maxParticipants
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This event is fully booked",
		});
	}

	const existing = await db.eventRegistration.findFirst({
		where: {
			eventId,
			userId,
			status: RegistrationStatus.REGISTERED,
			instanceDate: instanceDate ?? null,
		},
	});

	if (existing) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: selfServe
				? "You are already registered for this event"
				: "This member is already registered for this event",
		});
	}

	return event;
}

/**
 * Transaction body: creates the EventRegistration, writes a
 * RegistrationStatusLog (oldStatus=null = initial-creation convention), and
 * attempts credit deduction when the event is product-linked with a creditCost.
 *
 * Credit deduction does not fail the registration — the member may owe an
 * invoice (Phase 9). Callers pass their own `tx` so the three writes are atomic
 * with any outer transaction.
 */
export async function createRegistrationTx({
	tx,
	event,
	userId,
	instanceDate,
	source,
	changedByUserId,
}: {
	tx: TxClient;
	event: NonNullable<RegistrableEvent>;
	userId: string;
	instanceDate?: Date | null;
	source: RegistrationSource;
	changedByUserId: string;
}) {
	const reg = await tx.eventRegistration.create({
		data: {
			eventId: event.eventId,
			userId,
			productId: event.productId ?? null,
			instanceDate: instanceDate ?? null,
			status: RegistrationStatus.REGISTERED,
		},
	});

	await tx.registrationStatusLog.create({
		data: {
			clubShortName: event.clubShortName,
			registrationId: reg.registrationId,
			userId,
			changedByUserId,
			oldStatus: null,
			newStatus: RegistrationStatus.REGISTERED,
			source,
		},
	});

	// Phase 8a: Attempt credit deduction. If no package matches or insufficient,
	// registration still succeeds — member owes money (invoice in Phase 9).
	// Skipped entirely for free events (productId=null) or non-credit events.
	if (event.productId && event.creditCost && event.creditCost > 0) {
		await consumeCredit({
			tx,
			userId,
			clubShortName: event.clubShortName,
			eventId: event.eventId,
			eventProductId: event.productId,
			creditCost: event.creditCost,
			registrationId: reg.registrationId,
		});
	}

	return reg;
}
