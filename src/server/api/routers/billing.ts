import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, facilityProcedure } from "~/server/api/trpc";

/**
 * Phase 9 billing router.
 *
 * Phase 9-EOD (2026-05-02) shipped read-only `getMemberBilling`. Phase 9a adds
 * `recordPayment` — the first write endpoint. See
 * designFiles/roadmap/phase9-invoicing.md for the full design, and HANDOFF.md
 * decisions 92–105 for the partial-payment + overpayment policy.
 */

export const billingRouter = createTRPCRouter({
	/**
	 * Three-number summary + invoice list for one member, scoped to the staff
	 * user's club. Existing pre-2026-05-02 `MemberPackage` rows have no
	 * invoice (line-in-the-sand backfill stance) and contribute $0.
	 */
	getMemberBilling: facilityProcedure
		.input(z.object({ userId: z.string() }))
		.query(async ({ ctx, input }) => {
			// Cross-tenant guard (matches packages.getMemberPackages pattern)
			const member = await ctx.db.user.findFirst({
				where: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { userId: true },
			});

			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found in this club",
				});
			}

			const invoices = await ctx.db.invoice.findMany({
				where: {
					userId: input.userId,
					clubShortName: ctx.user.clubShortName,
				},
				orderBy: { issueDate: "desc" },
				include: {
					lineItems: { orderBy: { sortOrder: "asc" } },
					payments: {
						// Secondary `paymentId asc` tiebreaker stabilizes order when two
						// payments share a `receivedAt` millisecond (fast clicks or webhook
						// bursts both resolve `now()` to the same instant). Without it the
						// panel rows can shuffle between renders.
						orderBy: [{ receivedAt: "desc" }, { paymentId: "asc" }],
						include: { refunds: true },
					},
				},
			});

			// Rollups: void invoices excluded entirely.
			// `amountPaidInCents` is already net of refunds (per phase9-invoicing.md).
			// Per the Version A overpayment policy (HANDOFF decision #104),
			// `outstandingInCents` and per-invoice `balanceInCents` are SIGNED — a
			// negative value represents account credit (the member overpaid and we
			// surface that as a negative balance on the open running tab).
			let totalBilledInCents = 0;
			let totalPaidInCents = 0;
			let outstandingInCents = 0;

			for (const inv of invoices) {
				if (inv.status === "void") continue;
				totalBilledInCents += inv.totalInCents;
				totalPaidInCents += inv.amountPaidInCents;
				outstandingInCents += inv.totalInCents - inv.amountPaidInCents;
			}

			return {
				totalBilledInCents,
				totalPaidInCents,
				outstandingInCents,
				invoices: invoices.map((inv) => ({
					invoiceId: inv.invoiceId,
					invoiceNumber: inv.invoiceNumber,
					status: inv.status,
					issueDate: inv.issueDate,
					dueDate: inv.dueDate,
					totalInCents: inv.totalInCents,
					amountPaidInCents: inv.amountPaidInCents,
					balanceInCents: inv.totalInCents - inv.amountPaidInCents,
					lineItems: inv.lineItems.map((li) => ({
						lineItemId: li.lineItemId,
						description: li.description,
						quantity: li.quantity,
						unitPriceInCents: li.unitPriceInCents,
						totalInCents: li.totalInCents,
					})),
					payments: inv.payments.map((p) => ({
						paymentId: p.paymentId,
						amountInCents: p.amountInCents,
						paymentMethod: p.paymentMethod,
						status: p.status,
						processor: p.processor,
						processorTransactionId: p.processorTransactionId,
						reference: p.reference,
						receivedAt: p.receivedAt,
						refundedTotalInCents: p.refunds.reduce(
							(sum, r) => sum + r.amountInCents,
							0,
						),
					})),
				})),
			};
		}),

	/**
	 * Phase 9a entry point for paying down a running-tab invoice (backlog A1).
	 *
	 * Inserts an `InvoicePayment` row, then recomputes `Invoice.amountPaidInCents`
	 * authoritatively as `Σ payments − Σ refunds` inside a row-locked transaction
	 * (never a blind `increment`). Supports overpayment per Version A
	 * (HANDOFF #104): an overpaid invoice STAYS the open running tab with a
	 * negative balance — the credit is consumed by future line items, not stranded.
	 * This mutation does NOT close the invoice; that's a future `closeInvoice`
	 * action with mechanics still being decided.
	 *
	 * See designFiles/roadmap/phase9-invoicing.md "Partial Payment & Overpayment
	 * Policy" and HANDOFF.md decisions 102–105.
	 */
	recordPayment: facilityProcedure
		.input(
			z
				.object({
					invoiceId: z.string(),
					amountInCents: z.number().int().positive(),
					paymentMethod: z.enum([
						"cash",
						"check",
						"credit_card",
						"pos_transaction",
						"stripe",
						"paysafe",
						"other",
					]),
					processor: z
						.enum(["stripe", "paysafe", "square", "valor"])
						.optional(),
					processorTransactionId: z.string().max(255).optional(),
					processorChargeId: z.string().max(255).optional(),
					processorFeeInCents: z.number().int().nonnegative().optional(),
					reference: z.string().max(255).optional(),
					notes: z.string().max(2000).optional(),
				})
				.refine((data) => !data.processor || !!data.processorTransactionId, {
					message: "processorTransactionId is required when processor is set",
				}),
		)
		.mutation(async ({ ctx, input }) => {
			// Cross-tenant guard: invoice must belong to the staff user's club.
			// Done OUTSIDE the transaction so a 404 returns immediately without
			// the locking-roundtrip overhead, mirroring sellPackage's shape.
			const invoice = await ctx.db.invoice.findFirst({
				where: {
					invoiceId: input.invoiceId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { invoiceId: true, status: true, totalInCents: true },
			});

			if (!invoice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found in this club",
				});
			}

			// Status guards (HANDOFF #102, status-transitions diagram).
			// `void` is terminal — payments on a voided invoice are nonsensical.
			if (invoice.status === "void") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Cannot record payment on a void invoice",
				});
			}

			// `draft` is forward-looking: no UI currently creates draft invoices
			// (sellPackage opens directly to `open`), but reject defensively so a
			// future finalize-flow has to ship before draft invoices accept payment.
			if (invoice.status === "draft") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"Cannot record payment on a draft invoice (no finalize flow exists yet)",
				});
			}

			const totalInCents = invoice.totalInCents;

			return await ctx.db.$transaction(async (tx) => {
				// Row lock just this invoice for the transaction duration. Holding
				// the lock means a concurrent `recordPayment` on the same invoice
				// waits here rather than racing the aggregate-then-update sequence
				// below and clobbering each other's `amountPaidInCents`.
				//
				// Per-invoice scope is the correct grain here. This does NOT address
				// the `sellPackage` find-or-create-open-invoice race (that race is
				// `(userId, clubShortName)`-scoped — backlog item A7, separate task).
				//
				// CONTRACT FOR FUTURE A2 (recordRefund): the refund mutation MUST take
				// this same row lock at the same point in its transaction. Without it
				// a concurrent refund + payment can both read pre-write aggregates and
				// each write a stale `amountPaidInCents`. The recompute formula
				// (Σ payments − Σ refunds) is correct; what keeps it correct under
				// concurrency is BOTH sides holding the Invoice row lock.
				//
				// Raw SQL uses the same `$executeRaw` template-literal style as the
				// advisory-lock call in `rentals.ts` — Prisma parameterizes
				// `invoiceId` safely (no string interpolation into the SQL text).
				await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "invoiceId" = ${input.invoiceId} FOR UPDATE`;

				// Insert the payment row. Status defaults to "succeeded" via the
				// Prisma schema default. P2002 here would mean a (processor, txId)
				// collision — webhook idempotency triggered. Manual cash/check
				// payments have both nulls, which Postgres treats as distinct, so
				// they can't collide with each other.
				let payment: Awaited<ReturnType<typeof tx.invoicePayment.create>>;
				try {
					payment = await tx.invoicePayment.create({
						data: {
							invoiceId: input.invoiceId,
							amountInCents: input.amountInCents,
							paymentMethod: input.paymentMethod,
							processor: input.processor,
							processorTransactionId: input.processorTransactionId,
							processorChargeId: input.processorChargeId,
							processorFeeInCents: input.processorFeeInCents,
							reference: input.reference,
							notes: input.notes,
							receivedBy: ctx.user.userId,
						},
					});
				} catch (error) {
					if (
						error instanceof Prisma.PrismaClientKnownRequestError &&
						error.code === "P2002"
					) {
						throw new TRPCError({
							code: "CONFLICT",
							message:
								"This transaction has already been recorded for this processor",
						});
					}
					throw error;
				}

				// Authoritative recompute (HANDOFF #102, decision: never a blind
				// `increment`). Σ payments − Σ refunds, against the locked invoice.
				const paymentsSum = await tx.invoicePayment.aggregate({
					_sum: { amountInCents: true },
					where: { invoiceId: input.invoiceId },
				});
				// Use the denormalized `InvoiceRefund.invoiceId` column directly
				// (schema.prisma:962 — "denormalized for invoice-level queries").
				// Going through payment → refunds would be slower and the
				// denormalized column is the canonical lookup path.
				const refundsSum = await tx.invoiceRefund.aggregate({
					_sum: { amountInCents: true },
					where: { invoiceId: input.invoiceId },
				});
				const newAmountPaid =
					(paymentsSum._sum.amountInCents ?? 0) -
					(refundsSum._sum.amountInCents ?? 0);

				// Status mapping (status-transitions diagram + HANDOFF #102/#104):
				//   newAmountPaid <= 0           → "open"           (no net payment yet, or fully refunded)
				//   0 < newAmountPaid < total    → "partially_paid"
				//   newAmountPaid >= total       → "paid"           (overpaid stays "paid" — negative balance = credit)
				// `overdue` is auto-derived from dueDate by a future scheduled job;
				// we don't preserve it across a payment because there's no automation
				// yet to re-derive it after the payment lands.
				let newStatus: string;
				if (newAmountPaid <= 0) {
					newStatus = "open";
				} else if (newAmountPaid < totalInCents) {
					newStatus = "partially_paid";
				} else {
					newStatus = "paid";
				}

				await tx.invoice.update({
					where: { invoiceId: input.invoiceId },
					data: {
						amountPaidInCents: newAmountPaid,
						status: newStatus,
					},
				});

				return {
					payment,
					invoice: {
						invoiceId: input.invoiceId,
						amountPaidInCents: newAmountPaid,
						totalInCents,
						status: newStatus,
					},
				};
			});
		}),
});
