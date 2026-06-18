/**
 * Shared helper for sending an event registration confirmation email.
 *
 * Fires after a registration is committed (both self-serve and staff-registered).
 * No invoice is involved — this is a simple "you're confirmed" notification.
 *
 * Caller responsibilities:
 *   - Call AFTER the DB transaction commits (fire-and-forget pattern).
 *   - Wrap in try/catch so email failure does not affect the registration.
 *
 * Returns:
 *   { kind: "sent",    sentTo: string }  — email dispatched
 *   { kind: "skipped", reason: string }  — no-op (missing email)
 */

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import dayjs from "~/lib/dayjs-config";
import {
	getFromAddress,
	getResendClient,
} from "~/server/services/email/resend";
import { escapeHtml } from "~/server/utils/escapeHtml";

export type SendRegistrationEmailResult =
	| { kind: "sent"; sentTo: string }
	| { kind: "skipped"; reason: string };

/**
 * Send a "you're registered" confirmation email for `registrationId`.
 *
 * For recurring events `instanceDate` is used as the display date; for
 * non-recurring events `event.start` is used. The facility timezone
 * is applied for date/time formatting when available, otherwise UTC.
 */
export async function sendRegistrationConfirmationEmail(
	db: PrismaClient,
	registrationId: string,
): Promise<SendRegistrationEmailResult> {
	const registration = await db.eventRegistration.findUnique({
		where: { registrationId },
		select: {
			registrationId: true,
			instanceDate: true,
			user: {
				select: {
					firstName: true,
					lastName: true,
					email: true,
				},
			},
			event: {
				select: {
					title: true,
					start: true,
					end: true,
					club: { select: { clubName: true } },
					facility: { select: { timezone: true } },
				},
			},
		},
	});

	if (!registration) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Registration not found",
		});
	}

	if (!registration.user.email) {
		return {
			kind: "skipped",
			reason: "Registrant does not have an email address on file",
		};
	}

	const { user, event } = registration;
	const tz = event.facility?.timezone ?? "UTC";

	// Recurring events carry a specific instanceDate; fall back to event.start.
	const displayStart = registration.instanceDate ?? event.start;
	const durationMs = event.end.getTime() - event.start.getTime();
	const displayEnd = new Date(displayStart.getTime() + durationMs);

	const dateStr = dayjs(displayStart).tz(tz).format("dddd, MMMM D, YYYY");
	const startTimeStr = dayjs(displayStart).tz(tz).format("h:mm A");
	const endTimeStr = dayjs(displayEnd).tz(tz).format("h:mm A z");

	const recipientName =
		`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "there";
	const clubName = event.club.clubName;

	const subject = `You're registered for ${event.title}`;
	const bodyHtml = [
		`<p>Hi ${escapeHtml(recipientName)},</p>`,
		`<p>Your registration is confirmed for:</p>`,
		`<p><strong>${escapeHtml(event.title)}</strong><br/>${escapeHtml(dateStr)}<br/>${escapeHtml(startTimeStr)} – ${escapeHtml(endTimeStr)}</p>`,
		`<p>Thank you,<br/>${escapeHtml(clubName)}</p>`,
	].join("\n");
	const bodyText = [
		`Hi ${recipientName},`,
		``,
		`Your registration is confirmed for:`,
		`  ${event.title}`,
		`  ${dateStr}`,
		`  ${startTimeStr} – ${endTimeStr}`,
		``,
		`Thank you,`,
		clubName,
	].join("\n");

	const resend = await getResendClient();
	const from = await getFromAddress({ firstName: null, lastName: null });

	const { error } = await resend.emails.send({
		from,
		to: [registration.user.email],
		subject,
		html: bodyHtml,
		text: bodyText,
	});

	if (error) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to send registration email: ${error.message}`,
		});
	}

	console.log(
		`[registrationEmail] confirmation sent for registration ${registrationId} to ${registration.user.email}`,
	);
	return { kind: "sent", sentTo: registration.user.email };
}

/**
 * Send a cancellation notice for `registrationId`.
 *
 * Same calling contract as `sendRegistrationConfirmationEmail` — call after
 * the cancellation transaction commits, fire-and-forget.
 */
export async function sendRegistrationCancellationEmail(
	db: PrismaClient,
	registrationId: string,
): Promise<SendRegistrationEmailResult> {
	const registration = await db.eventRegistration.findUnique({
		where: { registrationId },
		select: {
			registrationId: true,
			instanceDate: true,
			user: {
				select: {
					firstName: true,
					lastName: true,
					email: true,
				},
			},
			event: {
				select: {
					title: true,
					start: true,
					end: true,
					club: { select: { clubName: true } },
					facility: { select: { timezone: true } },
				},
			},
		},
	});

	if (!registration) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Registration not found",
		});
	}

	if (!registration.user.email) {
		return {
			kind: "skipped",
			reason: "Registrant does not have an email address on file",
		};
	}

	const { user, event } = registration;
	const tz = event.facility?.timezone ?? "UTC";

	const displayStart = registration.instanceDate ?? event.start;
	const durationMs = event.end.getTime() - event.start.getTime();
	const displayEnd = new Date(displayStart.getTime() + durationMs);

	const dateStr = dayjs(displayStart).tz(tz).format("dddd, MMMM D, YYYY");
	const startTimeStr = dayjs(displayStart).tz(tz).format("h:mm A");
	const endTimeStr = dayjs(displayEnd).tz(tz).format("h:mm A z");

	const recipientName =
		`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "there";
	const clubName = event.club.clubName;

	const subject = `Your registration for ${event.title} has been cancelled`;
	const bodyHtml = [
		`<p>Hi ${escapeHtml(recipientName)},</p>`,
		`<p>Your registration has been cancelled for:</p>`,
		`<p><strong>${escapeHtml(event.title)}</strong><br/>${escapeHtml(dateStr)}<br/>${escapeHtml(startTimeStr)} – ${escapeHtml(endTimeStr)}</p>`,
		`<p>If you have any questions, please contact ${escapeHtml(clubName)}.</p>`,
	].join("\n");
	const bodyText = [
		`Hi ${recipientName},`,
		``,
		`Your registration has been cancelled for:`,
		`  ${event.title}`,
		`  ${dateStr}`,
		`  ${startTimeStr} – ${endTimeStr}`,
		``,
		`If you have any questions, please contact ${clubName}.`,
	].join("\n");

	const resend = await getResendClient();
	const from = await getFromAddress({ firstName: null, lastName: null });

	const { error } = await resend.emails.send({
		from,
		to: [registration.user.email],
		subject,
		html: bodyHtml,
		text: bodyText,
	});

	if (error) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to send cancellation email: ${error.message}`,
		});
	}

	console.log(
		`[registrationEmail] cancellation sent for registration ${registrationId} to ${registration.user.email}`,
	);
	return { kind: "sent", sentTo: registration.user.email };
}
