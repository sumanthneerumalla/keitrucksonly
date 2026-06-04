import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	staffProcedure,
} from "~/server/api/trpc";
import { getCurrentUser, isAnyAdmin } from "~/server/utils/utils";
import { env } from "~/env";
import {
	getResendClient,
	getFromAddress,
	getDisplayName,
	withRetry,
	sanitizeEmailHtml,
	htmlToText,
} from "~/server/services/email/resend";

export const emailSendRouter = createTRPCRouter({
	// Send a test email to the sender's own address. Logged as an EmailSendLog
	// row with isTest=true for audit/delivery tracking, but excluded from the
	// user-facing send history (getSendHistory / getAllSendHistory).
	sendTest: staffProcedure
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

			// Verify membership or admin (same access rule as a real send)
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

			const resend = getResendClient();
			const from = getFromAddress(user);
			const displayName = getDisplayName(user);
			const safeHtml = sanitizeEmailHtml(input.bodyHtml);
			const bodyText = htmlToText(safeHtml);
			const testSubject = `[TEST] ${input.subject}`;
			const sentTo = env.RESEND_FROM_EMAIL?.includes("resend.dev")
				? (env.RESEND_TEST_TO_EMAIL ?? "delivered@resend.dev")
				: user.email;

			const { data, error } = await resend.emails.send({
				from,
				to: [sentTo],
				subject: testSubject,
				html: safeHtml,
				text: bodyText,
				replyTo: user.email ?? undefined,
			});

			// Log the test send (isTest=true) for audit + webhook delivery tracking
			const resendMessageId = data?.id ?? null;
			await ctx.db.emailSendLog.create({
				data: {
					emailGroupId: input.emailGroupId,
					senderUserId: user.userId,
					subject: testSubject,
					bodyHtml: safeHtml,
					bodyText,
					attachmentUrls: input.attachmentUrls,
					status: error ? "failed" : "sent",
					replyToEmail: user.email,
					fromDisplayName: displayName,
					recipientCount: error ? 0 : 1,
					isTest: true,
					...(error ? { errorMessage: error.message } : {}),
					recipients: {
						create: {
							userId: user.userId,
							email: sentTo,
							status: error ? "failed" : "sent",
							resendMessageId,
						},
					},
				},
			});

			if (error) {
				console.error("[EmailSend] Test email failed:", error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to send test email",
				});
			}

			return { success: true, sentTo };
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

			// Verify membership or admin
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

			// Collect all members, split into recipients and skipped
			const members = await ctx.db.emailGroupMember.findMany({
				where: { emailGroupId: input.emailGroupId },
				include: {
					user: { select: { userId: true, email: true } },
				},
			});

			const withEmail = members.filter(
				(m: any) => m.user.email && m.user.email.length > 0,
			);
			const skipped = members
				.filter((m: any) => !m.user.email || m.user.email.length === 0)
				.map((m: any) => ({ userId: m.user.userId }));

			if (withEmail.length === 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No recipients with valid email addresses in this group",
				});
			}

			// Sanitize and derive plain-text body
			const safeHtml = sanitizeEmailHtml(input.bodyHtml);
			const bodyText = htmlToText(safeHtml);
			const from = getFromAddress(user);
			const displayName = getDisplayName(user);

			// Create the log row first to get sendLogId for idempotency keys
			const sendLog = await ctx.db.emailSendLog.create({
				data: {
					emailGroupId: input.emailGroupId,
					senderUserId: user.userId,
					subject: input.subject,
					bodyHtml: safeHtml,
					bodyText,
					attachmentUrls: input.attachmentUrls,
					status: "sending",
					replyToEmail: user.email,
					fromDisplayName: displayName,
					recipientCount: 0,
					skippedCount: skipped.length,
					skippedRecipients: skipped.length > 0 ? skipped : undefined,
				},
			});

			const sendLogId = sendLog.sendLogId;

			// Send in batches of 100 (Resend's batch limit)
			const BATCH_SIZE = 100;
			type RecipientResult = {
				userId: string;
				email: string;
				status: string;
				resendMessageId: string | null;
			};
			const recipientResults: RecipientResult[] = [];
			let firstResendId: string | null = null;

			for (let i = 0; i < withEmail.length; i += BATCH_SIZE) {
				const batch = withEmail.slice(i, i + BATCH_SIZE);
				const batchIndex = Math.floor(i / BATCH_SIZE);

				const batchEmails = batch.map((m: any) => ({
					from,
					to: [env.RESEND_FROM_EMAIL?.includes("resend.dev") ? (env.RESEND_TEST_TO_EMAIL ?? "delivered@resend.dev") : m.user.email],
					subject: input.subject,
					html: safeHtml,
					text: bodyText,
					replyTo: user.email ?? undefined,
					headers: {
						"Idempotency-Key": `sm-${sendLogId}-b${batchIndex}`,
					},
				}));

				try {
					const resend = getResendClient();
					const { data, error } = await withRetry(() =>
						resend.batch.send(batchEmails),
					);

					if (error) {
						console.error("[EmailSend] Batch send error:", error);
						for (const m of batch) {
							recipientResults.push({
								userId: m.user.userId,
								email: m.user.email!,
								status: "failed",
								resendMessageId: null,
							});
						}
					} else {
						const arr: any[] = Array.isArray(data) ? data : ((data as any)?.data ?? []);
						const ids: string[] = arr.map((d: any) => d?.id ?? null);
						if (!firstResendId && ids[0]) firstResendId = ids[0];

						batch.forEach((m: any, idx: number) => {
							recipientResults.push({
								userId: m.user.userId,
								email: m.user.email!,
								status: "sent",
								resendMessageId: ids[idx] ?? null,
							});
						});
					}
				} catch (err) {
					console.error("[EmailSend] Batch send exception:", err);
					for (const m of batch) {
						recipientResults.push({
							userId: m.user.userId,
							email: m.user.email!,
							status: "failed",
							resendMessageId: null,
						});
					}
				}
			}

			// Persist recipient rows
			await ctx.db.emailSendRecipient.createMany({
				data: recipientResults.map((r) => ({
					sendLogId,
					userId: r.userId,
					email: r.email,
					status: r.status,
					resendMessageId: r.resendMessageId,
				})),
			});

			const sentCount = recipientResults.filter((r) => r.status === "sent").length;
			const failedCount = recipientResults.filter((r) => r.status === "failed").length;
			const finalStatus =
				failedCount === 0
					? "sent"
					: sentCount === 0
						? "failed"
						: "partial_failure";

			// Update log with final counts and status
			await ctx.db.emailSendLog.update({
				where: { sendLogId },
				data: {
					status: finalStatus,
					recipientCount: sentCount,
					resendId: firstResendId,
					...(finalStatus === "failed"
						? { errorMessage: "All recipients failed to receive the email" }
						: {}),
				},
			});

			return {
				sendLogId,
				sentCount,
				failedCount,
				skippedCount: skipped.length,
				totalRecipients: recipientResults.length,
			};
		}),

	// Retry failed recipients for an existing send log
	retryGroup: staffProcedure
		.input(z.object({ sendLogId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);

			const sendLog = await ctx.db.emailSendLog.findUnique({
				where: { sendLogId: input.sendLogId },
				include: {
					recipients: {
						// Only retry recipients Resend never accepted. Bounced
						// recipients have status "failed" but a non-null
						// resendMessageId, so this correctly skips re-sending to
						// addresses that already bounced.
						where: { resendMessageId: null },
						include: { user: { select: { userId: true, email: true } } },
					},
					emailGroup: { select: { emailGroupId: true } },
				},
			});

			if (!sendLog) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Send log not found" });
			}

			// Only original sender or admin can retry
			if (sendLog.senderUserId !== user.userId && !isAnyAdmin(user)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Not authorised to retry this send" });
			}

			const failedRecipients = sendLog.recipients.filter(
				(r: any) => r.user.email && r.user.email.length > 0,
			);

			if (failedRecipients.length === 0) {
				return { retriedCount: 0, successCount: 0, failedCount: 0 };
			}

			const from = getFromAddress(user);
			const safeHtml = sendLog.bodyHtml;
			const bodyText = sendLog.bodyText ?? htmlToText(safeHtml);
			const BATCH_SIZE = 100;
			let successCount = 0;
			let failedCount = 0;

			for (let i = 0; i < failedRecipients.length; i += BATCH_SIZE) {
				const batch = failedRecipients.slice(i, i + BATCH_SIZE);
				const batchIndex = Math.floor(i / BATCH_SIZE);

				const batchEmails = batch.map((r: any) => ({
					from,
					to: [r.user.email],
					subject: sendLog.subject,
					html: safeHtml,
					text: bodyText,
					replyTo: sendLog.replyToEmail ?? user.email ?? undefined,
					headers: {
						"Idempotency-Key": `sm-retry-${input.sendLogId}-b${batchIndex}`,
					},
				}));

				try {
					const resend = getResendClient();
					const { data, error } = await withRetry(() =>
						resend.batch.send(batchEmails),
					);

					if (error) {
						failedCount += batch.length;
					} else {
						const ids: string[] = Array.isArray(data)
							? data.map((d: any) => d?.id ?? null)
							: [];

						for (let j = 0; j < batch.length; j++) {
							const r = batch[j];
							if (!r) continue;
							await ctx.db.emailSendRecipient.update({
								where: { id: r.id },
								data: {
									status: "sent",
									resendMessageId: ids[j] ?? null,
									error: null,
								},
							});
						}
						successCount += batch.length;
					}
				} catch (err) {
					console.error("[EmailSend] Retry batch exception:", err);
					failedCount += batch.length;
				}
			}

			// Recompute overall status on the log
			const totalFailed = await ctx.db.emailSendRecipient.count({
				where: { sendLogId: input.sendLogId, status: "failed" },
			});
			const totalSent = await ctx.db.emailSendRecipient.count({
				where: { sendLogId: input.sendLogId, status: "sent" },
			});
			const newStatus =
				totalFailed === 0 ? "sent" : totalSent === 0 ? "failed" : "partial_failure";

			await ctx.db.emailSendLog.update({
				where: { sendLogId: input.sendLogId },
				data: {
					status: newStatus,
					recipientCount: totalSent,
					...(newStatus !== "failed" ? { errorMessage: null } : {}),
				},
			});

			return { retriedCount: failedRecipients.length, successCount, failedCount };
		}),
});
