import { db } from "~/server/db";

/**
 * A group send is created with status "sending" and flipped to a terminal
 * status once the batch loop finishes. If the process dies mid-send (deploy,
 * OOM) the row would be stuck "sending" forever, so read paths treat a
 * "sending" log older than this window as stale and reconcile it from its
 * recipient rows (lazy-on-read — see `reconcileStaleSendLogs`).
 *
 * Generous on purpose: a very large send (many sequential batches, each with
 * retry backoff) can legitimately take several minutes. A stale window that's
 * too short would reconcile a still-running send to a wrong terminal status
 * (it self-corrects on completion, but better to avoid the churn).
 */
export const STALE_SENDING_MS = 30 * 60 * 1000;

/**
 * Derive and persist the terminal status of a send log from its recipient
 * rows. The EmailSendRecipient table is the source of truth, so this is correct
 * after a normal completion, a retry, or a crash that left only partial rows.
 *
 * Returns the computed status and counts so callers can reflect them without a
 * re-read.
 */
export async function reconcileSendLogStatus(sendLogId: string): Promise<{
	status: "sent" | "partial_failure" | "failed";
	sentCount: number;
	failedCount: number;
}> {
	const [sentCount, failedCount] = await Promise.all([
		db.emailSendRecipient.count({ where: { sendLogId, status: "sent" } }),
		db.emailSendRecipient.count({ where: { sendLogId, status: "failed" } }),
	]);

	// No "sent" rows at all (including the zero-rows crash case) → failed.
	const status =
		sentCount === 0
			? "failed"
			: failedCount === 0
				? "sent"
				: "partial_failure";

	await db.emailSendLog.update({
		where: { sendLogId },
		data: {
			status,
			recipientCount: sentCount,
			...(status === "failed"
				? { errorMessage: "Send interrupted or all recipients failed" }
				: { errorMessage: null }),
		},
	});

	return { status, sentCount, failedCount };
}

/**
 * Lazy-on-read recovery: given a freshly-fetched list of send logs, reconcile
 * any that are stuck in "sending" past the stale window and patch the in-memory
 * objects so the caller returns the corrected status without a re-query.
 * No-op (single cheap filter) when nothing is stale, which is the common case.
 */
export async function reconcileStaleSendLogs<
	T extends { sendLogId: string; status: string | null; sentAt: Date; recipientCount: number },
>(logs: T[]): Promise<T[]> {
	const cutoff = Date.now() - STALE_SENDING_MS;
	const stale = logs.filter(
		(l) => l.status === "sending" && l.sentAt.getTime() < cutoff,
	);
	if (stale.length === 0) return logs;

	await Promise.all(
		stale.map(async (l) => {
			const r = await reconcileSendLogStatus(l.sendLogId);
			l.status = r.status;
			l.recipientCount = r.sentCount;
		}),
	);
	return logs;
}
