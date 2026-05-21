// @ts-nocheck
// TODO: Remove @ts-nocheck after running `prisma generate` with the email groups migration applied.
import { TRPCError } from "@trpc/server";
import { Resend } from "resend";
import { z } from "zod";
import { env } from "~/env";
import {
	createTRPCRouter,
	staffProcedure,
} from "~/server/api/trpc";
import { getCurrentUser, isAnyAdmin } from "~/server/utils/utils";

function getResend() {
	if (!env.RESEND_API_KEY) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Email sending is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL in your environment.",
		});
	}
	return new Resend(env.RESEND_API_KEY);
}

function getFromEmail(user: { firstName: string | null; lastName: string | null }) {
	if (!env.RESEND_FROM_EMAIL) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "RESEND_FROM_EMAIL is not configured.",
		});
	}
	return `${user.firstName ?? "Shuttle"} ${user.lastName ?? "Mentor"} <${env.RESEND_FROM_EMAIL}>`;
}

export const emailSendRouter = createTRPCRouter({
	// Send a test email to the sender's own address
	sendTest: staffProcedure
		.input(
			z.object({
				subject: z.string().min(1).max(500),
				bodyHtml: z.string().min(1),
				attachmentUrls: z.array(z.string()).default([]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			if (!user.email) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You do not have an email address configured",
				});
			}

			const resend = getResend();
			const fromEmail = getFromEmail(user);

			const { error } = await resend.emails.send({
				from: fromEmail,
				to: [user.email],
				subject: `[TEST] ${input.subject}`,
				html: input.bodyHtml,
				replyTo: user.email,
			});

			if (error) {
				console.error("[EmailSend] Test email failed:", error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to send test email",
				});
			}

			return { success: true, sentTo: user.email };
		}),

	// Send email to all members of a group
	sendToGroup: staffProcedure
		.input(
			z.object({
				emailGroupId: z.string(),
				subject: z.string().min(1).max(500),
				bodyHtml: z.string().min(1),
				attachmentUrls: z.array(z.string()).default([]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			if (!user.email) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "You do not have an email address configured",
				});
			}

			// Verify membership
			const membership = await ctx.db.emailGroupMember.findUnique({
				where: {
					emailGroupId_userId: {
						emailGroupId: input.emailGroupId,
						userId: user.userId,
					},
				},
			});
			if (!membership && !isAnyAdmin(user)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You are not a member of this group",
				});
			}

			// Get all active members with emails
			const members = await ctx.db.emailGroupMember.findMany({
				where: { emailGroupId: input.emailGroupId },
				include: {
					user: { select: { userId: true, email: true } },
				},
			});

			const recipientsWithEmail = members.filter(
				(m: any) => m.user.email && m.user.email.length > 0,
			);

			if (recipientsWithEmail.length === 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No recipients with valid email addresses in this group",
				});
			}

			// Send emails in batches of 50 (Resend batch limit is 100)
			const BATCH_SIZE = 50;
			const results: { userId: string; email: string; status: string }[] = [];

			for (let i = 0; i < recipientsWithEmail.length; i += BATCH_SIZE) {
				const batch = recipientsWithEmail.slice(i, i + BATCH_SIZE);

				const resend = getResend();
				const fromEmail = getFromEmail(user);

				const batchEmails = batch.map((m: any) => ({
					from: fromEmail,
					to: [m.user.email],
					subject: input.subject,
					html: input.bodyHtml,
					replyTo: user.email,
				}));

				try {
					const { data, error } = await resend.batch.send(batchEmails);
					if (error) {
						console.error("[EmailSend] Batch send error:", error);
						for (const m of batch) {
							results.push({ userId: m.user.userId, email: m.user.email, status: "failed" });
						}
					} else {
						for (const m of batch) {
							results.push({ userId: m.user.userId, email: m.user.email, status: "sent" });
						}
					}
				} catch (err) {
					console.error("[EmailSend] Batch send exception:", err);
					for (const m of batch) {
						results.push({ userId: m.user.userId, email: m.user.email, status: "failed" });
					}
				}
			}

			// Log the send
			const sendLog = await ctx.db.emailSendLog.create({
				data: {
					emailGroupId: input.emailGroupId,
					senderUserId: user.userId,
					subject: input.subject,
					bodyHtml: input.bodyHtml,
					attachmentUrls: input.attachmentUrls,
					recipientCount: results.length,
					recipients: {
						create: results.map((r) => ({
							userId: r.userId,
							email: r.email,
							status: r.status,
						})),
					},
				},
			});

			const sentCount = results.filter((r) => r.status === "sent").length;
			const failedCount = results.filter((r) => r.status === "failed").length;

			return {
				sendLogId: sendLog.sendLogId,
				sentCount,
				failedCount,
				totalRecipients: results.length,
			};
		}),
});
