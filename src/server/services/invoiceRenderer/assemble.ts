/**
 * Phase 9b — assembleRenderableInvoice.
 *
 * SINGLE SOURCE OF TRUTH for the data side of invoice rendering. Both the
 * on-screen invoice page (long-term goal) and the PDF renderer (today)
 * consume the `RenderableInvoice` DTO produced here.
 *
 * What lives here:
 *   - the one Prisma query that loads everything a renderer needs in a
 *     single round-trip,
 *   - dereferencing FKs into display strings (names, status label, kind
 *     labels, payment-method labels, credit-source attribution),
 *   - signed totals + the "hasAnyTax" gate that drives whether the line-
 *     items table grows a Tax column,
 *   - resolving the From block from the invoice's facility (with a fallback
 *     to any active facility in the same club so a facility-less legacy
 *     invoice still has a contact block).
 *
 * What does NOT live here:
 *   - authorization (see ./authz.ts),
 *   - HTTP wiring or PDF rendering (see ./getOrRender.ts + ./pdf/),
 *   - caching (also ./getOrRender.ts).
 *
 * Mutations that change rendered output (sellPackage, recordPayment,
 * closeInvoice, voidInvoice, refunds) bump Invoice.updatedAt via the
 * @updatedAt directive, which is what the PDF cache reads to decide
 * staleness. So this function can be called naively for each request —
 * the caching layer wraps it.
 */

import { TRPCError } from "@trpc/server";
import { invoiceStatusDisplay } from "~/lib/invoiceStatus";
import { phoneFromProfileData } from "~/lib/studentProfile";
import { db } from "~/server/db";
import {
	KIND_LABELS,
	PAYMENT_METHOD_LABELS,
	type RenderableInvoice,
	type RenderableInvoiceFrom,
	type RenderableInvoiceLine,
	type RenderableInvoiceParty,
} from "./types";

function formatPersonName(p: {
	firstName: string | null;
	lastName: string | null;
}): string {
	const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
	return name || "(no name)";
}

/**
 * C0 control chars EXCEPT tab (0x09) and newline (0x0A): NUL through
 * BS (0x00-0x08), then VT/FF (0x0B-0x0C), then SO through US (0x0E-0x1F).
 * Used to scrub line-item descriptions before they hit the PDF renderer
 * (a control byte would otherwise render as a glyph-missing box).
 *
 * Constructed at runtime via `new RegExp(...)` with `String.fromCharCode`
 * so the source file never contains literal control bytes AND avoids the
 * `\u00XX`-in-RegExp-literal shape that biome's
 * `noControlCharactersInRegex` rule flags.
 */
const CONTROL_CHARS_RE = new RegExp(
	`[${String.fromCharCode(0x00)}-${String.fromCharCode(0x08)}${String.fromCharCode(0x0b)}${String.fromCharCode(0x0c)}${String.fromCharCode(0x0e)}-${String.fromCharCode(0x1f)}]`,
	"g",
);

/**
 * Load an invoice + everything a renderer needs, transform to the DTO.
 *
 * Caller-checked authorization: this function does NOT verify that the
 * viewer is allowed to see the invoice. Use canViewInvoice() from
 * ./authz.ts at the entry point (route handler or tRPC procedure) BEFORE
 * calling this.
 *
 * Throws TRPCError NOT_FOUND when the invoice doesn't exist.
 */
export async function assembleRenderableInvoice(
	invoiceId: string,
): Promise<RenderableInvoice> {
	const invoice = await db.invoice.findUnique({
		where: { invoiceId },
		include: {
			club: { select: { clubName: true } },
			facility: {
				select: {
					name: true,
					streetAddress: true,
					city: true,
					state: true,
					zipCode: true,
					phone: true,
					email: true,
				},
			},
			user: {
				select: {
					userId: true,
					firstName: true,
					lastName: true,
					email: true,
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
			lineItems: {
				orderBy: { sortOrder: "asc" },
				include: {
					revenueCategory: { select: { label: true } },
					creditFromUser: {
						select: { firstName: true, lastName: true },
					},
					creditFromInvoice: { select: { invoiceNumber: true } },
				},
			},
			payments: {
				// Newest first; paymentId tiebreaker stabilizes equal-millisecond
				// rows (mirrors billing.getInvoice).
				orderBy: [{ receivedAt: "desc" }, { paymentId: "asc" }],
				include: {
					refunds: {
						orderBy: [{ refundedAt: "desc" }, { refundId: "asc" }],
					},
				},
			},
		},
	});

	if (!invoice) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
	}

	// "From" block: prefer the invoice's own facility; otherwise fall back to
	// any active facility in the same club so a facility-less legacy invoice
	// still has a contact block. If the club truly has no facility, we
	// degrade to just the club name (still useful, just no address line).
	let fromFacility: typeof invoice.facility = invoice.facility;
	if (!fromFacility) {
		fromFacility = await db.clubFacility.findFirst({
			where: { clubShortName: invoice.clubShortName, isActive: true },
			orderBy: [{ position: "asc" }, { createdAt: "asc" }],
			select: {
				name: true,
				streetAddress: true,
				city: true,
				state: true,
				zipCode: true,
				phone: true,
				email: true,
			},
		});
	}

	const from: RenderableInvoiceFrom = {
		clubName: invoice.club.clubName,
		facilityName: fromFacility?.name ?? null,
		streetAddress: fromFacility?.streetAddress ?? null,
		city: fromFacility?.city ?? null,
		state: fromFacility?.state ?? null,
		zipCode: fromFacility?.zipCode ?? null,
		phone: fromFacility?.phone ?? null,
		email: fromFacility?.email ?? null,
	};

	const consumer: RenderableInvoiceParty = {
		userId: invoice.user.userId,
		fullName: formatPersonName(invoice.user),
		email: invoice.user.email,
		phone: phoneFromProfileData(invoice.user.studentProfile?.profileData),
		address: null,
	};

	const hasSeparatePayer =
		invoice.billedToUser != null &&
		invoice.billedToUser.userId !== invoice.userId;
	const billedTo: RenderableInvoiceParty | null =
		hasSeparatePayer && invoice.billedToUser
			? {
					userId: invoice.billedToUser.userId,
					fullName: formatPersonName(invoice.billedToUser),
					email: invoice.billedToUser.email,
					phone: phoneFromProfileData(
						invoice.billedToUser.studentProfile?.profileData,
					),
					address: null,
				}
			: null;

	const lines: RenderableInvoiceLine[] = invoice.lineItems.map((li) => {
		const creditSource =
			li.creditFromUser != null
				? {
						invoiceNumber: li.creditFromInvoice?.invoiceNumber ?? null,
						payerName: formatPersonName(li.creditFromUser),
					}
				: null;
		return {
			lineItemId: li.lineItemId,
			kind: li.kind,
			kindLabel: KIND_LABELS[li.kind] ?? li.kind,
			// Strip C0 control chars (NUL, BEL, ESC, etc.) that could sneak
			// in from copy-pastes or upstream API payloads. Keep \t (0x09)
			// and \n (0x0A) — react-pdf treats \n as a soft line-break and
			// \t is harmless. Without this, a control byte would render as
			// a glyph-missing box in the PDF.
			description: li.description.replace(CONTROL_CHARS_RE, ""),
			quantity: li.quantity,
			unitPriceInCents: li.unitPriceInCents,
			discountInCents: li.discountInCents,
			taxRateBps: li.taxRateBps,
			taxAmountInCents: li.taxAmountInCents,
			totalInCents: li.totalInCents,
			revenueCategoryLabel: li.revenueCategory?.label ?? null,
			creditSource,
		};
	});

	const balanceInCents = invoice.totalInCents - invoice.amountPaidInCents;
	const hasAnyTax = lines.some((l) => l.taxAmountInCents > 0);

	// Status label — staff-side wording. The PDF is a staff/business-facing
	// document (it gets emailed/handed to the member, but the language used is
	// the same staff-language used on the staff detail page — "Paid", "Due ·
	// $X", "Voided"). If we ever ship a member-mode PDF the assembler can take
	// an `audience` arg.
	const statusDisplay = invoiceStatusDisplay(
		{
			status: invoice.status,
			closedAt: invoice.closedAt,
			dueDate: invoice.dueDate,
			balanceInCents,
		},
		"staff",
	);

	const payments = invoice.payments.map((p) => {
		const refundedTotalInCents = p.refunds.reduce(
			(sum, r) => sum + r.amountInCents,
			0,
		);
		return {
			paymentId: p.paymentId,
			receivedAt: p.receivedAt,
			methodLabel: PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod,
			processor: p.processor,
			reference: p.reference,
			amountInCents: p.amountInCents,
			refundedTotalInCents,
			netInCents: p.amountInCents - refundedTotalInCents,
			refunds: p.refunds.map((r) => ({
				refundId: r.refundId,
				refundedAt: r.refundedAt,
				amountInCents: r.amountInCents,
				reason: r.reason,
			})),
		};
	});

	const dto: RenderableInvoice = {
		meta: {
			invoiceId: invoice.invoiceId,
			invoiceNumber: invoice.invoiceNumber,
			rawStatus: invoice.status,
			statusLabel: statusDisplay.label,
			statusTone: statusDisplay.tone,
			issueDate: invoice.issueDate,
			dueDate: invoice.dueDate,
			closedAt: invoice.closedAt,
			notes: invoice.notes,
		},
		from,
		consumer,
		billedTo,
		lines,
		totals: {
			subtotalInCents: invoice.subtotalInCents,
			taxTotalInCents: invoice.taxTotalInCents,
			totalInCents: invoice.totalInCents,
			amountPaidInCents: invoice.amountPaidInCents,
			balanceInCents,
			hasAnyTax,
		},
		payments,
		footer: { text: null },
	};

	// Top-level shallow freeze. Note that Object.freeze is NOT recursive:
	// nested arrays/objects (lines, totals, payments) remain mutable, so
	// `dto.lines.push(...)` or `dto.totals.balanceInCents = 0` will succeed
	// SILENTLY in dev. Renderers must treat the DTO as read-only by
	// convention; this freeze catches only outright reassignments to the
	// top-level keys (e.g. `dto.lines = []`).
	return Object.freeze(dto);
}
