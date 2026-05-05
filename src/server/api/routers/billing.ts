import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, facilityProcedure } from "~/server/api/trpc";

/**
 * Phase 9-EOD (2026-05-02) — read-only billing router.
 *
 * Ships one query: `getMemberBilling`. Returns three rollup numbers
 * (total billed, total paid, outstanding) plus the member's invoice list
 * with line items and payments. No mutations yet — payment recording,
 * refunds, voids, and PDF generation come later in Phase 9a.
 *
 * See designFiles/roadmap/phase9-invoicing.md for the full design.
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
						orderBy: { receivedAt: "desc" },
						include: { refunds: true },
					},
				},
			});

			// Rollups: void invoices excluded entirely.
			// `amountPaidInCents` is already net of refunds (per phase9-invoicing.md).
			// Outstanding floored at 0 to avoid negative balances when refunds exceed
			// remaining balance — true credit-memo semantics arrive with the full UI.
			let totalBilledInCents = 0;
			let totalPaidInCents = 0;
			let outstandingInCents = 0;

			for (const inv of invoices) {
				if (inv.status === "void") continue;
				totalBilledInCents += inv.totalInCents;
				totalPaidInCents += inv.amountPaidInCents;
				outstandingInCents += Math.max(
					0,
					inv.totalInCents - inv.amountPaidInCents,
				);
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
					balanceInCents: Math.max(0, inv.totalInCents - inv.amountPaidInCents),
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
});
