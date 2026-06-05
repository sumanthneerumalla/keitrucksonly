/**
 * Resend webhook endpoint — verified via Svix signature.
 *
 * Resend uses Svix as its webhook delivery infrastructure. Verification
 * requires reading the raw body (never re-serialised) and checking the three
 * Svix headers: svix-id, svix-timestamp, svix-signature.
 *
 * Handles:
 *   email.delivered   → EmailSendRecipient.deliveredAt
 *   email.opened      → EmailSendRecipient.openedAt (first open), openCount++
 *   email.bounced     → EmailSendRecipient.bouncedAt, status="failed", error
 *   email.complained  → EmailSendRecipient.complainedAt
 *
 * All lookups are O(1) via the resendMessageId index on EmailSendRecipient.
 * Returns 200 for known event types, 400 for unknown (Resend retries on non-2xx).
 */

import { Webhook } from "svix";
import { env } from "~/env";
import { db } from "~/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
	if (!env.RESEND_WEBHOOK_SECRET) {
		console.error("[ResendWebhook] RESEND_WEBHOOK_SECRET is not configured");
		return new Response("webhook secret not configured", { status: 500 });
	}

	const rawBody = await req.text();
	const svixId = req.headers.get("svix-id");
	const svixTimestamp = req.headers.get("svix-timestamp");
	const svixSignature = req.headers.get("svix-signature");

	if (!svixId || !svixTimestamp || !svixSignature) {
		return new Response("missing svix headers", { status: 400 });
	}

	let event: { type: string; data: Record<string, any> };
	try {
		const wh = new Webhook(env.RESEND_WEBHOOK_SECRET);
		event = wh.verify(rawBody, {
			"svix-id": svixId,
			"svix-timestamp": svixTimestamp,
			"svix-signature": svixSignature,
		}) as typeof event;
	} catch (err) {
		console.error("[ResendWebhook] Signature verification failed:", err);
		return new Response("invalid signature", { status: 400 });
	}

	const messageId: string | undefined = event.data?.email_id;
	if (!messageId) {
		return new Response("ok", { status: 200 });
	}

	try {
		switch (event.type) {
			case "email.delivered": {
				await db.emailSendRecipient.updateMany({
					where: { resendMessageId: messageId },
					data: { deliveredAt: new Date() },
				});
				break;
			}

			case "email.opened": {
				const existing = await db.emailSendRecipient.findFirst({
					where: { resendMessageId: messageId },
					select: { id: true, openedAt: true, openCount: true },
				});
				if (existing) {
					await db.emailSendRecipient.update({
						where: { id: existing.id },
						data: {
							openedAt: existing.openedAt ?? new Date(),
							openCount: existing.openCount + 1,
						},
					});
				}
				break;
			}

			case "email.bounced": {
				const reason: string = event.data?.reason ?? "bounce";
				await db.emailSendRecipient.updateMany({
					where: { resendMessageId: messageId },
					data: {
						bouncedAt: new Date(),
						status: "failed",
						error: reason,
					},
				});
				break;
			}

			case "email.complained": {
				await db.emailSendRecipient.updateMany({
					where: { resendMessageId: messageId },
					data: { complainedAt: new Date() },
				});
				break;
			}

			default:
				console.log(`[ResendWebhook] Unhandled event type: ${event.type}`);
		}
	} catch (err) {
		console.error("[ResendWebhook] DB update failed:", err);
		return new Response("internal error", { status: 500 });
	}

	return new Response("ok", { status: 200 });
}
