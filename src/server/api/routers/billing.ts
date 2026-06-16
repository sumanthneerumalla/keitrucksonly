import { type Prisma, UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import dayjs from "~/lib/dayjs-config";
import {
	clubAdminProcedure,
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import {
	getFromAddress,
	getResendClient,
} from "~/server/services/email/resend";
import {
	assembleRenderableInvoice,
	computeViewerCapabilities,
} from "~/server/services/invoiceRenderer/assemble";
import { getOrRenderInvoicePdf } from "~/server/services/invoiceRenderer/getOrRender";
import type { InvoiceView } from "~/server/services/invoiceRenderer/types";
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
 * Phone now lives per-club on MemberClubProfile (per-club-profiles.md). Prisma
 * can't filter a nested relation by a sibling column (the invoice's club) in one
 * query, so we fetch the user's club rows and pick the matching one here.
 */
function phoneForClub(
	profiles: { clubShortName: string; phone: string | null }[] | undefined,
	clubShortName: string,
): string | null {
	return (
		profiles?.find((p) => p.clubShortName === clubShortName)?.phone ?? null
	);
}

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
	 * staff-attributed invoice notes (Phase 9c `notes: RenderableInvoiceNote[]`),
	 * line items (with `kind`, the snapshot revenue category, and the resolved
	 * "Credit from <person>" source for CREDIT lines), payments (each with its
	 * refunded + net total), and the invoice's refunds. See
	 * designFiles/roadmap/phase9-invoicing.md (#10/#14).
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

			// Light auth query: only the fields needed to authorize + derive viewer
			// capabilities; the full render shape comes from the shared assembler.
			const invoice = await ctx.db.invoice.findUnique({
				where: { invoiceId: input.invoiceId },
				select: {
					userId: true,
					billedToUserId: true,
					clubShortName: true,
					creditConsumedInCents: true,
					creditConsumedAt: true,
				},
			});

			// Missing invoice and unauthorized BOTH return NOT_FOUND (no id probing).
			if (!invoice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found",
				});
			}

			const viewerCaps = computeViewerCapabilities(viewer, invoice);
			const isConsumer = invoice.userId === viewer.userId;
			const isPayer = invoice.billedToUserId === viewer.userId;
			if (!(isConsumer || isPayer || viewerCaps.isStaff)) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found",
				});
			}

			// Audience is ALWAYS derived server-side from the authenticated viewer,
			// NEVER a client input (phase9c security linchpin): a member must not be
			// able to request the staff DTO. Staff -> "staff"; else "customer".
			const audience = viewerCaps.isStaff ? "staff" : "customer";
			return {
				invoice: await assembleRenderableInvoice(input.invoiceId, { audience }),
				viewer: viewerCaps,
			} satisfies InvoiceView;
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
									// Staff-attributed invoice notes (phase9c — replaces the
									// dropped `notes` blob). Match any non-deleted note's body.
									{
										invoiceNotes: {
											some: {
												body: {
													contains: search,
													mode: "insensitive" as const,
												},
												deletedAt: null,
											},
										},
									},
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
						select: { status: true, amountPaidInCents: true },
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

					const updated = await tx.invoice.update({
						where: { invoiceId: input.invoiceId },
						data: { status: "void" },
						select: {
							invoiceId: true,
							invoiceNumber: true,
							status: true,
						},
					});

					// Phase 9c — the void reason is now a staff-attributed InvoiceNote
					// (replaces the appended `Invoice.notes` blob). Stamp the time in the
					// acting staff's timezone; createdBy attributes it to the voider. The
					// invoice is pinned to ctx.user's club by the cross-tenant guard above.
					const stamp = dayjs()
						.tz(ctx.user.timeZone || "America/New_York")
						.format("YYYY-MM-DD HH:mm");
					await tx.invoiceNote.create({
						data: {
							clubShortName: ctx.user.clubShortName,
							invoiceId: updated.invoiceId,
							body: `[Voided ${stamp}] ${reason}`,
							createdBy: ctx.user.userId,
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
	 * Phase 9c §6 — staff-attributed invoice notes (add / edit / soft-remove).
	 * Replaces the legacy single `Invoice.notes` blob with audited rows that
	 * render on every invoice surface (web staff CRUD, member read-only, PDF).
	 *
	 * Authorization: `facilityProcedure` (facility-and-above staff, scoped to the
	 * caller's club). Each mutation cross-tenant-guards the invoice/note against
	 * `ctx.user.clubShortName`, returning NOT_FOUND otherwise. Every write is
	 * audited via `writeAuditedMutation` + `buildPartyAuditEntries`: the note is on
	 * ONE invoice both the consumer and the bill-to payer can see, so the action
	 * lands on BOTH parties' Activity timelines (self-pay → a single row).
	 *
	 * SCOPE (phase9c locked): invoice-LEVEL notes only — `lineItemId` is accepted
	 * + validated against the invoice, but there is no per-line UI this phase, and
	 * `showOnInvoice` is forced true (no internal/printed toggle yet).
	 */
	addInvoiceNote: facilityProcedure
		.input(
			z.object({
				invoiceId: z.string().min(1),
				body: z.string().trim().min(1, "A note is required").max(2000),
				lineItemId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const body = input.body.trim();

			// Cross-tenant guard: the invoice must live in the caller's club.
			const invoice = await ctx.db.invoice.findFirst({
				where: {
					invoiceId: input.invoiceId,
					clubShortName: ctx.user.clubShortName,
				},
				select: { invoiceId: true, userId: true, billedToUserId: true },
			});
			if (!invoice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found in this club",
				});
			}

			// If a line link is supplied, it must belong to THIS invoice.
			if (input.lineItemId) {
				const line = await ctx.db.invoiceLineItem.findFirst({
					where: { lineItemId: input.lineItemId, invoiceId: invoice.invoiceId },
					select: { lineItemId: true },
				});
				if (!line) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Line item not found on this invoice",
					});
				}
			}

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					const note = await tx.invoiceNote.create({
						data: {
							clubShortName: ctx.user.clubShortName,
							invoiceId: invoice.invoiceId,
							lineItemId: input.lineItemId ?? null,
							body,
							createdBy: ctx.user.userId,
							// showOnInvoice defaults true; no toggle this phase.
						},
						select: { invoiceNoteId: true },
					});
					return {
						result: { invoiceNoteId: note.invoiceNoteId },
						// A note is on ONE invoice that both the consumer and the bill-to
						// payer can see, so it lands on BOTH parties' activity timelines
						// (party-pair audit, mirroring void/charge). Self-pay → one row.
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.INVOICE_NOTE_ADDED,
							consumerUserId: invoice.userId,
							payerUserId: invoice.billedToUserId,
							entityType: "InvoiceNote",
							entityId: note.invoiceNoteId,
							metadata: {
								invoiceId: invoice.invoiceId,
								lineItemId: input.lineItemId ?? null,
							},
						}),
					};
				},
			);
		}),

	editInvoiceNote: facilityProcedure
		.input(
			z.object({
				invoiceNoteId: z.string().min(1),
				body: z.string().trim().min(1, "A note is required").max(2000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const body = input.body.trim();

			// Cross-tenant guard + not-deleted check. `clubShortName` is denormalized
			// on the note, so no join is needed to scope to the caller's club.
			const note = await ctx.db.invoiceNote.findFirst({
				where: {
					invoiceNoteId: input.invoiceNoteId,
					clubShortName: ctx.user.clubShortName,
					deletedAt: null,
				},
				select: {
					invoiceNoteId: true,
					invoiceId: true,
					invoice: { select: { userId: true, billedToUserId: true } },
				},
			});
			if (!note) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Note not found in this club",
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
					await tx.invoiceNote.update({
						where: { invoiceNoteId: note.invoiceNoteId },
						data: { body, updatedBy: ctx.user.userId },
					});
					return {
						result: { invoiceNoteId: note.invoiceNoteId },
						// Both invoice parties see the note → both timelines (§ party-pair).
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.INVOICE_NOTE_EDITED,
							consumerUserId: note.invoice.userId,
							payerUserId: note.invoice.billedToUserId,
							entityType: "InvoiceNote",
							entityId: note.invoiceNoteId,
							metadata: { invoiceId: note.invoiceId },
						}),
					};
				},
			);
		}),

	removeInvoiceNote: facilityProcedure
		.input(z.object({ invoiceNoteId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			// Cross-tenant guard + idempotency (already-removed → NOT_FOUND).
			const note = await ctx.db.invoiceNote.findFirst({
				where: {
					invoiceNoteId: input.invoiceNoteId,
					clubShortName: ctx.user.clubShortName,
					deletedAt: null,
				},
				select: {
					invoiceNoteId: true,
					invoiceId: true,
					invoice: { select: { userId: true, billedToUserId: true } },
				},
			});
			if (!note) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Note not found in this club",
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
					// Soft delete — preserves history (deletedAt filters it out of the
					// assembler + the note search).
					await tx.invoiceNote.update({
						where: { invoiceNoteId: note.invoiceNoteId },
						data: { deletedAt: new Date(), deletedBy: ctx.user.userId },
					});
					return {
						result: { invoiceNoteId: note.invoiceNoteId },
						// Both invoice parties see the note → both timelines (§ party-pair).
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.INVOICE_NOTE_REMOVED,
							consumerUserId: note.invoice.userId,
							payerUserId: note.invoice.billedToUserId,
							entityType: "InvoiceNote",
							entityId: note.invoiceNoteId,
							metadata: { invoiceId: note.invoiceId },
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
	 * Phase 12a Round 3 cleanup — issue an account-credit "refund" by
	 * appending a negative CREDIT adjustment line item to the invoice that
	 * carried the original payment. The buyer's money stays on the books as
	 * a balance they can spend on a future invoice; nothing is handed back
	 * physically. Paired with the RefundModal "Account credit" method,
	 * which previously had to misuse `recordRefund` with a prefixed reason.
	 *
	 * Unlike `recordRefund` which BLOCKS when the invoice has consumed
	 * credit (D1, HANDOFF #123), `issueAccountCreditFromPayment` ALLOWS
	 * this — adding account credit doesn't reverse already-consumed credit,
	 * it ADDS new credit. The D1 invariant is "you can't physically refund
	 * money that's been spent as credit elsewhere"; a paper credit
	 * adjustment on the same invoice doesn't move money, so the invariant
	 * doesn't apply.
	 *
	 * The cap is the payment's not-yet-refunded balance (cumulative
	 * InvoiceRefund rows). Account-credit adjustments don't reduce
	 * amountPaidInCents (they're an InvoiceLineItem, not an InvoiceRefund),
	 * so the existing-refund floor is the right cap.
	 *
	 * Mirrors recordRefund / applyAccountCredit: per-payer advisory lock +
	 * FOR UPDATE on the invoice row, re-fetch inside the lock, append the
	 * CREDIT line, recompute subtotal/total/status.
	 */
	issueAccountCreditFromPayment: clubAdminProcedure
		.input(
			z.object({
				paymentId: z.string(),
				amountInCents: z.number().int().positive(),
				reason: z.string().trim().min(1, "A reason is required").max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const reason = input.reason.trim();

			// Cross-tenant guard + pre-lock fast-fail.
			const payment = await ctx.db.invoicePayment.findFirst({
				where: {
					paymentId: input.paymentId,
					invoice: { clubShortName: ctx.user.clubShortName },
				},
				select: {
					amountInCents: true,
					invoiceId: true,
					invoice: {
						select: {
							status: true,
							userId: true,
							billedToUserId: true,
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
					message: "Cannot issue credit against a payment on a void invoice",
				});
			}

			const effectivePayerUserId =
				payment.invoice.billedToUserId ?? payment.invoice.userId;

			return await writeAuditedMutation(
				{
					db: ctx.db,
					actorUserId: ctx.user.userId,
					clubShortName: ctx.user.clubShortName,
					source: AUDIT_SOURCES.ADMIN_DASHBOARD,
				},
				async (tx) => {
					// Same per-payer advisory lock as recordRefund / applyAccountCredit.
					const lockKey = `invoice-payer-${effectivePayerUserId}-${ctx.user.clubShortName}`;
					await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint)`;
					await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "invoiceId" = ${payment.invoiceId} FOR UPDATE`;

					// Re-read inside the lock.
					const locked = await tx.invoice.findUniqueOrThrow({
						where: { invoiceId: payment.invoiceId },
						select: {
							subtotalInCents: true,
							totalInCents: true,
							amountPaidInCents: true,
							status: true,
						},
					});
					if (locked.status === "void") {
						throw new TRPCError({
							code: "CONFLICT",
							message:
								"Cannot issue credit against a payment on a void invoice",
						});
					}

					// Cap at the payment's not-yet-refunded balance MINUS
					// credit already issued against this payment (Round 3.6
					// IMPORTANT #1). Without the credit term, a $50 cash refund
					// + a $50 credit + another $50 credit on a $100 payment
					// would all succeed (each <= $100 - $50 prior cash).
					const [priorRefunds, priorCreditIssued] = await Promise.all([
						tx.invoiceRefund.aggregate({
							_sum: { amountInCents: true },
							where: { paymentId: input.paymentId },
						}),
						tx.invoiceLineItem.aggregate({
							_sum: { totalInCents: true },
							where: {
								creditFromPaymentId: input.paymentId,
								kind: "CREDIT",
							},
						}),
					]);
					const alreadyRefunded = priorRefunds._sum.amountInCents ?? 0;
					// CREDIT line totals are negative; abs to get the dollar
					// amount of credit already issued against this payment.
					const alreadyCredited = Math.abs(
						priorCreditIssued._sum.totalInCents ?? 0,
					);
					const refundableRemaining =
						payment.amountInCents - alreadyRefunded - alreadyCredited;
					if (input.amountInCents > refundableRemaining) {
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: `Credit exceeds the payment's refundable balance ($${(refundableRemaining / 100).toFixed(2)}).`,
						});
					}

					// Append the credit line after any existing line items.
					const lastLine = await tx.invoiceLineItem.findFirst({
						where: { invoiceId: payment.invoiceId },
						orderBy: { sortOrder: "desc" },
						select: { sortOrder: true },
					});
					const sortOrder = (lastLine?.sortOrder ?? -1) + 1;

					assertLineItemKindConsistency({
						kind: "CREDIT",
						creditFromInvoiceId: null,
					});
					const lineItem = await tx.invoiceLineItem.create({
						data: {
							invoiceId: payment.invoiceId,
							kind: "CREDIT",
							description: `Refund credit applied — ${reason}`,
							quantity: 1,
							unitPriceInCents: -input.amountInCents,
							discountInCents: 0,
							taxRateBps: 0,
							taxAmountInCents: 0,
							totalInCents: -input.amountInCents,
							sortOrder,
							// creditFromInvoiceId NULL — this credit doesn't originate
							// from a prior overpaid invoice; it's an adjustment issued
							// in lieu of a money refund.
							creditFromInvoiceId: null,
							// The credit benefits the payer (whoever holds the tab).
							creditFromUserId: effectivePayerUserId,
							// Round 3.6 IMPORTANT #1 — link the CREDIT line back to
							// the funding payment so the refundable-cap math in
							// `recordRefundInternal` / `refundStripePayment` can
							// subtract credit-issued from the payment's refundable
							// balance. Without this column a $50 credit + a full
							// Stripe refund of the same $100 payment would return
							// $150 to the buyer against $100 paid.
							creditFromPaymentId: input.paymentId,
						},
					});

					// Recompute subtotal/total — CREDIT lines carry 0 tax, so subtotal
					// and total move by the same amount (mirrors applyAccountCredit).
					const newSubtotal = locked.subtotalInCents - input.amountInCents;
					const newTotal = locked.totalInCents - input.amountInCents;

					// Status: an adjustment can leave the invoice overpaid (→ "paid",
					// overpayment counts as paid) or partially paid. closedAt stays
					// UNTOUCHED — an adjustment doesn't move close-tab state (matches
					// recordRefund D2).
					const amountPaid = locked.amountPaidInCents;
					let newStatus: string;
					if (amountPaid >= newTotal) {
						newStatus = "paid";
					} else if (amountPaid > 0) {
						newStatus = "partially_paid";
					} else {
						newStatus = "open";
					}

					const updated = await tx.invoice.update({
						where: { invoiceId: payment.invoiceId },
						data: {
							subtotalInCents: newSubtotal,
							totalInCents: newTotal,
							status: newStatus,
						},
						select: {
							invoiceId: true,
							totalInCents: true,
							amountPaidInCents: true,
							status: true,
						},
					});

					return {
						result: { lineItem, invoice: updated },
						audit: buildPartyAuditEntries({
							action: AUDIT_ACTIONS.REFUND_ISSUED_AS_CREDIT,
							consumerUserId: payment.invoice.userId,
							payerUserId: payment.invoice.billedToUserId,
							entityType: "InvoiceLineItem",
							entityId: lineItem.lineItemId,
							metadata: {
								amountInCents: input.amountInCents,
								paymentId: input.paymentId,
								lineItemId: lineItem.lineItemId,
								reason,
							},
						}),
					};
				},
			);
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
				// Phase 9c §6.5 — optional "why" note. Captured as a line-linked
				// InvoiceNote so the reason for a custom charge travels with the
				// invoice and is staff-attributed.
				note: z.string().trim().max(2000).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const note = input.note?.trim();
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
					const createdLine = await tx.invoiceLineItem.create({
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
						select: { lineItemId: true },
					});

					// Phase 9c §6.5 — attach the optional "why" note, linked to the line
					// just created so it carries the charge's context + a staff author.
					if (note) {
						await tx.invoiceNote.create({
							data: {
								clubShortName: ctx.user.clubShortName,
								invoiceId: invoice.invoiceId,
								lineItemId: createdLine.lineItemId,
								body: note,
								createdBy: ctx.user.userId,
							},
						});
					}

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

	/**
	 * Phase 9a (D17 Activity tab) — paginated audit log for a member's Activity
	 * tab inside the BillingPanel. Returns AuditLog rows where this member is
	 * the target (consumer OR payer side), newest first. Cursor: (createdAt, logId)
	 * — strict-less-than-or-equal on createdAt with logId tiebreaker, matching
	 * the listInvoices pattern.
	 *
	 * Auth: facilityProcedure (Club admins + facility staff per Q1). Member
	 * self-view is gated UI-side via the audience prop today; flip to
	 * `protectedProcedure + self-or-staff` (see getMemberBilling) when members
	 * are allowed to read their own activity.
	 *
	 * Bill-to actions write 2 audit rows (consumer + payer); each has a
	 * different `targetUserId`, so filtering by this member's userId returns
	 * EXACTLY ONE row per logical action that involved them — no client-side
	 * collapsing needed.
	 */
	listMemberActivity: protectedProcedure
		.input(
			z.object({
				userId: z.string().min(1),
				limit: z.number().int().min(1).max(100).default(50),
				cursor: z
					.object({ logId: z.string(), createdAt: z.string() })
					.optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			// Self-or-staff widening — viewer is EITHER the target member (self)
			// OR same-club staff. Mirrors getMemberBilling (~line 71) so the
			// member-facing Activity tab can read its own audit timeline.
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

			const rows = await ctx.db.auditLog.findMany({
				where: {
					clubShortName,
					targetUserId: input.userId,
					...(input.cursor && {
						OR: [
							{ createdAt: { lt: new Date(input.cursor.createdAt) } },
							{
								createdAt: new Date(input.cursor.createdAt),
								logId: { lt: input.cursor.logId },
							},
						],
					}),
				},
				orderBy: [{ createdAt: "desc" }, { logId: "desc" }],
				take: input.limit + 1,
				select: {
					logId: true,
					action: true,
					source: true,
					targetRole: true,
					correlationId: true,
					entityType: true,
					entityId: true,
					metadata: true,
					createdAt: true,
					actorUser: {
						select: {
							userId: true,
							firstName: true,
							lastName: true,
						},
					},
				},
			});

			const hasMore = rows.length > input.limit;
			const items = hasMore ? rows.slice(0, input.limit) : rows;
			const lastItem = items.at(-1);
			const nextCursor =
				hasMore && lastItem
					? {
							logId: lastItem.logId,
							createdAt: lastItem.createdAt.toISOString(),
						}
					: null;

			return { items, nextCursor };
		}),

	/**
	 * Send an invoice PDF to the client (consumer or billed-to party) by email.
	 * Restricted to club admins and platform admins only.
	 *
	 * The PDF is generated via the existing `getOrRenderInvoicePdf` cache layer
	 * and attached to the email. The recipient is the billed-to user's email
	 * when a separate payer exists, otherwise the consumer's email.
	 */
	sendInvoiceEmail: clubAdminProcedure
		.input(z.object({ invoiceId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const sender = ctx.user;

			const invoice = await ctx.db.invoice.findFirst({
				where: { invoiceId: input.invoiceId },
				select: {
					invoiceId: true,
					invoiceNumber: true,
					clubShortName: true,
					status: true,
					club: { select: { clubName: true } },
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
				},
			});

			if (!invoice) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Invoice not found",
				});
			}

			// Club admins are scoped to their own club; platform admins may send
			// across clubs.
			if (!isPlatformAdmin(sender) && !isSameClub(sender, invoice)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only send invoices for your own club",
				});
			}

			if (invoice.status === "void") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Cannot send a voided invoice",
				});
			}

			// Prefer the billed-to party's email (they're the one who owes money);
			// fall back to the consumer when there's no separate payer.
			const hasSeparatePayer =
				invoice.billedToUser !== null &&
				invoice.billedToUser.userId !== invoice.user.userId;
			const recipient = hasSeparatePayer ? invoice.billedToUser : invoice.user;

			if (!recipient?.email) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "The recipient does not have an email address on file",
				});
			}

			const { buffer, filename } = await getOrRenderInvoicePdf(
				invoice.invoiceId,
				sender.userId,
			);

			const resend = await getResendClient();
			const from = await getFromAddress(sender);
			const recipientName =
				`${recipient.firstName ?? ""} ${recipient.lastName ?? ""}`.trim() ||
				"there";
			const clubName = invoice.club.clubName;

			const subject = `Invoice ${invoice.invoiceNumber} from ${clubName}`;
			const bodyHtml = `<p>Hi ${recipientName},</p><p>Please find your invoice <strong>${invoice.invoiceNumber}</strong> attached.</p><p>Thank you,<br/>${clubName}</p>`;
			const bodyText = `Hi ${recipientName},\n\nPlease find your invoice ${invoice.invoiceNumber} attached.\n\nThank you,\n${clubName}`;

			const { error } = await resend.emails.send({
				from,
				to: [recipient.email],
				subject,
				html: bodyHtml,
				text: bodyText,
				attachments: [
					{
						filename,
						content: buffer,
					},
				],
			});

			if (error) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Failed to send email: ${error.message}`,
				});
			}

			return { sentTo: recipient.email };
		}),
});
