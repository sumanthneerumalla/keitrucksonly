import { RentalBookingStatus } from "@prisma/client";
import type { Prisma, User } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { RRule, RRuleSet } from "rrule";
import { z } from "zod";
import {
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { getCurrentUser, isFacilityOrAbove } from "~/server/utils/utils";
import { checkResourceConflicts } from "~/server/utils/resourceConflicts";

// ============================================================
// SHARED HELPERS
// ============================================================

/**
 * Build an RRuleSet from a stored rrule string + exdates + fallback dtstart.
 * Using RRuleSet (not bare RRule) is important so `.between()` honors exdates —
 * without it, occurrences on excepted dates show up as still-valid, which breaks
 * both display (listRentalWindows) and safety checks (updateRentalWindow orphan guard).
 */
function buildRuleSetFromEvent(
	rruleString: string,
	exdates: Date[],
	fallbackDtstart: Date,
): RRuleSet {
	const parsed = RRule.fromString(rruleString);
	const rule = new RRule({
		...parsed.origOptions,
		dtstart: parsed.origOptions.dtstart ?? fallbackDtstart,
	});
	const set = new RRuleSet();
	set.rrule(rule);
	for (const d of exdates) set.exdate(d);
	return set;
}

// NOTE: structured as per-court helper for future multi-court extension (decision #77)
async function validateAndCreateBooking(
	tx: Prisma.TransactionClient,
	params: {
		rentalWindowEventId: string;
		resourceId: string;
		startTime: Date;
		endTime: Date;
		user: User;
	},
) {
	const { rentalWindowEventId, resourceId, startTime, endTime, user } = params;

	// 0. Advisory lock on the rental window for the duration of this transaction.
	// Prevents a concurrent deleteRentalWindow from soft-deleting the window between
	// our isDeleted check below and the booking insert. pg_advisory_xact_lock takes a
	// bigint — we derive it from md5(eventId) for lower collision risk than hashtext()
	// (64 bits of entropy vs ~32). Lock is scoped to the window, not the user, so
	// two members booking different slots in the same window serialize (acceptable)
	// while members in different windows don't (no false contention).
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${rentalWindowEventId}), 1, 16))::bit(64)::bigint)`;

	// 1. Fetch rental window and verify it's a RENTAL_WINDOW in the user's club
	const rentalWindowEvent = await tx.calendarEvent.findUnique({
		where: { eventId: rentalWindowEventId },
	});

	if (
		!rentalWindowEvent ||
		rentalWindowEvent.isDeleted ||
		rentalWindowEvent.eventType !== "RENTAL_WINDOW" ||
		rentalWindowEvent.clubShortName !== user.clubShortName
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid rental window.",
		});
	}

	// 2. Verify resourceId is one of the window's courts
	if (!rentalWindowEvent.resourceIds.includes(resourceId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Court is not part of this rental window.",
		});
	}

	// 3. Verify start/end align to :00 or :30 boundaries
	if (
		(startTime.getMinutes() !== 0 && startTime.getMinutes() !== 30) ||
		startTime.getSeconds() !== 0 ||
		startTime.getMilliseconds() !== 0 ||
		(endTime.getMinutes() !== 0 && endTime.getMinutes() !== 30) ||
		endTime.getSeconds() !== 0 ||
		endTime.getMilliseconds() !== 0
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Booking times must align to :00 or :30 boundaries with no seconds or milliseconds.",
		});
	}

	// 4. Duration >= 1 hour
	const durationMs = endTime.getTime() - startTime.getTime();
	if (durationMs < 3600000) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Booking must be at least 1 hour.",
		});
	}

	// 5. Duration <= maxBookingHours
	const maxBookingHours = rentalWindowEvent.maxBookingHours ?? 2;
	if (durationMs > maxBookingHours * 3600000) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Booking cannot exceed ${maxBookingHours} hour(s).`,
		});
	}

	// 6. Booking within window bounds
	if (startTime < rentalWindowEvent.start || endTime > rentalWindowEvent.end) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Booking must be within the rental window time range.",
		});
	}

	// 7. No blocking event conflicts on the resource
	const conflicts = await checkResourceConflicts({
		db: tx,
		resourceId,
		start: startTime,
		end: endTime,
	});
	if (conflicts.length > 0) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Time slot is already booked or blocked.",
		});
	}

	// 8. Member doesn't already have an overlapping confirmed booking on same court
	const existingBooking = await tx.rentalBooking.findFirst({
		where: {
			resourceId,
			userId: user.userId,
			status: RentalBookingStatus.CONFIRMED,
			startTime: { lt: endTime },
			endTime: { gt: startTime },
		},
	});
	if (existingBooking) {
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"You already have an overlapping booking on this court.",
		});
	}

	// Create blocking CalendarEvent
	const eventId = crypto.randomUUID();
	const uid = `${eventId}@facilitypresence.com`;
	await tx.calendarEvent.create({
		data: {
			eventId,
			clubShortName: user.clubShortName,
			resourceId,
			facilityId: rentalWindowEvent.facilityId,
			resourceIds: [],
			title: `Rental — ${user.firstName} ${(user.lastName ?? "").charAt(0)}.`,
			start: startTime,
			end: endTime,
			uid,
			eventType: "RENTAL_BOOKING",
			isBlocking: true,
			isPublic: false,
			createdByUserId: user.userId,
		},
	});

	// Create RentalBooking
	const booking = await tx.rentalBooking.create({
		data: {
			blockingEventId: eventId,
			rentalWindowEventId,
			resourceId,
			userId: user.userId,
			clubShortName: user.clubShortName,
			facilityId: rentalWindowEvent.facilityId,
			startTime,
			endTime,
			status: RentalBookingStatus.CONFIRMED,
		},
		include: {
			rentalWindowEvent: true,
			resource: true,
			blockingEvent: true,
			facility: true,
			user: {
				select: {
					userId: true,
					firstName: true,
					lastName: true,
				},
			},
		},
	});

	return booking;
}

// ============================================================
// ROUTER
// ============================================================

export const rentalsRouter = createTRPCRouter({
	// -------------------------------------------------------
	// 1. createRentalWindow — facilityProcedure (mutation)
	// -------------------------------------------------------
	createRentalWindow: facilityProcedure
		.input(
			z.object({
				facilityId: z.string(),
				title: z.string(),
				start: z.date(),
				end: z.date(),
				courtIds: z.array(z.string()).min(1),
				maxBookingHours: z.number().int().positive().optional(),
				earlyCancelCutoffHours: z
					.number()
					.int()
					.nonnegative()
					.nullable()
					.optional(),
				rrule: z.string().optional(),
				color: z.string().optional(),
				backgroundColor: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { user } = ctx;
			const {
				facilityId,
				title,
				start,
				end,
				courtIds,
				maxBookingHours,
				earlyCancelCutoffHours,
				rrule,
				color,
				backgroundColor,
			} = input;

			// Verify all courtIds belong to the facility + user's club
			const courts = await ctx.db.clubResource.findMany({
				where: {
					resourceId: { in: courtIds },
					facilityId,
					clubShortName: user.clubShortName,
				},
			});
			if (courts.length !== courtIds.length) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"One or more courts do not belong to this facility or club.",
				});
			}

			// TODO: validate against overlapping rental windows on same courts/times (decision #75)

			const eventId = crypto.randomUUID();
			const uid = `${eventId}@facilitypresence.com`;

			const event = await ctx.db.calendarEvent.create({
				data: {
					eventId,
					clubShortName: user.clubShortName,
					resourceId: courtIds[0],
					facilityId,
					resourceIds: courtIds,
					title,
					start,
					end,
					uid,
					eventType: "RENTAL_WINDOW",
					isBlocking: false,
					isPublic: true,
					maxBookingHours: maxBookingHours ?? 2,
					earlyCancelCutoffHours: earlyCancelCutoffHours ?? null,
					rrule: rrule ?? null,
					color: color ?? null,
					backgroundColor: backgroundColor ?? null,
					createdByUserId: user.userId,
				},
			});

			return event;
		}),

	// -------------------------------------------------------
	// 2. updateRentalWindow — facilityProcedure (mutation)
	// -------------------------------------------------------
	updateRentalWindow: facilityProcedure
		.input(
			z.object({
				eventId: z.string(),
				title: z.string().optional(),
				start: z.date().optional(),
				end: z.date().optional(),
				courtIds: z.array(z.string()).min(1).optional(),
				maxBookingHours: z.number().int().positive().optional(),
				earlyCancelCutoffHours: z
					.number()
					.int()
					.nonnegative()
					.nullable()
					.optional(),
				rrule: z.string().optional(),
				color: z.string().optional(),
				backgroundColor: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { user } = ctx;
			const {
				eventId,
				title,
				start,
				end,
				courtIds,
				maxBookingHours,
				earlyCancelCutoffHours,
				rrule,
				color,
				backgroundColor,
			} = input;

			// Fetch event and verify
			const event = await ctx.db.calendarEvent.findUnique({
				where: { eventId },
			});
			if (
				!event ||
				event.isDeleted ||
				event.eventType !== "RENTAL_WINDOW" ||
				event.clubShortName !== user.clubShortName
			) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Rental window not found.",
				});
			}

			// If courtIds provided, verify they belong to facility + club
			if (courtIds) {
				const courts = await ctx.db.clubResource.findMany({
					where: {
						resourceId: { in: courtIds },
						facilityId: event.facilityId,
						clubShortName: user.clubShortName,
					},
				});
				if (courts.length !== courtIds.length) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"One or more courts do not belong to this facility or club.",
					});
				}
			}

			// Orphan guard: if start/end/rrule change, make sure no future confirmed
			// booking would end up outside every occurrence of the new schedule. Reject
			// with a specific date list so staff can cancel the affected bookings first.
			const startChanged =
				start !== undefined && start.getTime() !== event.start.getTime();
			const endChanged =
				end !== undefined && end.getTime() !== event.end.getTime();
			const rruleChanged = rrule !== undefined && rrule !== event.rrule;

			if (startChanged || endChanged || rruleChanged) {
				const newStart = start ?? event.start;
				const newEnd = end ?? event.end;
				const newRrule = rrule !== undefined ? rrule : event.rrule;
				const newDurationMs = newEnd.getTime() - newStart.getTime();

				// Build the NEW schedule as an RRuleSet so exdates are respected. Rental
				// windows don't expose exdate editing today, so we carry over the event's
				// existing exdates — a date excluded in the old series stays excluded.
				let newRuleSet: RRuleSet | null = null;
				if (newRrule) {
					try {
						newRuleSet = buildRuleSetFromEvent(
							newRrule,
							event.exdates,
							newStart,
						);
					} catch {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Invalid recurrence pattern.",
						});
					}
				}

				const futureBookings = await ctx.db.rentalBooking.findMany({
					where: {
						rentalWindowEventId: eventId,
						status: RentalBookingStatus.CONFIRMED,
						startTime: { gte: new Date() },
					},
					select: { bookingId: true, startTime: true, endTime: true },
				});

				const orphanedStarts: Date[] = [];
				for (const b of futureBookings) {
					let covered = false;
					if (!newRuleSet) {
						// Non-recurring after update: single occurrence == the base window.
						covered =
							b.startTime >= newStart && b.endTime <= newEnd;
					} else {
						// Look one duration back so we catch occurrences that start before
						// the booking but still contain it.
						const candidates = newRuleSet.between(
							new Date(b.startTime.getTime() - newDurationMs),
							b.endTime,
							true,
						);
						covered = candidates.some((occStart) => {
							const occEnd = new Date(occStart.getTime() + newDurationMs);
							return b.startTime >= occStart && b.endTime <= occEnd;
						});
					}
					if (!covered) orphanedStarts.push(b.startTime);
				}

				if (orphanedStarts.length > 0) {
					const preview = orphanedStarts
						.slice(0, 3)
						.map((d) => d.toISOString())
						.join(", ");
					const suffix =
						orphanedStarts.length > 3
							? ` and ${orphanedStarts.length - 3} more`
							: "";
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Cannot apply changes: ${orphanedStarts.length} future booking(s) would be orphaned (${preview}${suffix}). Cancel those bookings first.`,
					});
				}
			}

			const updated = await ctx.db.calendarEvent.update({
				where: { eventId },
				data: {
					...(title !== undefined && { title }),
					...(start !== undefined && { start }),
					...(end !== undefined && { end }),
					...(courtIds !== undefined && {
						resourceId: courtIds[0],
						resourceIds: courtIds,
					}),
					...(maxBookingHours !== undefined && { maxBookingHours }),
					...(earlyCancelCutoffHours !== undefined && {
						earlyCancelCutoffHours,
					}),
					...(rrule !== undefined && { rrule }),
					...(color !== undefined && { color }),
					...(backgroundColor !== undefined && { backgroundColor }),
				},
			});

			return updated;
		}),

	// -------------------------------------------------------
	// 3. deleteRentalWindow — facilityProcedure (mutation)
	// -------------------------------------------------------
	deleteRentalWindow: facilityProcedure
		.input(z.object({ eventId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { user } = ctx;
			const { eventId } = input;

			await ctx.db.$transaction(async (tx) => {
				// Fetch and verify
				const event = await tx.calendarEvent.findUnique({
					where: { eventId },
				});
				if (
					!event ||
					event.isDeleted ||
					event.eventType !== "RENTAL_WINDOW" ||
					event.clubShortName !== user.clubShortName
				) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Rental window not found.",
					});
				}

				// Find all confirmed bookings for this window
				const bookings = await tx.rentalBooking.findMany({
					where: {
						rentalWindowEventId: eventId,
						status: RentalBookingStatus.CONFIRMED,
					},
					include: { blockingEvent: true },
				});

				// Cancel each booking and soft-delete its blocking calendar event.
				// Soft-delete (not just isBlocking=false) is canonical — isDeleted is what
				// every other query filters on, and leaving the event "visible but unblocking"
				// creates two sources of truth that drift.
				for (const booking of bookings) {
					await tx.rentalBooking.update({
						where: { bookingId: booking.bookingId },
						data: { status: RentalBookingStatus.CANCELLED },
					});
					if (booking.blockingEventId) {
						await tx.calendarEvent.update({
							where: { eventId: booking.blockingEventId },
							data: {
								isBlocking: false,
								isDeleted: true,
								deletedAt: new Date(),
							},
						});
					}
				}

				// Soft-delete the rental window
				await tx.calendarEvent.update({
					where: { eventId },
					data: { isDeleted: true, deletedAt: new Date() },
				});
			});
		}),

	// -------------------------------------------------------
	// 4. listRentalWindows — publicProcedure (query)
	// -------------------------------------------------------
	listRentalWindows: publicProcedure
		.input(
			z.object({
				clubShortName: z.string(),
				facilityId: z.string().optional(),
				date: z.date(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { clubShortName, facilityId, date } = input;

			// Compute start/end of day
			const dayStart = new Date(date);
			dayStart.setHours(0, 0, 0, 0);
			const dayEnd = new Date(date);
			dayEnd.setHours(23, 59, 59, 999);

			// Fetch base events: non-recurring that overlap the day, OR any recurring
			// base whose series starts before dayEnd (expansion filtering happens below).
			const windows = await ctx.db.calendarEvent.findMany({
				where: {
					eventType: "RENTAL_WINDOW",
					isDeleted: false,
					clubShortName,
					...(facilityId && { facilityId }),
					parentEventId: null,
					OR: [
						{ rrule: null, start: { lt: dayEnd }, end: { gt: dayStart } },
						{ rrule: { not: null }, start: { lt: dayEnd } },
					],
				},
				include: {
					resource: { select: { resourceId: true, title: true } },
					_count: {
						select: {
							// Per-day count: only bookings whose startTime falls on the selected day.
							// For a recurring window, _count otherwise aggregates across all occurrences
							// which is misleading in a date-filtered list.
							rentalWindowBookings: {
								where: {
									status: RentalBookingStatus.CONFIRMED,
									startTime: { gte: dayStart, lt: dayEnd },
								},
							},
						},
					},
				},
			});

			// Expand recurring events: for each base, find occurrences that overlap the day.
			// Non-recurring events become a single "occurrence" equal to their base times.
			type ExpandedRow = {
				base: (typeof windows)[number];
				occurrenceStart: Date;
				occurrenceEnd: Date;
			};
			const expanded: ExpandedRow[] = [];

			for (const w of windows) {
				const durationMs = w.end.getTime() - w.start.getTime();
				if (!w.rrule) {
					expanded.push({
						base: w,
						occurrenceStart: w.start,
						occurrenceEnd: w.end,
					});
					continue;
				}
				try {
					// RRuleSet honors exdates so excluded instances don't surface as rows.
					// Rrule strings in this codebase typically omit DTSTART — anchor to w.start.
					const ruleSet = buildRuleSetFromEvent(w.rrule, w.exdates, w.start);
					// Look back by one occurrence duration to catch occurrences that start before
					// dayStart but extend into the day.
					const candidates = ruleSet.between(
						new Date(dayStart.getTime() - durationMs),
						dayEnd,
						true,
					);
					for (const occStart of candidates) {
						const occEnd = new Date(occStart.getTime() + durationMs);
						if (occStart < dayEnd && occEnd > dayStart) {
							expanded.push({
								base: w,
								occurrenceStart: occStart,
								occurrenceEnd: occEnd,
							});
						}
					}
				} catch {
					// Malformed rrule — skip this window rather than fail the whole query.
				}
			}

			// Fetch court details for all resourceIds across windows.
			// Scope by clubShortName too — defense in depth on a public endpoint so
			// attackers can't probe titles by guessing resourceIds across tenants.
			// Filter by isActive so deactivated courts don't surface as ghost entries;
			// CalendarEvent.resourceIds is an unconstrained String[] that can hold stale IDs.
			const allResourceIds = [
				...new Set(expanded.flatMap((r) => r.base.resourceIds)),
			];
			const courts = await ctx.db.clubResource.findMany({
				where: {
					resourceId: { in: allResourceIds },
					clubShortName,
					isActive: true,
				},
				select: { resourceId: true, title: true },
			});
			const courtMap = new Map(courts.map((c) => [c.resourceId, c.title]));

			return expanded.map(({ base: w, occurrenceStart, occurrenceEnd }) => ({
				eventId: w.eventId,
				title: w.title,
				// start/end are the OCCURRENCE times (what the user sees on the row).
				start: occurrenceStart,
				end: occurrenceEnd,
				// baseStart/baseEnd are the series anchor — needed by the edit flow so
				// a no-op save doesn't shift the series (updateRentalWindow rewrites base).
				baseStart: w.start,
				baseEnd: w.end,
				facilityId: w.facilityId,
				maxBookingHours: w.maxBookingHours,
				earlyCancelCutoffHours: w.earlyCancelCutoffHours,
				bookingCount: w._count.rentalWindowBookings,
				isRecurring: w.rrule !== null,
				// Filter stale / deactivated court IDs out of the response rather than
				// rendering "Unknown Court" placeholders.
				courts: w.resourceIds
					.filter((rid) => courtMap.has(rid))
					.map((rid) => ({
						resourceId: rid,
						title: courtMap.get(rid) ?? "Unknown Court",
					})),
			}));
		}),

	// -------------------------------------------------------
	// 5. getRentalAvailability — publicProcedure (query)
	// -------------------------------------------------------
	getRentalAvailability: publicProcedure
		.input(z.object({ rentalWindowEventId: z.string() }))
		.query(async ({ ctx, input }) => {
			const { rentalWindowEventId } = input;

			// Fetch the RENTAL_WINDOW event
			const windowEvent = await ctx.db.calendarEvent.findUnique({
				where: { eventId: rentalWindowEventId },
			});
			if (
				!windowEvent ||
				windowEvent.isDeleted ||
				windowEvent.eventType !== "RENTAL_WINDOW"
			) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Rental window not found.",
				});
			}

			// Fetch court details
			const courtIds = windowEvent.resourceIds;
			const courts = await ctx.db.clubResource.findMany({
				where: { resourceId: { in: courtIds } },
				select: { resourceId: true, title: true },
			});

			// Generate half-hour slots from window start to end
			const slots: Array<{ startTime: Date; endTime: Date }> = [];
			let slotStart = new Date(windowEvent.start);
			while (slotStart.getTime() < windowEvent.end.getTime()) {
				const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
				if (slotEnd.getTime() <= windowEvent.end.getTime()) {
					slots.push({ startTime: new Date(slotStart), endTime: slotEnd });
				}
				slotStart = slotEnd;
			}

			// Query confirmed bookings for this window
			const bookings = await ctx.db.rentalBooking.findMany({
				where: {
					rentalWindowEventId,
					status: RentalBookingStatus.CONFIRMED,
				},
				select: {
					bookingId: true,
					resourceId: true,
					userId: true,
					startTime: true,
					endTime: true,
				},
			});

			// Optionally resolve the caller's userId for annotation
			let callerUserId: string | undefined;
			const clerkUserId = ctx.auth?.userId;
			if (clerkUserId) {
				const callerUser = await ctx.db.user.findUnique({
					where: { clerkUserId },
					select: { userId: true },
				});
				callerUserId = callerUser?.userId;
			}

			// For each court, check blocking events and build slot availability
			const result = await Promise.all(
				courts.map(async (court) => {
					const blockingEvents = await checkResourceConflicts({
						db: ctx.db,
						resourceId: court.resourceId,
						start: windowEvent.start,
						end: windowEvent.end,
					});

					const courtBookings = bookings.filter(
						(b) => b.resourceId === court.resourceId,
					);

					const courtSlots = slots.map((slot) => {
						// Check if any blocking event overlaps this slot
						const isBlocked = blockingEvents.some(
							(e) =>
								e.start.getTime() < slot.endTime.getTime() &&
								e.end.getTime() > slot.startTime.getTime(),
						);

						// Check if a confirmed booking overlaps this slot
						const overlappingBooking = courtBookings.find(
							(b) =>
								b.startTime.getTime() < slot.endTime.getTime() &&
								b.endTime.getTime() > slot.startTime.getTime(),
						);

						const isAvailable = !isBlocked && !overlappingBooking;

						const slotResult: {
							startTime: string;
							endTime: string;
							isAvailable: boolean;
							bookingId?: string;
						} = {
							startTime: slot.startTime.toISOString(),
							endTime: slot.endTime.toISOString(),
							isAvailable,
						};

						// Annotate with bookingId if caller owns this booking
						if (
							overlappingBooking &&
							callerUserId &&
							overlappingBooking.userId === callerUserId
						) {
							slotResult.bookingId = overlappingBooking.bookingId;
						}

						return slotResult;
					});

					return {
						courtId: court.resourceId,
						courtName: court.title,
						slots: courtSlots,
					};
				}),
			);

			return result;
		}),

	// -------------------------------------------------------
	// 6. bookRentalSlot — protectedProcedure (mutation)
	// -------------------------------------------------------
	bookRentalSlot: protectedProcedure
		.input(
			z.object({
				rentalWindowEventId: z.string(),
				resourceId: z.string(),
				startTime: z.date(),
				endTime: z.date(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			const booking = await ctx.db.$transaction(async (tx) => {
				return validateAndCreateBooking(tx, {
					rentalWindowEventId: input.rentalWindowEventId,
					resourceId: input.resourceId,
					startTime: input.startTime,
					endTime: input.endTime,
					user,
				});
			});

			return booking;
		}),

	// -------------------------------------------------------
	// 7. cancelRentalBooking — protectedProcedure (mutation)
	// -------------------------------------------------------
	cancelRentalBooking: protectedProcedure
		.input(z.object({ bookingId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const { bookingId } = input;

			const booking = await ctx.db.rentalBooking.findUnique({
				where: { bookingId },
				include: {
					rentalWindowEvent: true,
					blockingEvent: true,
				},
			});

			if (!booking) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Booking not found.",
				});
			}

			// Club check BEFORE any state or ownership reveal — return NOT_FOUND so
			// attackers can't distinguish "wrong club" from "nonexistent booking".
			if (booking.clubShortName !== user.clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Booking not found.",
				});
			}

			if (booking.status !== RentalBookingStatus.CONFIRMED) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only confirmed bookings can be cancelled.",
				});
			}

			// Ownership check (decision #61): owner or staff bypass
			const isStaff = isFacilityOrAbove(user);
			if (booking.userId !== user.userId && !isStaff) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only cancel your own bookings.",
				});
			}

			// Past-booking guard (members only): a booking that has already ended
			// cannot be cancelled — it's historical. Staff bypass for audit/admin cleanup.
			if (!isStaff && new Date() > booking.endTime) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This booking has already ended and cannot be cancelled.",
				});
			}

			// Cancellation cutoff (decision #74): members only
			if (!isStaff && booking.rentalWindowEvent.earlyCancelCutoffHours != null) {
				const cutoffMs =
					booking.rentalWindowEvent.earlyCancelCutoffHours * 3600000;
				const cutoffTime = new Date(
					booking.startTime.getTime() - cutoffMs,
				);
				if (new Date() > cutoffTime) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Cancellation window has passed.",
					});
				}
			}

			await ctx.db.$transaction(async (tx) => {
				await tx.rentalBooking.update({
					where: { bookingId },
					data: { status: RentalBookingStatus.CANCELLED },
				});
				// Soft-delete the blocking CalendarEvent too, not just flip isBlocking.
				// Otherwise two sources of truth drift: RentalBooking.status=CANCELLED but
				// the CalendarEvent remains visible on any query that doesn't filter isBlocking.
				if (booking.blockingEventId) {
					await tx.calendarEvent.update({
						where: { eventId: booking.blockingEventId },
						data: {
							isBlocking: false,
							isDeleted: true,
							deletedAt: new Date(),
						},
					});
				}
			});

			return { bookingId, status: RentalBookingStatus.CANCELLED };
		}),

	// -------------------------------------------------------
	// 8. listMemberBookings — protectedProcedure (query)
	// -------------------------------------------------------
	listMemberBookings: protectedProcedure
		.input(
			z
				.object({
					upcoming: z.boolean().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			const where: {
				userId: string;
				clubShortName: string;
				startTime?: { gte: Date };
				status?: RentalBookingStatus;
			} = {
				userId: user.userId,
				clubShortName: user.clubShortName,
			};

			if (input?.upcoming) {
				where.startTime = { gte: new Date() };
				where.status = RentalBookingStatus.CONFIRMED;
			}

			const bookings = await ctx.db.rentalBooking.findMany({
				where,
				include: {
					rentalWindowEvent: { select: { title: true } },
					resource: { select: { resourceId: true, title: true } },
					facility: { select: { facilityId: true, name: true } },
				},
				orderBy: { startTime: "asc" },
			});

			return bookings;
		}),

	// -------------------------------------------------------
	// 9. listFacilityBookings — facilityProcedure (query)
	// -------------------------------------------------------
	listFacilityBookings: facilityProcedure
		.input(
			z.object({
				facilityId: z.string(),
				date: z.date(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { user } = ctx;
			const { facilityId, date } = input;

			const dayStart = new Date(date);
			dayStart.setHours(0, 0, 0, 0);
			const dayEnd = new Date(date);
			dayEnd.setHours(23, 59, 59, 999);

			const bookings = await ctx.db.rentalBooking.findMany({
				where: {
					facilityId,
					clubShortName: user.clubShortName,
					startTime: { lt: dayEnd },
					endTime: { gt: dayStart },
				},
				include: {
					user: {
						select: {
							userId: true,
							firstName: true,
							lastName: true,
						},
					},
					resource: { select: { resourceId: true, title: true } },
					rentalWindowEvent: { select: { title: true } },
				},
				orderBy: { startTime: "asc" },
			});

			return bookings;
		}),

	// -------------------------------------------------------
	// 10. getRentalWindowById — facilityProcedure (query)
	// -------------------------------------------------------
	getRentalWindowById: facilityProcedure
		.input(z.object({ eventId: z.string() }))
		.query(async ({ ctx, input }) => {
			const { user } = ctx;
			const { eventId } = input;

			const event = await ctx.db.calendarEvent.findUnique({
				where: { eventId },
			});

			if (
				!event ||
				event.isDeleted ||
				event.eventType !== "RENTAL_WINDOW" ||
				event.clubShortName !== user.clubShortName
			) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Rental window not found.",
				});
			}

			const courts = await ctx.db.clubResource.findMany({
				where: { resourceId: { in: event.resourceIds } },
				select: { resourceId: true, title: true },
			});

			const bookings = await ctx.db.rentalBooking.findMany({
				where: { rentalWindowEventId: eventId },
				include: {
					user: {
						select: {
							userId: true,
							firstName: true,
							lastName: true,
							email: true,
						},
					},
					resource: { select: { resourceId: true, title: true } },
				},
				orderBy: { startTime: "asc" },
			});

			return {
				eventId: event.eventId,
				title: event.title,
				start: event.start,
				end: event.end,
				facilityId: event.facilityId,
				maxBookingHours: event.maxBookingHours,
				earlyCancelCutoffHours: event.earlyCancelCutoffHours,
				courts,
				bookings,
			};
		}),
});
