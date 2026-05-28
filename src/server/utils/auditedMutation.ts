import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Audit logging — the shared, owner-facing action trail (Option B;
 * designFiles/roadmap/phase7-admin-checkin.md §"Audit Log").
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  USE THIS for every state-changing mutation that an owner might need to
 *  audit (sales, payments, credit applications, voids, refunds, …). Wrap the
 *  mutation's transaction in `writeAuditedMutation` and return the audit
 *  entry(ies) alongside the result — TypeScript will NOT compile if you forget
 *  the `audit` field, so the log can't silently develop gaps as features grow.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Writes one or more `AuditLog` rows INSIDE the same `$transaction` as the
 * business logic, so the audit commits (or rolls back) atomically with the
 * action that produced it. The `AuditLog` table is APPEND-ONLY — never expose
 * update/delete on it.
 *
 * Example (single party):
 *   return writeAuditedMutation(
 *     { db: ctx.db, actorUserId: ctx.user.userId,
 *       clubShortName: ctx.user.clubShortName, source: AUDIT_SOURCES.ADMIN_DASHBOARD },
 *     async (tx) => {
 *       // advisory lock, FOR UPDATE, business logic on `tx` …
 *       return {
 *         result: payment,
 *         audit: {
 *           action: AUDIT_ACTIONS.PAYMENT_RECORDED,
 *           targetUserId: payerUserId,
 *           entityType: "InvoicePayment",
 *           entityId: payment.paymentId,
 *           metadata: { amountInCents, invoiceNumber },
 *         },
 *       };
 *     },
 *   );
 *
 * Multi-party (bill-to): return an ARRAY of two entries — one per affected user
 * (`targetRole: "consumer"` and `"payer"`). The wrapper auto-assigns a shared
 * `correlationId` so a single logical action can be collapsed in the global
 * `/admin/audit-log` feed while still surfacing on each member's Activity tab.
 *
 * Non-human actors (the membership cron, processor webhooks, an AI agent) pass
 * `actorUserId: null` + the matching `source` (e.g. AUDIT_SOURCES.CRON).
 */

/** How an action was initiated. Stored as a string column — extend freely. */
export const AUDIT_SOURCES = {
	ADMIN_DASHBOARD: "admin_dashboard",
	SELF_SERVICE: "self_service",
	SYSTEM: "system",
	CRON: "cron",
	AI_AGENT: "ai_agent",
	WEBHOOK: "webhook",
} as const;
export type AuditSource = (typeof AUDIT_SOURCES)[keyof typeof AUDIT_SOURCES];

/**
 * Action constants (dot-notation). Adding one needs no migration — `action` is
 * a plain string column. Keep these in sync with what each mutation emits.
 */
export const AUDIT_ACTIONS = {
	// Phase 9 — invoicing
	PACKAGE_SOLD: "package.sold",
	PAYMENT_RECORDED: "payment.recorded",
	ACCOUNT_CREDIT_APPLIED: "account_credit.applied",
	INVOICE_MARKED_DUE: "invoice.marked_due",
	INVOICE_VOIDED: "invoice.voided",
	REFUND_ISSUED: "refund.issued",
	// Phase 10a — memberships
	MEMBERSHIP_SOLD: "membership.sold",
	MEMBERSHIP_FROZEN: "membership.frozen",
	MEMBERSHIP_UNFROZEN: "membership.unfrozen",
	MEMBERSHIP_SUSPENDED: "membership.suspended",
	MEMBERSHIP_REINSTATED: "membership.reinstated",
	MEMBERSHIP_CANCELLED: "membership.cancelled",
	MEMBERSHIP_VOIDED: "membership.voided",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Which party a row is "about" when consumer ≠ payer (bill-to). */
export type AuditTargetRole = "consumer" | "payer";

/** One audit row. `actorUserId` / `clubShortName` / `source` come from the
 * wrapper opts; `correlationId` is auto-filled for multi-row actions. */
export interface AuditEntry {
	action: AuditAction;
	/** The member this row is about; null for non-member actions. */
	targetUserId: string | null;
	targetRole?: AuditTargetRole | null;
	entityType: string;
	entityId: string;
	metadata?: Prisma.InputJsonValue;
	/** Idempotency key for webhook retries (Phase 11); null = no dedupe. */
	dedupeKey?: string | null;
	/** Rarely set by callers — the wrapper assigns a shared id to multi-row sets. */
	correlationId?: string | null;
}

/**
 * Builds the audit entry(ies) for an invoice action affecting a consumer and an
 * optional bill-to payer. Self-pay (payer null or == consumer) → ONE row (no
 * role). Bill-to (payer ≠ consumer) → TWO rows (consumer + payer) that the
 * wrapper links via a shared correlationId, so each member's Activity tab shows
 * the action while the global feed can collapse the pair into one event.
 */
export function buildPartyAuditEntries(args: {
	action: AuditAction;
	consumerUserId: string;
	payerUserId: string | null;
	entityType: string;
	entityId: string;
	metadata?: Prisma.InputJsonValue;
}): AuditEntry[] {
	const base = {
		action: args.action,
		entityType: args.entityType,
		entityId: args.entityId,
		metadata: args.metadata,
	};
	if (args.payerUserId === null || args.payerUserId === args.consumerUserId) {
		return [{ ...base, targetUserId: args.consumerUserId }];
	}
	return [
		{ ...base, targetUserId: args.consumerUserId, targetRole: "consumer" },
		{ ...base, targetUserId: args.payerUserId, targetRole: "payer" },
	];
}

type TxClient = Prisma.TransactionClient;

interface AuditedMutationOpts {
	db: PrismaClient;
	/** Acting user, or null for non-human actors (then set a system `source`). */
	actorUserId: string | null;
	clubShortName: string;
	source: AuditSource;
}

/**
 * Runs `body` inside a transaction and writes its audit entry(ies) in the SAME
 * transaction. The body MUST return `{ result, audit }` (one entry or an array)
 * — omitting `audit` is a compile error. Returns the body's `result`.
 */
export async function writeAuditedMutation<R>(
	opts: AuditedMutationOpts,
	body: (
		tx: TxClient,
	) => Promise<{ result: R; audit: AuditEntry | AuditEntry[] }>,
): Promise<R> {
	return opts.db.$transaction(async (tx) => {
		const { result, audit } = await body(tx);
		const entries = Array.isArray(audit) ? audit : [audit];
		// Multi-row (bill-to) actions share one correlationId so the global feed
		// can collapse them into a single event; single-row actions stay null.
		const sharedCorrelationId = entries.length > 1 ? randomUUID() : null;
		for (const entry of entries) {
			await tx.auditLog.create({
				data: {
					clubShortName: opts.clubShortName,
					actorUserId: opts.actorUserId,
					source: opts.source,
					targetUserId: entry.targetUserId,
					targetRole: entry.targetRole ?? null,
					correlationId: entry.correlationId ?? sharedCorrelationId,
					action: entry.action,
					entityType: entry.entityType,
					entityId: entry.entityId,
					dedupeKey: entry.dedupeKey ?? null,
					metadata: entry.metadata ?? {},
				},
			});
		}
		return result;
	});
}
