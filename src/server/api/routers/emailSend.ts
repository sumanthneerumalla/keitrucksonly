import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, staffProcedure } from "~/server/api/trpc";
import {
	extractBatchEmailIds,
	getDisplayName,
	getFromAddress,
	getResendClient,
	htmlToText,
	sanitizeEmailHtml,
	withRetry,
} from "~/server/services/email/resend";
import { reconcileSendLogStatus } from "~/server/services/email/sendLog";
import { getConfig } from "~/server/utils/config";
import { getCurrentUser, isAnyAdmin } from "~/server/utils/utils";

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

			const resend = await getResendClient();
			const from = await getFromAddress(user);
			const displayName = getDisplayName(user);
			const safeHtml = sanitizeEmailHtml(input.bodyHtml);
			const bodyText = htmlToText(safeHtml);
			const testSubject = `[TEST] ${input.subject}`;
			const fromEmail = await getConfig("RESEND_FROM_EMAIL");
			const testToEmail = await getConfig("RESEND_TEST_TO_EMAIL");
			const sentTo = fromEmail?.includes("resend.dev")
				? (testToEmail ?? "delivered@resend.dev")
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
			const from = await getFromAddress(user);
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
			let firstResendId: string | null = null;
			let resendIdPersisted = false;
			let totalRecipients = 0;

			try {
				const fromEmail = await getConfig("RESEND_FROM_EMAIL");
				const testToEmail = await getConfig("RESEND_TEST_TO_EMAIL");
				const testRecipient = fromEmail?.includes("resend.dev")
					? (testToEmail ?? "delivered@resend.dev")
					: null;
				for (let i = 0; i < withEmail.length; i += BATCH_SIZE) {
					const batch = withEmail.slice(i, i + BATCH_SIZE);
					const batchIndex = Math.floor(i / BATCH_SIZE);

					const batchEmails = batch.map((m: any) => ({
						from,
						to: [testRecipient ?? m.user.email],
						subject: input.subject,
						html: safeHtml,
						text: bodyText,
						replyTo: user.email ?? undefined,
						headers: {
							"Idempotency-Key": `sm-${sendLogId}-b${batchIndex}`,
						},
					}));

					const batchResults: RecipientResult[] = [];

					try {
						const resend = await getResendClient();
						const { data, error } = await withRetry(() =>
							resend.batch.send(batchEmails),
						);

						if (error) {
							console.error("[EmailSend] Batch send error:", error);
							for (const m of batch) {
								batchResults.push({
									userId: m.user.userId,
									email: m.user.email!,
									status: "failed",
									resendMessageId: null,
								});
							}
						} else {
							const ids = extractBatchEmailIds(data);
							if (!firstResendId && ids[0]) firstResendId = ids[0];

							batch.forEach((m: any, idx: number) => {
								const resendMessageId = ids[idx] ?? null;
								batchResults.push({
									userId: m.user.userId,
									email: m.user.email!,
									// Without a Resend id we can never reconcile delivery
									// via the webhook, so treat a missing id as a failure
									// (keeps the recipient retry-eligible) rather than a
									// false "sent".
									status: resendMessageId ? "sent" : "failed",
									resendMessageId,
								});
							});
						}
					} catch (err) {
						console.error("[EmailSend] Batch send exception:", err);
						for (const m of batch) {
							batchResults.push({
								userId: m.user.userId,
								email: m.user.email!,
								status: "failed",
								resendMessageId: null,
							});
						}
					}

					// Persist this batch's recipient rows immediately. Doing it
					// per-batch (instead of one createMany at the very end) means a
					// delivery/bounce webhook that fires before the whole send
					// finishes still finds its recipient row, and a crash mid-send
					// leaves accurate partial data to reconcile from.
					await ctx.db.emailSendRecipient.createMany({
						data: batchResults.map((r) => ({
							sendLogId,
							userId: r.userId,
							email: r.email,
							status: r.status,
							resendMessageId: r.resendMessageId,
						})),
					});
					totalRecipients += batchResults.length;

					// Stamp the campaign-level Resend id as soon as we have one so
					// the log isn't blank if a later crash skips the final update.
					if (firstResendId && !resendIdPersisted) {
						resendIdPersisted = true;
						await ctx.db.emailSendLog.update({
							where: { sendLogId },
							data: { resendId: firstResendId },
						});
					}
				}
			} catch (err) {
				// Unexpected failure escaping the per-batch handling (e.g. a DB
				// write). Don't leave the log stuck "sending" — reconcile its
				// terminal status from whatever recipient rows landed, then rethrow.
				console.error("[EmailSend] Send loop failed:", err);
				await reconcileSendLogStatus(sendLogId);
				throw err;
			}

			// Normal completion: derive the terminal status from the persisted
			// recipient rows (single source of truth), not an in-memory tally.
			const { sentCount, failedCount } =
				await reconcileSendLogStatus(sendLogId);

			return {
				sendLogId,
				sentCount,
				failedCount,
				skippedCount: skipped.length,
				totalRecipients,
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
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Send log not found",
				});
			}

			// Only original sender or admin can retry
			if (sendLog.senderUserId !== user.userId && !isAnyAdmin(user)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Not authorised to retry this send",
				});
			}

			const failedRecipients = sendLog.recipients.filter(
				(r: any) => r.user.email && r.user.email.length > 0,
			);

			if (failedRecipients.length === 0) {
				return { retriedCount: 0, successCount: 0, failedCount: 0 };
			}

			const from = await getFromAddress(user);
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
					const resend = await getResendClient();
					const { data, error } = await withRetry(() =>
						resend.batch.send(batchEmails),
					);

					if (error) {
						failedCount += batch.length;
					} else {
						const ids = extractBatchEmailIds(data);

						for (let j = 0; j < batch.length; j++) {
							const r = batch[j];
							if (!r) continue;
							const resendMessageId = ids[j] ?? null;
							// Only count a retry as a success when Resend returned an
							// id we can track. A missing id leaves the recipient as
							// "failed" with resendMessageId=null so a later retry
							// re-picks them instead of double-sending to "sent" rows.
							if (resendMessageId) {
								await ctx.db.emailSendRecipient.update({
									where: { id: r.id },
									data: {
										status: "sent",
										resendMessageId,
										error: null,
									},
								});
								successCount += 1;
							} else {
								failedCount += 1;
							}
						}
					}
				} catch (err) {
					console.error("[EmailSend] Retry batch exception:", err);
					failedCount += batch.length;
				}
			}

			// Recompute overall status from the recipient rows (shared with the
			// initial send path so the two can't compute it differently).
			await reconcileSendLogStatus(input.sendLogId);

			return {
				retriedCount: failedRecipients.length,
				successCount,
				failedCount,
			};
		}),
});
