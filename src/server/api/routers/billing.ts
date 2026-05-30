import { type Prisma, UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import dayjs from "~/lib/dayjs-config";
import { phoneFromProfileData } from "~/lib/studentProfile";
import {
	clubAdminProcedure,
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import {
	AUDIT_ACTIONS,
	AUDIT_SOURCES,
	buildPartyAuditEntries,
	writeAuditedMutation,
} from "~/server/utils/auditedMutation";
import { assertLineItemKindConsistency } from "~/server/utils/invoiceLineItems";
import {
	recordPaymentInternal,
	recordRefundInternal,
} from "~/server/utils/invoicePayments";
import { getOrCreateOpenInvoice } from "~/server/utils/invoiceTab";
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
	getMemberBilling: protectedProcedure
		.input(z.object({ userId: z.string() }))
		.query(async ({ ctx, input }) => {
			// Phase 9a member-view widening — viewer is EITHER the target
			// member (self) OR same-club staff. Mirrors getInvoice's
			// protectedProcedure + in-handler auth pattern (~line 377) and
			// replaces the previous facilityProcedure-only cross-tenant
			// guard so the member-facing /invoices page can reuse this
			// query as-is (same shape, same Round-5 widening to
			// consumer-OR-payer invoices).
			const viewer = await getCurrentUser(ctx);
			const member = await ctx.db.user.findUnique({
				where: { userId: input.userId },
				select: { userId: true, clubShortName: true },
			});

			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found",
				});
			}

			const isSelf = viewer.userId === input.userId;
			const isStaffViewer =
				isPlatformAdmin(viewer) ||
				(isFacilityOrAbove(viewer) &&
					viewer.clubShortName === member.clubShortName);
			if (!(isSelf || isStaffViewer)) {
				// 404 (not 403) so cross-club probes can't enumerate userIds.
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found",
				});
			}
			const clubShortName = member.clubShortName;

			const invoices = await ctx.db.invoice.findMany({
				where: {
					clubShortName,
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
							// Phase 9b — surface phone on the invoice detail view + PDF
							// "Bill to / For" blocks. Phone lives in the JSON
							// profileData blob (TD-1); we read it raw here and parse
							// safely below. Address is reserved (no column yet).
							studentProfile: { select: { profileData: true } },
						},
					},
					billedToUser: {
						select: {
							userId: true,
							firstName: true,
							lastName: true,
							email: true,
							studentProfile: { select: { profileData: true } },
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

			// UI gate for the per-payment Refund button — refunds are blocked when
			// this invoice's overpayment credit was applied elsewhere (D1).
			const hasConsumedCredit =
				invoice.creditConsumedInCents > 0 || invoice.creditConsumedAt !== null;

			const balanceInCents = invoice.totalInCents - invoice.amountPaidInCents;

			return {
				invoiceId: invoice.invoiceId,
				invoiceNumber: invoice.invoiceNumber,
				// Phase 12a — surfaced so the member-facing pay-now button can
				// resolve the right ClubStripeAccount via `getProviderForClub`
				// (Stream 2 + Stream 6). Already part of the row; pure select add.
				clubShortName: invoice.clubShortName,
				status: invoice.status,
				// UI gate for the Void button (see above) — NOT security; the
				// voidInvoice mutation re-checks via clubAdminProcedure.
				viewerIsClubAdmin,
				// UI gate for the per-payment Refund button (D1 — refunds blocked
				// once this invoice's credit was consumed elsewhere).
				hasConsumedCredit,
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
					// Phase 9b — phone read defensively from the StudentProfile
					// JSON blob (TD-1; same shape ProfileFieldsCard uses).
					phone: phoneFromProfileData(invoice.user.studentProfile?.profileData),
				},
				billedTo: invoice.billedToUser
					? {
							userId: invoice.billedToUser.userId,
							firstName: invoice.billedToUser.firstName,
							lastName: invoice.billedToUser.lastName,
							email: invoice.billedToUser.email,
							phone: phoneFromProfileData(
								invoice.billedToUser.studentProfile?.profileData,
							),
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

			// Phase 12a — body extracted to `recordPaymentInternal` so the future
			// Stripe webhook can record payments via the same path (Round 2).
			// The pre-lock cross-tenant + void/draft guards above stay in this
			// wrapper; the helper owns the advisory lock + FOR UPDATE + recompute
			// + status mutation + `writeAuditedMutation` (phase12 §23 #6 / §9.3.1
			// Choice B).
			return await recordPaymentInternal({
				db: ctx.db,
				clubShortName: ctx.user.clubShortName,
				actorUserId: ctx.user.userId,
				source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				invoice: {
					invoiceId: invoice.invoiceId,
					userId: invoice.userId,
					billedToUserId: invoice.billedToUserId,
				},
				receivedByUserId: ctx.user.userId,
				input,
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

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
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

					return {
						result: { invoice: updated },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.INVOICE_MARKED_DUE,
							consumerUserId: invoice.userId,
							payerUserId: invoice.billedToUserId,
							entityType: "Invoice",
							entityId: invoice.invoiceId,
							metadata: { invoiceId: invoice.invoiceId },
						}),
					};
				},
			);
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

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
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

					return {
						result: { invoice: updated, appliedInCents },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.ACCOUNT_CREDIT_APPLIED,
							consumerUserId: target.userId,
							payerUserId,
							entityType: "Invoice",
							entityId: target.invoiceId,
							metadata: { appliedInCents, invoiceId: target.invoiceId },
						}),
					};
				},
			);
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

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
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
					return {
						result: { invoice: updated },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.INVOICE_VOIDED,
							consumerUserId: invoice.userId,
							payerUserId: invoice.billedToUserId,
							entityType: "Invoice",
							entityId: invoice.invoiceId,
							metadata: { invoiceId: invoice.invoiceId, reason },
						}),
					};
				},
			);
		}),

	/**
	 * Phase 9a (A2) — refund a payment. clubAdmin-gated. Records an
	 * `InvoiceRefund` row (never deletes/mutates the payment), recomputes the
	 * payment's status + the invoice's net `amountPaidInCents` + status, and
	 * emits a `REFUND_ISSUED` audit row.
	 *
	 * BOOKKEEPING ONLY (D3): does NOT call any payment processor — staff hand
	 * back cash / refund in the processor dashboard separately; processor-backed
	 * refunds plug into the same row at Phase 12.
	 *
	 * Guards:
	 *  - payment must be in the caller's club; invoice not void.
	 *  - D1: BLOCK when the invoice has CONSUMED credit (`creditConsumedInCents`
	 *    > 0 or `creditConsumedAt` set) — its overpayment was applied as account
	 *    credit to OTHER invoices, so refunding it would double-pay. Refunding
	 *    consumed credit is deliberately out of scope (mirrors voidInvoice #121).
	 *    Refunding a payment whose overpayment is still unspent is fine (R4).
	 *  - no over-refund: amount ≤ payment.amount − already-refunded.
	 *  - D2: a refund that re-opens a balance on a paid (auto-closed) invoice
	 *    leaves `closedAt` UNTOUCHED — it shows "Due" again; new charges still
	 *    open a fresh invoice. No auto-reopen.
	 * Serialized via the shared per-payer advisory lock (#113); the credit +
	 * over-refund guards are RE-CHECKED inside the lock (a concurrent
	 * applyAccountCredit / refund could move them after the pre-lock read).
	 */
	recordRefund: clubAdminProcedure
		.input(
			z.object({
				paymentId: z.string(),
				amountInCents: z.number().int().positive(),
				reason: z.string().trim().min(1, "A reason is required").max(500),
				processorRefundId: z.string().max(255).optional(),
				processorFeeInCents: z.number().int().nonnegative().optional(),
				notes: z.string().max(2000).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const reason = input.reason.trim();

			// Cross-tenant guard + pre-lock fast-fail. The invoice carries the
			// club + payer + credit markers we need.
			const payment = await ctx.db.invoicePayment.findFirst({
				where: {
					paymentId: input.paymentId,
					invoice: { clubShortName: ctx.user.clubShortName },
				},
				select: {
					amountInCents: true,
					processor: true,
					invoiceId: true,
					invoice: {
						select: {
							status: true,
							userId: true,
							billedToUserId: true,
							creditConsumedInCents: true,
							creditConsumedAt: true,
						},
					},
				},
			});
			if (!payment) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Payment not found in this club",
				});
			}
			if (payment.invoice.status === "void") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Cannot refund a payment on a void invoice",
				});
			}
			// D1 — refunding consumed account credit is out of scope.
			if (
				payment.invoice.creditConsumedInCents > 0 ||
				payment.invoice.creditConsumedAt !== null
			) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"This invoice's overpayment was applied as account credit to other invoices, so it can't be refunded here.",
				});
			}

			// Phase 12a — body extracted to `recordRefundInternal` so the future
			// Stripe Connect webhook (Path B) can sync dashboard-initiated refunds
			// through the same helper. Pre-lock D1 + void guards above stay in
			// this wrapper for the fast 404/CONFLICT fail; the helper owns the
			// advisory lock + FOR UPDATE + re-checked D1/void + recompute +
			// `writeAuditedMutation` (phase12 §23 #6 / §9.3.1 Choice B).
			return await recordRefundInternal({
				db: ctx.db,
				clubShortName: ctx.user.clubShortName,
				actorUserId: ctx.user.userId,
				source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				payment: {
					paymentId: input.paymentId,
					amountInCents: payment.amountInCents,
					processor: payment.processor,
					invoiceId: payment.invoiceId,
					invoice: {
						userId: payment.invoice.userId,
						billedToUserId: payment.invoice.billedToUserId,
					},
				},
				refundedByUserId: ctx.user.userId,
				input: {
					paymentId: input.paymentId,
					amountInCents: input.amountInCents,
					reason,
					processorRefundId: input.processorRefundId,
					processorFeeInCents: input.processorFeeInCents,
					notes: input.notes,
				},
			});
		}),

	/**
	 * Phase 9a — add an ad-hoc / one-off charge to a member's running tab
	 * (drinks, equipment, fees, or any catalog Product sold directly). Mirrors
	 * the package-sale path: routes through `getOrCreateOpenInvoice` (same
	 * advisory lock, numbering, Option-3 keying, recompute + auto-close) and
	 * appends ONE line item — `PRODUCT_SALE` when a catalog product is chosen
	 * (snapshots its revenue category), else a free-text `FEE`. No tax/discount
	 * in v1. `facilityProcedure` (front-desk action, like recordPayment).
	 * Optional `billToUserId` bills a different payer (keyed to that payer's tab);
	 * omitted = self-pay.
	 */
	addAdHocCharge: facilityProcedure
		.input(
			z.object({
				userId: z.string().min(1),
				billToUserId: z.string().min(1).optional(),
				// null = custom free-text fee; set = a catalog product sold directly.
				productId: z.string().min(1).nullable(),
				description: z.string().trim().min(1).max(500),
				quantity: z.number().int().positive().max(1000),
				// Cents; editable by staff even for a catalog product. $1M per-unit
				// cap protects against gibberish input; the multiplied line total
				// (price × qty) has its own cap in the handler below to stay within
				// the Int32 column range on Invoice/InvoiceLineItem.
				unitPriceInCents: z.number().int().positive().max(100_000_000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const member = await ctx.db.user.findFirst({
				where: { userId: input.userId, clubShortName: ctx.user.clubShortName },
				select: { userId: true, activeFacilityId: true },
			});
			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found in this club",
				});
			}

			// Validate bill-to (when provided and not the consumer); derive the
			// effective payer used for tab routing + the advisory lock.
			if (input.billToUserId && input.billToUserId !== input.userId) {
				const billTo = await ctx.db.user.findFirst({
					where: {
						userId: input.billToUserId,
						clubShortName: ctx.user.clubShortName,
					},
					select: { userId: true },
				});
				if (!billTo) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Bill-to user not found in this club",
					});
				}
			}
			const effectivePayerUserId =
				input.billToUserId && input.billToUserId !== input.userId
					? input.billToUserId
					: input.userId;

			// Catalog product → snapshot its revenue category onto the line. Matches
			// `sellPackage`'s guardrail: only ACTIVE products can be sold (staff can
			// reactivate an archived product first if they really need to bill it).
			let revenueCategoryId: string | null = null;
			if (input.productId) {
				const product = await ctx.db.product.findFirst({
					where: {
						productId: input.productId,
						clubShortName: ctx.user.clubShortName,
						isActive: true,
					},
					select: { productId: true, revenueCategoryId: true },
				});
				if (!product) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Product not found in this club",
					});
				}
				revenueCategoryId = product.revenueCategoryId;
			}

			const kind = input.productId ? "PRODUCT_SALE" : "FEE";
			const lineSubtotalInCents = input.unitPriceInCents * input.quantity;
			const lineTotalInCents = lineSubtotalInCents; // no tax/discount in v1

			// Invoice.totalInCents / InvoiceLineItem.totalInCents are Postgres Int4
			// (~$21.47M max). Per-unit + quantity bounds individually allow a line
			// total up to $1B in cents — cap the multiplied total here so a
			// pathological pair never overflows the column at insert time. Same
			// $1M ceiling as the per-unit cap, applied to the line as a whole.
			if (lineTotalInCents > 100_000_000) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Line total cannot exceed $1,000,000",
				});
			}

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					// Advisory lock FIRST — the precondition getOrCreateOpenInvoice
					// documents; shared `invoice-payer-` key serializes all charge +
					// payment activity on this payer's tab.
					const lockKey = `invoice-payer-${effectivePayerUserId}-${ctx.user.clubShortName}`;
					await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

					const { invoice, totalCreditPulledCents } =
						await getOrCreateOpenInvoice(tx, {
							clubShortName: ctx.user.clubShortName,
							consumerUserId: input.userId,
							effectivePayerUserId,
							facilityId: member.activeFacilityId,
							createdByUserId: ctx.user.userId,
						});

					// Append AFTER existing lines (and after any credit lines on a fresh
					// invoice): next sortOrder = current max + 1.
					const lastLine = await tx.invoiceLineItem.findFirst({
						where: { invoiceId: invoice.invoiceId },
						orderBy: { sortOrder: "desc" },
						select: { sortOrder: true },
					});
					const sortOrder = (lastLine?.sortOrder ?? -1) + 1;

					assertLineItemKindConsistency({ kind, productId: input.productId });
					await tx.invoiceLineItem.create({
						data: {
							invoiceId: invoice.invoiceId,
							kind,
							productId: input.productId,
							description: input.description,
							quantity: input.quantity,
							unitPriceInCents: input.unitPriceInCents,
							discountInCents: 0,
							taxRateBps: 0,
							taxAmountInCents: 0,
							totalInCents: lineTotalInCents,
							revenueCategoryId,
							sortOrder,
						},
					});

					// Recompute subtotal/total + status (mirrors sellPackage). On a fresh
					// tab `totalCreditPulledCents` is 0 (auto-apply off) → "old + charge".
					const subtotalDelta = lineSubtotalInCents - totalCreditPulledCents;
					const totalDelta = lineTotalInCents - totalCreditPulledCents;
					const newSubtotal = invoice.subtotalInCents + subtotalDelta;
					const newTotal = invoice.totalInCents + totalDelta;
					const amountPaid = invoice.amountPaidInCents;
					let newStatus: string;
					if (amountPaid >= newTotal) {
						newStatus = "paid";
					} else if (amountPaid <= 0) {
						newStatus = "open";
					} else {
						newStatus = "partially_paid";
					}
					const shouldAutoClose = newStatus === "paid";

					const updatedInvoice = await tx.invoice.update({
						where: { invoiceId: invoice.invoiceId },
						data: {
							subtotalInCents: newSubtotal,
							totalInCents: newTotal,
							status: newStatus,
							...(shouldAutoClose
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

					return {
						result: { invoice: updatedInvoice },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.ADHOC_CHARGE_ADDED,
							consumerUserId: input.userId,
							// Single source of truth — `effectivePayerUserId` already
							// collapses to the consumer for self-pay; null it back here so
							// the audit emits ONE row for self-pay and the consumer+payer
							// pair for bill-to (the `buildPartyAuditEntries` convention).
							payerUserId:
								effectivePayerUserId === input.userId
									? null
									: effectivePayerUserId,
							entityType: "Invoice",
							entityId: updatedInvoice.invoiceId,
							metadata: {
								kind,
								productId: input.productId,
								description: input.description,
								quantity: input.quantity,
								unitPriceInCents: input.unitPriceInCents,
								lineTotalInCents,
								invoiceId: updatedInvoice.invoiceId,
							},
						}),
					};
				},
			);
		}),

	/**
	 * Phase 9a (E18 detection) — list a member's UNCOVERED billable event
	 * registrations. A row is returned when:
	 *  - the registration is for an event with a productId + creditCost > 0
	 *    (billable per decision #9),
	 *  - the registration's status is billable per #9 (CHECKED_IN / NO_SHOW /
	 *    LATE_CANCEL — Attended / No-show / Late-cancel),
	 *  - NO PackageCreditUsage row links this registration (credit didn't cover
	 *    it — consumeCredit returned no_match/insufficient at registration/check-in),
	 *  - NO InvoiceLineItem already points at this registration (not yet billed —
	 *    the new eventRegistrationId FK is the idempotency key).
	 * Powers the "Needs billing" 1-click list on the member's client page.
	 */
	listUncoveredEvents: facilityProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const member = await ctx.db.user.findFirst({
				where: { userId: input.userId, clubShortName: ctx.user.clubShortName },
				select: { userId: true },
			});
			if (!member) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Member not found in this club",
				});
			}
			const rows = await ctx.db.eventRegistration.findMany({
				where: {
					userId: input.userId,
					status: { in: ["CHECKED_IN", "NO_SHOW", "LATE_CANCEL"] },
					event: {
						clubShortName: ctx.user.clubShortName,
						isDeleted: false,
						productId: { not: null },
						creditCost: { gt: 0 },
					},
					// No credit was consumed AND no invoice line has billed it yet.
					creditUsages: { none: {} },
					invoiceLineItems: { none: {} },
				},
				select: {
					registrationId: true,
					status: true,
					event: {
						select: {
							eventId: true,
							title: true,
							start: true,
							creditCost: true,
							product: {
								select: {
									productId: true,
									name: true,
									priceInCents: true,
									isActive: true,
								},
							},
						},
					},
				},
				orderBy: { event: { start: "desc" } },
				take: 100,
			});
			return {
				rows: rows.map((r) => ({
					registrationId: r.registrationId,
					status: r.status,
					eventId: r.event.eventId,
					eventTitle: r.event.title,
					eventStart: r.event.start,
					creditCost: r.event.creditCost ?? 1,
					productName: r.event.product?.name ?? null,
					productId: r.event.product?.productId ?? null,
					priceInCents: r.event.product?.priceInCents ?? 0,
					productIsActive: r.event.product?.isActive ?? false,
				})),
			};
		}),

	/**
	 * Phase 9a (E18 1-click bill) — bill an uncovered billable event registration.
	 * Creates an EVENT_REGISTRATION line item linked to the registration via
	 * `eventRegistrationId` (the idempotency key). Routes through
	 * `getOrCreateOpenInvoice` (same advisory lock + Option-3 (consumer,payer)
	 * tab keying + recompute + auto-close as sellPackage / addAdHocCharge).
	 *
	 * Guards (the second three re-checked INSIDE the per-payer advisory lock):
	 *  - registration belongs to caller's club, event not deleted, has a product,
	 *    product is active (matches sellPackage's guardrail),
	 *  - status is billable per #9 (CHECKED_IN / NO_SHOW / LATE_CANCEL),
	 *  - IDEMPOTENCY: no InvoiceLineItem with this eventRegistrationId — CONFLICT
	 *    otherwise (a concurrent staff click would otherwise double-bill since
	 *    eventRegistrationId has no DB-level unique constraint yet),
	 *  - no PackageCreditUsage row for this registration (a concurrent staff
	 *    check-in could have just consumed credit — CONFLICT, "covered by package").
	 *
	 * Optional `billToUserId` bills a different payer (parent etc.); omitted =
	 * self-pay (the consumer is the payer).
	 */
	chargeEventRegistration: facilityProcedure
		.input(
			z.object({
				registrationId: z.string().min(1),
				billToUserId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const reg = await ctx.db.eventRegistration.findFirst({
				where: { registrationId: input.registrationId },
				select: {
					registrationId: true,
					userId: true,
					status: true,
					user: {
						select: {
							userId: true,
							activeFacilityId: true,
							clubShortName: true,
						},
					},
					event: {
						select: {
							eventId: true,
							title: true,
							start: true,
							productId: true,
							isDeleted: true,
							clubShortName: true,
							product: {
								select: {
									productId: true,
									priceInCents: true,
									revenueCategoryId: true,
									isActive: true,
								},
							},
						},
					},
				},
			});
			if (
				!reg ||
				reg.user.clubShortName !== ctx.user.clubShortName ||
				reg.event.clubShortName !== ctx.user.clubShortName
			) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Registration not found in this club",
				});
			}
			if (reg.event.isDeleted) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Cannot bill a deleted event",
				});
			}
			if (!reg.event.productId || !reg.event.product) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"Event has no linked product — not billable as an event charge",
				});
			}
			if (!reg.event.product.isActive) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"The event's product is inactive — reactivate or use Add charge with a custom amount",
				});
			}
			// Local non-null alias so TS narrowing carries into the tx callback
			// below (the closure otherwise loses the narrowing on
			// `reg.event.product` across the async boundary).
			const product = reg.event.product;
			const BILLABLE_STATUSES = new Set([
				"CHECKED_IN",
				"NO_SHOW",
				"LATE_CANCEL",
			]);
			if (!BILLABLE_STATUSES.has(reg.status)) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: `Registration status ${reg.status} is not billable`,
				});
			}

			// Bill-to validation (when provided and not the consumer).
			if (input.billToUserId && input.billToUserId !== reg.userId) {
				const billTo = await ctx.db.user.findFirst({
					where: {
						userId: input.billToUserId,
						clubShortName: ctx.user.clubShortName,
					},
					select: { userId: true },
				});
				if (!billTo) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Bill-to user not found in this club",
					});
				}
			}
			const effectivePayerUserId =
				input.billToUserId && input.billToUserId !== reg.userId
					? input.billToUserId
					: reg.userId;

			const unitPriceInCents = product.priceInCents;
			if (unitPriceInCents <= 0) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"Event product has no price — use Add charge with a custom amount",
				});
			}
			// Same Int4 ceiling as addAdHocCharge — defensive guard for absurd prices.
			if (unitPriceInCents > 100_000_000) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Event price cannot exceed $1,000,000",
				});
			}
			const lineTotalInCents = unitPriceInCents; // qty 1, no tax/discount in v1

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					// Advisory lock FIRST — shared `invoice-payer-` key serializes all
					// charge + payment activity on this payer's tab (the precondition
					// documented on getOrCreateOpenInvoice).
					const lockKey = `invoice-payer-${effectivePayerUserId}-${ctx.user.clubShortName}`;
					await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;

					// Idempotency re-check INSIDE the lock: another concurrent click
					// (or a stale-list submission) must not double-bill the same
					// session. The eventRegistrationId FK lacks a DB-level unique
					// constraint (additive nullable column, no @@unique migration yet),
					// so this app-level guard is what keeps the books honest.
					const existingLine = await tx.invoiceLineItem.findFirst({
						where: { eventRegistrationId: reg.registrationId },
						select: { lineItemId: true, invoiceId: true },
					});
					if (existingLine) {
						throw new TRPCError({
							code: "CONFLICT",
							message: "This session has already been billed",
						});
					}
					// Re-check credit-coverage too: a concurrent staff check-in could
					// have consumed credit AFTER we listed the row, in which case the
					// session is now covered and shouldn't be billed.
					const usage = await tx.packageCreditUsage.findFirst({
						where: { registrationId: reg.registrationId },
						select: { usageId: true },
					});
					if (usage) {
						throw new TRPCError({
							code: "CONFLICT",
							message:
								"This session was just covered by a package — no charge needed",
						});
					}

					const { invoice, totalCreditPulledCents } =
						await getOrCreateOpenInvoice(tx, {
							clubShortName: ctx.user.clubShortName,
							consumerUserId: reg.userId,
							effectivePayerUserId,
							facilityId: reg.user.activeFacilityId,
							createdByUserId: ctx.user.userId,
						});

					// Append AFTER any existing lines (and after credit lines on a
					// fresh invoice): max sortOrder + 1.
					const lastLine = await tx.invoiceLineItem.findFirst({
						where: { invoiceId: invoice.invoiceId },
						orderBy: { sortOrder: "desc" },
						select: { sortOrder: true },
					});
					const sortOrder = (lastLine?.sortOrder ?? -1) + 1;

					assertLineItemKindConsistency({
						kind: "EVENT_REGISTRATION",
						eventRegistrationId: reg.registrationId,
					});
					await tx.invoiceLineItem.create({
						data: {
							invoiceId: invoice.invoiceId,
							kind: "EVENT_REGISTRATION",
							productId: product.productId,
							description: reg.event.title,
							quantity: 1,
							unitPriceInCents,
							discountInCents: 0,
							taxRateBps: 0,
							taxAmountInCents: 0,
							totalInCents: lineTotalInCents,
							revenueCategoryId: product.revenueCategoryId,
							sortOrder,
							eventRegistrationId: reg.registrationId,
						},
					});

					// Recompute mirrors sellPackage / addAdHocCharge. With AUTO_APPLY off
					// `totalCreditPulledCents` is 0 (the helper returns 0 unless a fresh
					// tab opened and auto-apply is on); we still fold it in for parity.
					const subtotalDelta = lineTotalInCents - totalCreditPulledCents;
					const totalDelta = lineTotalInCents - totalCreditPulledCents;
					const newSubtotal = invoice.subtotalInCents + subtotalDelta;
					const newTotal = invoice.totalInCents + totalDelta;
					const amountPaid = invoice.amountPaidInCents;
					let newStatus: string;
					if (amountPaid >= newTotal) {
						newStatus = "paid";
					} else if (amountPaid <= 0) {
						newStatus = "open";
					} else {
						newStatus = "partially_paid";
					}
					const shouldAutoClose = newStatus === "paid";

					const updatedInvoice = await tx.invoice.update({
						where: { invoiceId: invoice.invoiceId },
						data: {
							subtotalInCents: newSubtotal,
							totalInCents: newTotal,
							status: newStatus,
							...(shouldAutoClose
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

					return {
						result: { invoice: updatedInvoice },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.EVENT_CHARGE_ADDED,
							consumerUserId: reg.userId,
							payerUserId:
								effectivePayerUserId === reg.userId
									? null
									: effectivePayerUserId,
							entityType: "Invoice",
							entityId: updatedInvoice.invoiceId,
							metadata: {
								registrationId: reg.registrationId,
								eventId: reg.event.eventId,
								eventTitle: reg.event.title,
								productId: product.productId,
								unitPriceInCents,
								lineTotalInCents,
								invoiceId: updatedInvoice.invoiceId,
							},
						}),
					};
				},
			);
		}),
});
