/**
 * Phase 9b — invoice-PDF authorization.
 *
 * Mirrors the consumer-OR-payer-OR-same-club-staff rule that
 * billing.getInvoice (src/server/api/routers/billing.ts) enforces in-line.
 * Extracted here so the /api/invoices/[invoiceId]/pdf route handler and
 * any future binary endpoints share ONE auth check.
 *
 * Returns a flag (not throws) so the caller can choose 401 vs 403 vs 404
 * semantics. The HTTP layer in route.ts returns 404 for unauthorized
 * accesses to avoid leaking invoice-id existence to probers — same trick
 * billing.getInvoice plays.
 *
 * Status gate: void invoices are hidden from non-staff in the UI
 * (InvoiceDetail surfaces them only to staff), so the PDF endpoint mirrors
 * that — a consumer/payer who tries to fetch the PDF of a voided invoice
 * via direct URL gets a `forbidden` result. Staff (platform admin or
 * same-club facility-and-above) can still pull voided PDFs for audit.
 */

import { UserType } from "@prisma/client";
import type { User } from "@prisma/client";
import { isFacilityOrAbove, isPlatformAdmin } from "~/lib/utils";
import { db } from "~/server/db";
import { isSameClub } from "~/server/utils/utils";

export type InvoiceAuthResult =
	| { kind: "ok"; viewerIsClubAdmin: boolean }
	| { kind: "not-found" }
	| { kind: "forbidden" };

/**
 * Resolve whether `viewer` may read the rendered output of an invoice.
 * Loads only the columns needed for the check (clubShortName, userId,
 * billedToUserId, status) — keeps this fast even when the route is hit
 * before we'd otherwise want to read the full invoice.
 *
 * Returns:
 *   - { kind: "not-found" }  — invoice doesn't exist
 *   - { kind: "forbidden" }  — invoice exists but viewer can't see it
 *                              (also: voided invoice + non-staff viewer)
 *   - { kind: "ok", viewerIsClubAdmin } — allowed; the flag is true when
 *     the viewer is a platform admin OR a CLUB_ADMIN in the invoice's
 *     own club (i.e. mirrors the existing UI gate used to show admin-only
 *     PDF actions later, e.g. "Regenerate" once that's added).
 */
export async function canViewInvoice(
	viewer: User,
	invoiceId: string,
): Promise<InvoiceAuthResult> {
	const invoice = await db.invoice.findUnique({
		where: { invoiceId },
		select: {
			userId: true,
			billedToUserId: true,
			clubShortName: true,
			status: true,
		},
	});
	if (!invoice) return { kind: "not-found" };

	const isConsumer = invoice.userId === viewer.userId;
	const isPayer = invoice.billedToUserId === viewer.userId;
	const isStaffViewer =
		isPlatformAdmin(viewer) ||
		(isFacilityOrAbove(viewer) && isSameClub(viewer, invoice));

	if (!(isConsumer || isPayer || isStaffViewer)) {
		return { kind: "forbidden" };
	}

	// Void invoices are staff-only — the on-screen detail page hides them
	// from non-staff, so a consumer/payer hitting the PDF URL directly
	// gets the same treatment.
	if (invoice.status === "void" && !isStaffViewer) {
		return { kind: "forbidden" };
	}

	// A platform admin counts as "club admin" for every invoice they can
	// see; a regular CLUB_ADMIN counts only for invoices in their own club.
	const viewerIsClubAdmin =
		isPlatformAdmin(viewer) ||
		(viewer.userType === UserType.CLUB_ADMIN && isSameClub(viewer, invoice));

	return { kind: "ok", viewerIsClubAdmin };
}
