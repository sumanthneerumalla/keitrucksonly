import { Prisma, UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import dayjs from "~/lib/dayjs-config";
import {
	clubAdminProcedure,
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import { assertLineItemKindConsistency } from "~/server/utils/invoiceLineItems";
import {
	getCurrentUser,
	isFacilityOrAbove,
	isPlatformAdmin,
	isSameClub,
} from "~/server/utils/utils";

/**
 * Phase 9 billing router.
 *
 * Phase 9-EOD (2026-05-02) shipped read-only `getMemberBilling`. Phase 9a adds
 * `recordPayment` — the first write endpoint. See
 * designFiles/roadmap/phase9-invoicing.md for the full design, and HANDOFF.md
 * decisions 92–105 for the partial-payment + overpayment policy.
 */

/**
 * Spendable account credit remaining on a single overpaid invoice = its
 * overpayment (amountPaid − total) minus whatever has already been drawn down
 * (`creditConsumedInCents`). Returns 0 for invoices that were never overpaid.
 * Used everywhere we sum a payer's available credit so the formula stays
 * identical across getMemberBilling / getAccountCreditContext / applyAccountCredit.
 */
function sourceAvailableCreditInCents(inv: {
	totalInCents: number;
	amountPaidInCents: number;
	creditConsumedInCents: number;
}): number {
	return Math.max(
		0,
		inv.amountPaidInCents - inv.totalInCents - inv.creditConsumedInCents,
	);
}

export const billingRouter = createTRPCRouter({
	/**
	 * Three-number summary + invoice list for one member, scoped to the staff
	 * user's club. Existing pre-2026-05-02 `MemberPackage` rows have no
	 * invoice (line-in-the-sand backfill stance) and contribute $0.
	 *
	 * Phase 9a Round 5 — widened to surface invoices where the viewed user is
	 * EITHER the consumer (`userId`) OR the explicit bill-to target
	 * (`billedToUserId`). This way staff viewing user X's BillingPanel see
	 * both "X bought stuff" and "someone else's charges billed to X." Each
	 * row also returns `consumer` + `billedTo` user shapes so the UI can
	 * label rows like "Billed to: John" or "Billed for: Jane".
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
					clubShortName: ctx.user.clubShortName,
					// Phase 9a Round 5 — match invoices where `input.userId` is
					// either the consumer (today's invoices + legacy self-pay)
					// OR the explicit bill-to target. The OR is a union, not a
					// dedupe target — a single invoice can match at most one
					// branch (consumer = X with billedToUserId = X would
					// collapse to "self-pay" with billedToUserId = NULL by
					// sellPackage convention, so no row is double-counted).
					OR: [{ userId: input.userId }, { billedToUserId: input.userId }],
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
					// Phase 9a Round 5 — embed both user shapes so the panel can
					// render names without a second roundtrip. `user` is the
					// InvoiceMember (consumer); `billedToUser` is the
					// InvoiceBilledTo back-relation, null when billedToUserId
					// is NULL (self-pay).
					user: {
						select: { userId: true, firstName: true, lastName: true },
					},
					billedToUser: {
						select: { userId: true, firstName: true, lastName: true },
					},
				},
			});

			// Rollups: void invoices excluded entirely. `amountPaidInCents` is
			// already net of refunds (per phase9-invoicing.md).
			//
			// We DON'T net owed-vs-credit into one signed number: a member can owe
			// on open invoices while ALSO holding credit from earlier overpayments
			// (credit isn't auto-applied to open tabs). So we split:
			//   - outstandingInCents     = Σ positive balances (still owed)
			//   - availableCreditInCents = Σ UNCONSUMED overpayment credit
			// Both are PAYER-scoped: a bill-to invoice's balance/credit belongs to
			// the payer, not the consumer, so they count toward the viewed user
			// only when that user is the effective payer (explicit bill-to, or the
			// consumer on a self-pay invoice). Per-invoice `balanceInCents` stays
			// SIGNED (negative = that invoice is in credit).
			let totalBilledInCents = 0;
			let totalPaidInCents = 0;
			let outstandingInCents = 0;
			let availableCreditInCents = 0;
			let creditAppliedInCents = 0;
			let billedToOthersInCents = 0;

			for (const inv of invoices) {
				if (inv.status === "void") continue;

				// Charges this user CONSUMED but a different member is billed for —
				// context only, NOT part of this user's payer totals.
				if (
					inv.userId === input.userId &&
					inv.billedToUserId !== null &&
					inv.billedToUserId !== input.userId
				) {
					billedToOthersInCents += inv.totalInCents;
				}

				// Only count money the VIEWED user is responsible for / holds.
				const viewerIsPayer =
					inv.billedToUserId === input.userId ||
					(inv.billedToUserId === null && inv.userId === input.userId);
				if (!viewerIsPayer) continue;

				// Payer-scoped lifetime activity.
				totalBilledInCents += inv.totalInCents;
				totalPaidInCents += inv.amountPaidInCents;

				const balance = inv.totalInCents - inv.amountPaidInCents;
				if (balance > 0) {
					outstandingInCents += balance;
				} else if (balance < 0) {
					// Overpaid invoice = credit. Split the overpayment into the part
					// still available vs the part already applied elsewhere. (A legacy
					// carry-forward stamps creditConsumedAt but left
					// creditConsumedInCents at 0, so a stamped invoice counts as fully
					// consumed.)
					const overpayment = -balance;
					const applied =
						inv.creditConsumedAt != null
							? overpayment
							: Math.min(overpayment, inv.creditConsumedInCents);
					creditAppliedInCents += applied;
					availableCreditInCents += overpayment - applied;
				}
			}

			return {
				totalBilledInCents,
				totalPaidInCents,
				outstandingInCents,
				availableCreditInCents,
				creditAppliedInCents,
				billedToOthersInCents,
				invoices: invoices.map((inv) => ({
					invoiceId: inv.invoiceId,
					invoiceNumber: inv.invoiceNumber,
					status: inv.status,
					issueDate: inv.issueDate,
					dueDate: inv.dueDate,
					totalInCents: inv.totalInCents,
					amountPaidInCents: inv.amountPaidInCents,
					balanceInCents: inv.totalInCents - inv.amountPaidInCents,
					// Per-invoice REMAINING account credit (overpayment not yet drawn
					// down), using the same rule as the rollup above: 0 once fully
					// consumed (`creditConsumedAt` set, incl. legacy count-0 rows) or if
					// never overpaid. Lets the panel show credit that SHRINKS as it's
					// spent, instead of the static raw overpayment (`balanceInCents`).
					availableCreditInCents:
						inv.amountPaidInCents > inv.totalInCents &&
						inv.creditConsumedAt == null
							? Math.max(
									0,
									inv.amountPaidInCents -
										inv.totalInCents -
										inv.creditConsumedInCents,
								)
							: 0,
					// Phase 9a Round 4: surface close-tab state so the UI can render
					// the "closed" badge + gate the Close Tab button. The raw
					// `creditConsumedAt` timestamp stays internal — we expose only the
					// derived `availableCreditInCents` above.
					closedAt: inv.closedAt,
					closedBy: inv.closedBy,
					// Phase 9a Round 5 — bill-to surfacing. `billedToUserId` lets
					// the UI fast-check "is this row a bill-to?" without inspecting
					// the nested shape. `consumer` is always present (every
					// invoice has a member); `billedTo` is null exactly when
					// billedToUserId is null (self-pay).
					billedToUserId: inv.billedToUserId,
					consumer: {
						userId: inv.user.userId,
						firstName: inv.user.firstName,
						lastName: inv.user.lastName,
					},
					billedTo: inv.billedToUser
						? {
								userId: inv.billedToUser.userId,
								firstName: inv.billedToUser.firstName,
								lastName: inv.billedToUser.lastName,
							}
						: null,
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
	 * Phase 9a (B10) — full single-invoice detail. Powers the invoice detail
	 * pages: today the staff-facing `/clients/[userId]/invoices/[invoiceId]`
	 * and `/admin/invoices/[invoiceId]` views (which share one component), and
	 * a future member-facing view — all off this one query.
	 *
	 * Auth is `protectedProcedure` + an in-handler check rather than
	 * `facilityProcedure` so the SAME query serves members viewing their own
	 * invoice. A viewer may read an invoice when they are the consumer
	 * (`userId`), the payer (`billedToUserId`), or same-club staff
	 * (FACILITY/CLUB_ADMIN, or any PLATFORM_ADMIN across clubs). Everyone else —
	 * including a member probing another member's invoice id, or cross-club
	 * staff — gets NOT_FOUND, identical to a genuinely missing id, so the
	 * endpoint never confirms an invoice's existence to someone who can't see it.
	 *
	 * Returns the header, signed money (balance < 0 = account credit), the
	 * invoice-level staff `notes` comment, line items (with `kind`, the
	 * snapshot revenue category, and the resolved "Credit from <person>" source
	 * for CREDIT lines), payments (each with its refunded + net total), and the
	 * invoice's refunds. See designFiles/roadmap/phase9-invoicing.md (#10/#14).
	 */
	getInvoice: protectedProcedure
		.input(z.object({ invoiceId: z.string() }))
		.query(async ({ ctx, input }) => {
			// `protectedProcedure` only authenticates (ctx.auth = Clerk id); unlike
			// `facilityProcedure` it does NOT attach the DB user. `getCurrentUser`
			// (shared helper) resolves it from the Clerk id — throwing NOT_FOUND if
			// the account has no profile yet — so the consumer-OR-payer-OR-staff
			// authorization can live here and be reused by the future member view.
			const viewer = await getCurrentUser(ctx);

			const invoice = await ctx.db.invoice.findUnique({
				where: { invoiceId: input.invoiceId },
				include: {
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
					closedByUser: {
						select: { userId: true, firstName: true, lastName: true },
					},
					createdByUser: {
						select: { userId: true, firstName: true, lastName: true },
					},
					lineItems: {
						orderBy: { sortOrder: "asc" },
						include: {
							revenueCategory: {
								select: { revenueCategoryId: true, label: true },
							},
							creditFromUser: {
								select: { userId: true, firstName: true, lastName: true },
							},
							creditFromInvoice: {
								select: { invoiceId: true, invoiceNumber: true },
							},
						},
					},
					payments: {
						// Newest first; paymentId tiebreaker stabilizes equal-millisecond
						// rows (matches getMemberBilling).
						orderBy: [{ receivedAt: "desc" }, { paymentId: "asc" }],
						include: {
							receivedByUser: {
								select: { userId: true, firstName: true, lastName: true },
							},
							refunds: true,
						},
					},
					refunds: {
						orderBy: [{ refundedAt: "desc" }, { refundId: "asc" }],
						include: {
							refundedByUser: {
								select: { userId: true, firstName: true, lastName: true },
							},
						},
					},
				},
			});

			// A missing invoice and an invoice the viewer may not see BOTH return
			// NOT_FOUND, so an unauthorized viewer can't probe for invoice ids.
			if (!invoice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found",
				});
			}

			// Reuse the shared role/club helpers rather than re-deriving userType
			// comparisons. `isFacilityOrAbove` already includes PLATFORM_ADMIN; the
			// explicit `isPlatformAdmin` disjunct is what lets a platform admin read
			// ACROSS clubs, while facility/club admins are scoped to the invoice's
			// club via `isSameClub`.
			const isConsumer = invoice.userId === viewer.userId;
			const isPayer = invoice.billedToUserId === viewer.userId;
			const isStaffViewer =
				isPlatformAdmin(viewer) ||
				(isFacilityOrAbove(viewer) && isSameClub(viewer, invoice));
			if (!(isConsumer || isPayer || isStaffViewer)) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found",
				});
			}

			// Whether THIS viewer may void the invoice: a club admin or platform
			// admin, AND in the invoice's own club. The same-club gate applies even
			// to platform admins because `voidInvoice` (clubAdminProcedure) scopes
			// its lookup to the caller's own clubShortName — so the button must only
			// appear where the void will actually succeed, not on another club's
			// invoice where the mutation would 404. (Cross-club platform operations
			// would be a separate, broader change.) FACILITY staff are excluded.
			// Button-visibility gate only — the mutation re-checks authoritatively.
			const viewerIsClubAdmin =
				(isPlatformAdmin(viewer) || viewer.userType === UserType.CLUB_ADMIN) &&
				isSameClub(viewer, invoice);

			const balanceInCents = invoice.totalInCents - invoice.amountPaidInCents;

			return {
				invoiceId: invoice.invoiceId,
				invoiceNumber: invoice.invoiceNumber,
				status: invoice.status,
				// UI gate for the Void button (see above) — NOT security; the
				// voidInvoice mutation re-checks via clubAdminProcedure.
				viewerIsClubAdmin,
				issueDate: invoice.issueDate,
				dueDate: invoice.dueDate,
				closedAt: invoice.closedAt,
				createdAt: invoice.createdAt,
				subtotalInCents: invoice.subtotalInCents,
				taxTotalInCents: invoice.taxTotalInCents,
				totalInCents: invoice.totalInCents,
				amountPaidInCents: invoice.amountPaidInCents,
				// Signed: negative = account credit (Version A overpayment, #104).
				balanceInCents,
				// Invoice-level staff comment; renders on the PDF later (Phase 13).
				notes: invoice.notes,
				consumer: {
					userId: invoice.user.userId,
					firstName: invoice.user.firstName,
					lastName: invoice.user.lastName,
					email: invoice.user.email,
				},
				billedTo: invoice.billedToUser
					? {
							userId: invoice.billedToUser.userId,
							firstName: invoice.billedToUser.firstName,
							lastName: invoice.billedToUser.lastName,
							email: invoice.billedToUser.email,
						}
					: null,
				closedBy: invoice.closedByUser
					? {
							userId: invoice.closedByUser.userId,
							firstName: invoice.closedByUser.firstName,
							lastName: invoice.closedByUser.lastName,
						}
					: null,
				createdBy: {
					userId: invoice.createdByUser.userId,
					firstName: invoice.createdByUser.firstName,
					lastName: invoice.createdByUser.lastName,
				},
				lineItems: invoice.lineItems.map((li) => ({
					lineItemId: li.lineItemId,
					kind: li.kind,
					description: li.description,
					quantity: li.quantity,
					unitPriceInCents: li.unitPriceInCents,
					discountInCents: li.discountInCents,
					taxAmountInCents: li.taxAmountInCents,
					// Signed: negative on CREDIT lines.
					totalInCents: li.totalInCents,
					revenueCategory: li.revenueCategory
						? {
								revenueCategoryId: li.revenueCategory.revenueCategoryId,
								label: li.revenueCategory.label,
							}
						: null,
					// CREDIT lines name their source person + invoice (hardening #115).
					creditFrom: li.creditFromUser
						? {
								userId: li.creditFromUser.userId,
								firstName: li.creditFromUser.firstName,
								lastName: li.creditFromUser.lastName,
							}
						: null,
					creditFromInvoice: li.creditFromInvoice
						? {
								invoiceId: li.creditFromInvoice.invoiceId,
								invoiceNumber: li.creditFromInvoice.invoiceNumber,
							}
						: null,
				})),
				payments: invoice.payments.map((p) => {
					const refundedTotalInCents = p.refunds.reduce(
						(sum, r) => sum + r.amountInCents,
						0,
					);
					return {
						paymentId: p.paymentId,
						amountInCents: p.amountInCents,
						paymentMethod: p.paymentMethod,
						status: p.status,
						processor: p.processor,
						processorTransactionId: p.processorTransactionId,
						reference: p.reference,
						receivedAt: p.receivedAt,
						receivedBy: {
							userId: p.receivedByUser.userId,
							firstName: p.receivedByUser.firstName,
							lastName: p.receivedByUser.lastName,
						},
						refundedTotalInCents,
						netInCents: p.amountInCents - refundedTotalInCents,
					};
				}),
				refunds: invoice.refunds.map((r) => ({
					refundId: r.refundId,
					paymentId: r.paymentId,
					amountInCents: r.amountInCents,
					reason: r.reason,
					processor: r.processor,
					refundedAt: r.refundedAt,
					refundedBy: {
						userId: r.refundedByUser.userId,
						firstName: r.refundedByUser.firstName,
						lastName: r.refundedByUser.lastName,
					},
				})),
			};
		}),

	/**
	 * Phase 9a (B9) — paginated, searchable invoice list for the staff
	 * `/admin/invoices` page. Scoped to the caller's club (facilityProcedure).
	 *
	 * `search` (type-ahead, trimmed) matches the consumer's OR the payer's
	 * first/last name or email (case-insensitive `contains`, mirroring
	 * `user.searchMembers`), plus the invoice number, any line-item
	 * description, the invoice notes, and a payment reference (the manual
	 * check # / free-text field) — so staff can find an invoice by who's on
	 * it, its number, what's on it, a note, or how it was paid. Optional
	 * `status` filters on
	 * the STORED status (draft|open|partially_paid|paid|void); the derived
	 * "Due"/"Credit" labels are a display concern, not a filter axis.
	 *
	 * Cursor pagination (newest first, `invoiceId` tiebreaker for stability)
	 * returns `{ items, nextCursor }` — the client appends pages via
	 * useInfiniteQuery.
	 */
	listInvoices: facilityProcedure
		.input(
			z.object({
				search: z.string().trim().max(100).optional(),
				// Multi-select: empty/omitted = all statuses. Filters on the STORED
				// status only (the derived "Due"/"Credit" labels aren't queryable).
				status: z
					.array(z.enum(["draft", "open", "partially_paid", "paid", "void"]))
					.optional(),
				// Inclusive issue-date range as "YYYY-MM-DD" calendar dates, anchored
				// to day boundaries in the staff user's timezone (see issueDateFilter).
				startDate: z.string().date().optional(),
				endDate: z.string().date().optional(),
				cursor: z.string().nullish(),
				limit: z.number().int().min(1).max(50).default(20),
			}),
		)
		.query(async ({ ctx, input }) => {
			const search = input.search?.trim();

			// Date-range filter on issueDate. The UI sends calendar dates
			// ("YYYY-MM-DD"); we anchor them to day boundaries in the staff user's
			// timezone so "May 1 – May 23" means local midnight-to-midnight, not UTC
			// (which would slice a few hours off each end of the range).
			const tz = ctx.user.timeZone || "America/New_York";
			const issueDateFilter: Prisma.DateTimeFilter = {};
			if (input.startDate) {
				issueDateFilter.gte = dayjs
					.tz(input.startDate, tz)
					.startOf("day")
					.toDate();
			}
			if (input.endDate) {
				issueDateFilter.lte = dayjs.tz(input.endDate, tz).endOf("day").toDate();
			}
			const hasDateFilter = input.startDate != null || input.endDate != null;

			// Reused name/email matcher for either party (consumer or payer).
			const personMatch = search
				? {
						OR: [
							{ firstName: { contains: search, mode: "insensitive" as const } },
							{ lastName: { contains: search, mode: "insensitive" as const } },
							{ email: { contains: search, mode: "insensitive" as const } },
						],
					}
				: undefined;

			const rows = await ctx.db.invoice.findMany({
				where: {
					clubShortName: ctx.user.clubShortName,
					...(input.status && input.status.length > 0
						? { status: { in: input.status } }
						: {}),
					...(hasDateFilter ? { issueDate: issueDateFilter } : {}),
					...(search
						? {
								OR: [
									{ user: personMatch },
									{ billedToUser: personMatch },
									{
										invoiceNumber: {
											contains: search,
											mode: "insensitive" as const,
										},
									},
									// Find an invoice by what's ON it (e.g. "Summer Camp",
									// "Private Lesson") — matches any line item's description.
									{
										lineItems: {
											some: {
												description: {
													contains: search,
													mode: "insensitive" as const,
												},
											},
										},
									},
									// The invoice-level staff comment.
									{ notes: { contains: search, mode: "insensitive" as const } },
									// Payment reference — the human-entered check # / free-text
									// reference field. NOT the opaque processor transaction id
									// (staff never type that; it'd only add noise).
									{
										payments: {
											some: {
												reference: {
													contains: search,
													mode: "insensitive" as const,
												},
											},
										},
									},
								],
							}
						: {}),
				},
				orderBy: [{ issueDate: "desc" }, { invoiceId: "desc" }],
				take: input.limit + 1,
				...(input.cursor
					? { cursor: { invoiceId: input.cursor }, skip: 1 }
					: {}),
				include: {
					user: {
						select: {
							userId: true,
							firstName: true,
							lastName: true,
							email: true,
						},
					},
					billedToUser: {
						select: { userId: true, firstName: true, lastName: true },
					},
				},
			});

			let nextCursor: string | null = null;
			if (rows.length > input.limit) {
				const extra = rows.pop();
				nextCursor = extra?.invoiceId ?? null;
			}

			return {
				items: rows.map((inv) => ({
					invoiceId: inv.invoiceId,
					invoiceNumber: inv.invoiceNumber,
					status: inv.status,
					issueDate: inv.issueDate,
					dueDate: inv.dueDate,
					closedAt: inv.closedAt,
					totalInCents: inv.totalInCents,
					amountPaidInCents: inv.amountPaidInCents,
					balanceInCents: inv.totalInCents - inv.amountPaidInCents,
					billedToUserId: inv.billedToUserId,
					consumer: {
						userId: inv.user.userId,
						firstName: inv.user.firstName,
						lastName: inv.user.lastName,
					},
					billedTo: inv.billedToUser
						? {
								userId: inv.billedToUser.userId,
								firstName: inv.billedToUser.firstName,
								lastName: inv.billedToUser.lastName,
							}
						: null,
				})),
				nextCursor,
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
				// Phase 9a Round 5 — also select userId + billedToUserId so we
				// can derive the effective payer for the advisory lock below.
				select: {
					invoiceId: true,
					status: true,
					totalInCents: true,
					userId: true,
					billedToUserId: true,
				},
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

			// Phase 9a Round 5 — derive the effective payer for the advisory
			// lock (matches sellPackage's effective-payer logic). When the
			// invoice has billedToUserId set, the payer is the bill-to user;
			// otherwise the consumer (self-pay).
			const effectivePayerUserId = invoice.billedToUserId ?? invoice.userId;

			return await ctx.db.$transaction(async (tx) => {
				// Phase 9a Round 5 — advisory lock first, BEFORE any reads or
				// writes inside the tx. Shares the `invoice-payer-` prefix with
				// `sellPackage` and `closeInvoice` so all three invoice
				// mutations serialize per `(payer, club)`. Closes the
				// cross-class race where a concurrent sale on John's tab could
				// append a line and recompute status from a snapshot that
				// doesn't see this payment (the "$50 paid + concurrent $30
				// sale → invoice lands at `open` instead of `partially_paid`"
				// bug flagged in the Round 5 review).
				const lockKey = `invoice-payer-${effectivePayerUserId}-${ctx.user.clubShortName}`;
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

				// Row lock just this invoice for the transaction duration. Holding
				// the lock means a concurrent `recordPayment` on the same invoice
				// waits here rather than racing the aggregate-then-update sequence
				// below and clobbering each other's `amountPaidInCents`.
				//
				// CONTRACT FOR FUTURE A2 (recordRefund): the refund mutation MUST take
				// this same row lock at the same point in its transaction. Without it
				// a concurrent refund + payment can both read pre-write aggregates and
				// each write a stale `amountPaidInCents`. The recompute formula
				// (Σ payments − Σ refunds) is correct; what keeps it correct under
				// concurrency is BOTH sides holding the Invoice row lock.
				//
				// CONTRACT FOR FUTURE A2 (account credit reconciliation): a refund
				// returns paid dollars, but some of this invoice's overpayment may
				// already have been redistributed as account credit to OTHER invoices
				// (tracked by `creditConsumedInCents`, or fully-consumed when
				// `creditConsumedAt != null`). Those dollars are spent — refunding them
				// here too is a double-payout. recordRefund MUST NOT let net
				// `amountPaidInCents` fall below the credit already consumed from this
				// invoice. Simplest safe rule (mirrors `voidInvoice`, decision #121,
				// which PRECONDITION_FAILs on a consumed/credit-bearing invoice): BLOCK
				// refunding any invoice that has consumed credit and require the applied
				// credit to be reversed first; a precise partial cap is deferred until a
				// real case appears. See phase9-invoicing.md "Refunds vs. overpayment
				// credit".
				//
				// Raw SQL uses the same `$executeRaw` template-literal style as the
				// advisory-lock call in `rentals.ts` — Prisma parameterizes
				// `invoiceId` safely (no string interpolation into the SQL text).
				await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "invoiceId" = ${input.invoiceId} FOR UPDATE`;

				// Re-read totalInCents AFTER acquiring the lock. The pre-transaction
				// read (used for the cross-tenant + void/draft guards) can be STALE:
				// a concurrent `sellPackage` for the same payer may have appended a
				// line item and raised the total in the window before we got the
				// lock. Status MUST be judged against the current total — otherwise a
				// $50 payment on a now-$80 invoice would wrongly mark it `paid` +
				// auto-close, hiding a real $30 balance. (Round 5 review must-fix:
				// the advisory lock serializes the tx bodies, but the total was
				// captured before the lock; this closes that residual window.)
				const locked = await tx.invoice.findUniqueOrThrow({
					where: { invoiceId: input.invoiceId },
					select: { totalInCents: true },
				});
				const totalInCents = locked.totalInCents;

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
				//
				// Phase 9a Round 4 (HANDOFF #103): when status flips to "paid", we
				// ALSO stamp `closedAt`/`closedBy` in the SAME update. This is the
				// auto-close half of the close-tab feature — full payment terminates
				// the running tab so the next `sellPackage` opens a fresh invoice.
				// See designFiles/roadmap/phase9-invoicing.md.
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
						...(newStatus === "paid"
							? { closedAt: new Date(), closedBy: ctx.user.userId }
							: {}),
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

	/**
	 * Phase 9a Round 4 — manual close-tab.
	 *
	 * Staff click "Close Tab" on an `open` or `partially_paid` running tab to
	 * terminate it without requiring a final payment (e.g., they want to
	 * generate a separate invoice for the next charge, or settle a stalled tab
	 * out-of-band). Closing stamps `closedAt`/`closedBy`; `sellPackage` will
	 * skip closed invoices when looking for a running tab to append to, so the
	 * next charge opens a fresh invoice.
	 *
	 * Distinct from auto-close (in `recordPayment`): manual close handles the
	 * non-paid cases. Paid invoices already auto-closed on the payment that
	 * took them to `paid` status — they don't accept (and don't need) a
	 * manual close.
	 *
	 * See designFiles/roadmap/phase9-invoicing.md "Partial Payment & Overpayment
	 * Policy" / close-tab discussion, and HANDOFF.md decision #103.
	 */
	closeInvoice: facilityProcedure
		.input(z.object({ invoiceId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			// Cross-tenant guard (matches recordPayment pattern). Read outside
			// the transaction so the common 404/conflict cases short-circuit
			// without the locking-roundtrip overhead.
			const invoice = await ctx.db.invoice.findFirst({
				where: {
					invoiceId: input.invoiceId,
					clubShortName: ctx.user.clubShortName,
				},
				// Phase 9a Round 5 — also select userId + billedToUserId so we
				// can derive the effective payer for the advisory lock below.
				select: {
					invoiceId: true,
					status: true,
					closedAt: true,
					userId: true,
					billedToUserId: true,
				},
			});

			if (!invoice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found in this club",
				});
			}

			// Already closed (either manual close or auto-close on full payment).
			// Idempotent reject — the UI shouldn't surface the button, but defend
			// against stale optimistic state / double-clicks.
			if (invoice.closedAt !== null) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Invoice is already closed",
				});
			}

			// `void` is terminal — closing a voided invoice is nonsensical.
			if (invoice.status === "void") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Cannot close a void invoice",
				});
			}

			// Paid invoices auto-close in `recordPayment`'s transaction. Reaching
			// here with status="paid" + closedAt=null shouldn't happen post-Round-4,
			// but reject explicitly to surface any drift rather than silently
			// re-stamping `closedAt`.
			if (invoice.status === "paid") {
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"Paid invoices auto-close on full payment; no manual close needed",
				});
			}

			// Forward guard (mirrors recordPayment's draft reject — no UI flow
			// produces draft invoices today, so reject defensively until a
			// finalize flow exists).
			if (invoice.status === "draft") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Cannot close a draft invoice (no finalize flow exists yet)",
				});
			}

			// Phase 9a Round 5 — derive the effective payer for the advisory
			// lock (matches sellPackage / recordPayment).
			const effectivePayerUserId = invoice.billedToUserId ?? invoice.userId;

			return await ctx.db.$transaction(async (tx) => {
				// Phase 9a Round 5 — advisory lock first. Shares the
				// `invoice-payer-` prefix with `sellPackage` and `recordPayment`
				// so all three invoice mutations serialize per `(payer, club)`.
				// Closes the cross-class race where a concurrent sale/payment
				// could write conflicting state mid-close.
				const lockKey = `invoice-payer-${effectivePayerUserId}-${ctx.user.clubShortName}`;
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

				// Row lock for consistency with `recordPayment` — without it a
				// concurrent payment could race the close and we'd land in an
				// "closed + status not paid" state that contradicts an in-flight
				// payment that should have closed it via the paid path.
				await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "invoiceId" = ${input.invoiceId} FOR UPDATE`;

				// Phase 9a "Mark as due" — manually closing a tab IS the staff
				// "mark as due" action, so set `dueDate` to now alongside the close
				// stamps. No payment terms / penalties yet, so dueDate = the moment
				// marked due; the derived "Due"/"Overdue" label only diverges once
				// future terms make this a future date (see src/lib/invoiceStatus.ts).
				const now = new Date();
				const updated = await tx.invoice.update({
					where: { invoiceId: input.invoiceId },
					data: {
						closedAt: now,
						closedBy: ctx.user.userId,
						dueDate: now,
					},
					select: {
						invoiceId: true,
						status: true,
						closedAt: true,
						closedBy: true,
						dueDate: true,
					},
				});

				return { invoice: updated };
			});
		}),

	/**
	 * Phase 9a — context for the "Account Credit" payment option. For the target
	 * invoice's PAYER (billedToUserId ?? userId), returns how much spendable
	 * credit they hold, how much is owed on this invoice, and the amount actually
	 * applicable = min(owed, available). The modal uses this to show "Available:
	 * $X" and to cap/default the amount field.
	 */
	getAccountCreditContext: facilityProcedure
		.input(z.object({ invoiceId: z.string() }))
		.query(async ({ ctx, input }) => {
			const invoice = await ctx.db.invoice.findFirst({
				where: {
					invoiceId: input.invoiceId,
					clubShortName: ctx.user.clubShortName,
				},
				select: {
					invoiceNumber: true,
					userId: true,
					billedToUserId: true,
					totalInCents: true,
					amountPaidInCents: true,
				},
			});
			if (!invoice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found",
				});
			}

			const payerUserId = invoice.billedToUserId ?? invoice.userId;
			const owedInCents = Math.max(
				0,
				invoice.totalInCents - invoice.amountPaidInCents,
			);

			// Payer's unconsumed overpayment credit — same scoping as
			// sellPackage's carry-forward + getMemberBilling.
			const sources = await ctx.db.invoice.findMany({
				where: {
					clubShortName: ctx.user.clubShortName,
					status: "paid",
					closedAt: { not: null },
					creditConsumedAt: null,
					OR: [
						{ userId: payerUserId, billedToUserId: null },
						{ billedToUserId: payerUserId },
					],
				},
				select: {
					totalInCents: true,
					amountPaidInCents: true,
					creditConsumedInCents: true,
				},
			});
			const availableCreditInCents = sources.reduce(
				(sum, s) => sum + sourceAvailableCreditInCents(s),
				0,
			);

			return {
				invoiceNumber: invoice.invoiceNumber,
				owedInCents,
				availableCreditInCents,
				applicableInCents: Math.min(owedInCents, availableCreditInCents),
			};
		}),

	/**
	 * Phase 9a — apply a member's accrued account credit to reduce what's owed
	 * on a specific invoice. Surfaced as the "Account Credit" option in the
	 * Record Payment modal, but it is NOT a payment: no money changes hands, no
	 * `InvoicePayment` row is created, and it must never count as revenue. It is
	 * a credit transfer — overpayment liability the club already holds for the
	 * payer is moved to offset this invoice's charges; the charges remain the
	 * revenue.
	 *
	 * Mechanics (mirror sellPackage's carry-forward, FIFO oldest-credit-first):
	 *  - Draw down the payer's credit sources by `closedAt` asc, adding ONE
	 *    negative `kind=CREDIT` line PER source to the TARGET (so the target
	 *    shows where each chunk came from), and bumping each source's
	 *    `creditConsumedInCents` — stamping `creditConsumedAt` only once a source
	 *    is fully spent (this is what enables PARTIAL consumption).
	 *  - Recompute the target's subtotal/total + status, auto-closing if the
	 *    credit settles it (mirrors the package-sale recompute).
	 *
	 * Capped at min(amount owed, available credit): you can't overspend credit,
	 * and you can't over-apply (which would just recreate credit on the target).
	 * Serialized with the other invoice mutations via the per-payer advisory lock.
	 */
	applyAccountCredit: facilityProcedure
		.input(
			z.object({
				invoiceId: z.string(),
				amountInCents: z.number().int().positive(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const target = await ctx.db.invoice.findFirst({
				where: {
					invoiceId: input.invoiceId,
					clubShortName: ctx.user.clubShortName,
				},
				select: {
					invoiceId: true,
					invoiceNumber: true,
					userId: true,
					billedToUserId: true,
					status: true,
				},
			});
			if (!target) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found",
				});
			}
			if (target.status === "void") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Cannot apply credit to a void invoice",
				});
			}
			if (target.status === "draft") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Cannot apply credit to a draft invoice",
				});
			}

			const payerUserId = target.billedToUserId ?? target.userId;

			return await ctx.db.$transaction(async (tx) => {
				// Same per-payer advisory lock as sellPackage/recordPayment/
				// closeInvoice — serializes ALL credit movement for this payer, so
				// reading + drawing down the sources below is race-free without a
				// separate row lock on each source.
				const lockKey = `invoice-payer-${payerUserId}-${ctx.user.clubShortName}`;
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;
				await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "invoiceId" = ${input.invoiceId} FOR UPDATE`;

				// Re-read the target under the lock — owed may have shifted since
				// the modal computed its cap.
				const locked = await tx.invoice.findUniqueOrThrow({
					where: { invoiceId: input.invoiceId },
					select: {
						subtotalInCents: true,
						totalInCents: true,
						amountPaidInCents: true,
					},
				});
				const owed = locked.totalInCents - locked.amountPaidInCents;
				if (owed <= 0) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Invoice has no outstanding balance to apply credit to",
					});
				}
				if (input.amountInCents > owed) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Amount exceeds the invoice balance",
					});
				}

				// Payer's credit sources, oldest credit first (FIFO).
				const sources = await tx.invoice.findMany({
					where: {
						clubShortName: ctx.user.clubShortName,
						status: "paid",
						closedAt: { not: null },
						creditConsumedAt: null,
						OR: [
							{ userId: payerUserId, billedToUserId: null },
							{ billedToUserId: payerUserId },
						],
					},
					orderBy: { closedAt: "asc" },
					select: {
						invoiceId: true,
						invoiceNumber: true,
						totalInCents: true,
						amountPaidInCents: true,
						creditConsumedInCents: true,
						userId: true,
						billedToUserId: true,
					},
				});
				const available = sources.reduce(
					(sum, s) => sum + sourceAvailableCreditInCents(s),
					0,
				);
				if (input.amountInCents > available) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Amount exceeds available account credit",
					});
				}

				// Append the credit lines after any existing line items.
				const lastLine = await tx.invoiceLineItem.findFirst({
					where: { invoiceId: target.invoiceId },
					orderBy: { sortOrder: "desc" },
					select: { sortOrder: true },
				});
				let sortOrder = (lastLine?.sortOrder ?? -1) + 1;

				let remaining = input.amountInCents;
				let appliedInCents = 0;
				for (const s of sources) {
					if (remaining <= 0) break;
					const srcAvailable = sourceAvailableCreditInCents(s);
					if (srcAvailable <= 0) continue;
					const chunk = Math.min(remaining, srcAvailable);

					assertLineItemKindConsistency({
						kind: "CREDIT",
						creditFromInvoiceId: s.invoiceId,
					});
					await tx.invoiceLineItem.create({
						data: {
							invoiceId: target.invoiceId,
							kind: "CREDIT",
							description: `Account credit from ${s.invoiceNumber}`,
							quantity: 1,
							unitPriceInCents: -chunk,
							discountInCents: 0,
							taxRateBps: 0,
							taxAmountInCents: 0,
							totalInCents: -chunk,
							sortOrder,
							creditFromInvoiceId: s.invoiceId,
							creditFromUserId: s.billedToUserId ?? s.userId,
						},
					});
					sortOrder += 1;

					const overpayment = s.amountPaidInCents - s.totalInCents;
					const newConsumed = s.creditConsumedInCents + chunk;
					await tx.invoice.update({
						where: { invoiceId: s.invoiceId },
						data: {
							creditConsumedInCents: newConsumed,
							...(newConsumed >= overpayment
								? { creditConsumedAt: new Date() }
								: {}),
						},
					});

					remaining -= chunk;
					appliedInCents += chunk;
				}

				// Recompute the target's subtotal/total + status from the applied
				// total (mirrors the package-sale recompute; the zero-tax credit
				// lines leave tax untouched). Auto-close if the credit settles it.
				const newSubtotal = locked.subtotalInCents - appliedInCents;
				const newTotal = locked.totalInCents - appliedInCents;
				const amountPaid = locked.amountPaidInCents;
				let newStatus: string;
				if (amountPaid >= newTotal) {
					newStatus = "paid";
				} else if (amountPaid <= 0) {
					newStatus = "open";
				} else {
					newStatus = "partially_paid";
				}

				const updated = await tx.invoice.update({
					where: { invoiceId: target.invoiceId },
					data: {
						subtotalInCents: newSubtotal,
						totalInCents: newTotal,
						status: newStatus,
						...(newStatus === "paid"
							? { closedAt: new Date(), closedBy: ctx.user.userId }
							: {}),
					},
					select: {
						invoiceId: true,
						invoiceNumber: true,
						status: true,
						totalInCents: true,
						amountPaidInCents: true,
					},
				});

				return { invoice: updated, appliedInCents };
			});
		}),

	/**
	 * Phase 9a (A4) — void an invoice. clubAdmin-gated. Marks status="void"
	 * (excluded from billing/reporting) and appends the required reason to the
	 * invoice's `notes`. Does NOT touch line items, granted MemberPackage
	 * credits, payments, or applied credit — void is a document-level cancel,
	 * not a reversal (the confirm dialog warns staff to reverse a package sale
	 * separately if that's what they actually want).
	 *
	 * Guards (a void must leave no money or credit dangling):
	 *  - already void → CONFLICT.
	 *  - any net payment (amountPaid > 0) → PRECONDITION_FAILED (refund first).
	 *    This also covers overpaid / credit-SOURCE invoices (they hold a payment).
	 *  - carries CREDIT line items (account credit applied TO this invoice) →
	 *    PRECONDITION_FAILED (un-applying credit isn't a built action yet; block
	 *    to protect the credit ledger).
	 * Re-checks inside the shared per-payer advisory lock so a payment/credit
	 * that committed just before the lock can't slip a void through (mirrors the
	 * recordPayment stale-read fix, HANDOFF #118).
	 */
	voidInvoice: clubAdminProcedure
		.input(
			z.object({
				invoiceId: z.string(),
				reason: z.string().trim().min(1, "A reason is required").max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const reason = input.reason.trim();

			// Cross-tenant guard + pre-lock fast-fail (mirrors closeInvoice).
			const invoice = await ctx.db.invoice.findFirst({
				where: {
					invoiceId: input.invoiceId,
					clubShortName: ctx.user.clubShortName,
				},
				select: {
					invoiceId: true,
					status: true,
					amountPaidInCents: true,
					userId: true,
					billedToUserId: true,
				},
			});
			if (!invoice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found in this club",
				});
			}
			if (invoice.status === "void") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Invoice is already void",
				});
			}
			if (invoice.amountPaidInCents > 0) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This invoice has a payment recorded. Refund the payment before voiding.",
				});
			}

			const effectivePayerUserId = invoice.billedToUserId ?? invoice.userId;

			return await ctx.db.$transaction(async (tx) => {
				// Same per-payer advisory lock as sellPackage / recordPayment /
				// closeInvoice / applyAccountCredit — serializes every invoice
				// mutation for this (payer, club).
				const lockKey = `invoice-payer-${effectivePayerUserId}-${ctx.user.clubShortName}`;
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;
				await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "invoiceId" = ${input.invoiceId} FOR UPDATE`;

				// Re-read INSIDE the lock — a payment/credit could have committed
				// between the pre-lock read and acquiring the lock.
				const locked = await tx.invoice.findUniqueOrThrow({
					where: { invoiceId: input.invoiceId },
					select: { status: true, notes: true, amountPaidInCents: true },
				});
				if (locked.status === "void") {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Invoice is already void",
					});
				}
				if (locked.amountPaidInCents > 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"This invoice has a payment recorded. Refund the payment before voiding.",
					});
				}
				const creditLineCount = await tx.invoiceLineItem.count({
					where: { invoiceId: input.invoiceId, kind: "CREDIT" },
				});
				if (creditLineCount > 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"This invoice has account credit applied to it. Remove the applied credit before voiding.",
					});
				}

				// Decision: the void reason lives in the invoice `notes` (no separate
				// column). Stamp the time in the acting staff's timezone.
				const stamp = dayjs()
					.tz(ctx.user.timeZone || "America/New_York")
					.format("YYYY-MM-DD HH:mm");
				const voidNote = `[Voided ${stamp}] ${reason}`;
				const newNotes = locked.notes
					? `${locked.notes}\n${voidNote}`
					: voidNote;

				const updated = await tx.invoice.update({
					where: { invoiceId: input.invoiceId },
					data: { status: "void", notes: newNotes },
					select: {
						invoiceId: true,
						invoiceNumber: true,
						status: true,
						notes: true,
					},
				});
				return { invoice: updated };
			});
		}),
});
