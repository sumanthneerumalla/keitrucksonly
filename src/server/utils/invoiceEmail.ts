/**
 * Shared helper for sending an invoice PDF by email.
 *
 * Used by `billing.sendInvoiceEmail` (manual staff trigger) and
 * `memberships.sell` (automatic post-sale send).
 *
 * Caller responsibilities:
 *   - Authorize the viewer/sender BEFORE calling (no permission checks here).
 *   - Wrap in try/catch when email failure must not affect the parent operation.
 *
 * Returns:
 *   { kind: "sent",    sentTo: string }  — email dispatched successfully
 *   { kind: "skipped", reason: string }  — no-op (voided invoice, missing email)
 */

import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
	getFromAddress,
	getResendClient,
} from "~/server/services/email/resend";
import { escapeHtml } from "~/server/utils/escapeHtml";
import { getOrRenderInvoicePdf } from "~/server/services/invoiceRenderer/getOrRender";

export type SendInvoiceEmailResult =
	| { kind: "sent"; sentTo: string }
	| { kind: "skipped"; reason: string };

/**
 * Render and email the invoice PDF for `invoiceId` to the appropriate recipient.
 *
 * Recipient resolution: billed-to user if a separate payer exists, otherwise
 * the consumer. `senderUserId` is used for the PDF audit trail and the "from"
 * display name; pass null for system/cron sends.
 */
export async function sendInvoiceEmailByInvoiceId(
	db: PrismaClient,
	invoiceId: string,
	senderUserId: string | null,
): Promise<SendInvoiceEmailResult> {
	const invoice = await db.invoice.findFirst({
		where: { invoiceId },
		select: {
			invoiceId: true,
			invoiceNumber: true,
			status: true,
			club: { select: { clubName: true } },
			user: {
				select: {
					userId: true,
					firstName: true,
					lastName: true,
					email: true,
				},
			},
			billedToUser: {
				select: {
					userId: true,
					firstName: true,
					lastName: true,
					email: true,
				},
			},
		},
	});

	if (!invoice) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
	}

	if (invoice.status === "void") {
		return { kind: "skipped", reason: "Invoice is voided" };
	}

	const hasSeparatePayer =
		invoice.billedToUser !== null &&
		invoice.billedToUser.userId !== invoice.user.userId;
	const recipient = hasSeparatePayer ? invoice.billedToUser : invoice.user;

	if (!recipient?.email) {
		return {
			kind: "skipped",
			reason: "Recipient does not have an email address on file",
		};
	}

	const { buffer, filename } = await getOrRenderInvoicePdf(
		invoice.invoiceId,
		senderUserId,
	);

	const resend = await getResendClient();

	const senderDisplay =
		senderUserId !== null
			? await db.user.findUnique({
					where: { userId: senderUserId },
					select: { firstName: true, lastName: true },
				})
			: null;

	const from = await getFromAddress(
		senderDisplay ?? { firstName: null, lastName: null },
	);

	const recipientName =
		`${recipient.firstName ?? ""} ${recipient.lastName ?? ""}`.trim() ||
		"there";
	const clubName = invoice.club.clubName;

	const subject = `Invoice ${invoice.invoiceNumber} from ${clubName}`;
	const bodyHtml = `<p>Hi ${escapeHtml(recipientName)},</p><p>Please find your invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> attached.</p><p>Thank you,<br/>${escapeHtml(clubName)}</p>`;
	const bodyText = `Hi ${recipientName},\n\nPlease find your invoice ${invoice.invoiceNumber} attached.\n\nThank you,\n${clubName}`;

	const { error } = await resend.emails.send({
		from,
		to: [recipient.email],
		subject,
		html: bodyHtml,
		text: bodyText,
		attachments: [{ filename, content: buffer }],
	});

	if (error) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to send email: ${error.message}`,
		});
	}

	return { kind: "sent", sentTo: recipient.email };
}
