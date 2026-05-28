/**
 * Phase 9b — Invoice PDF download endpoint.
 *
 *   GET /api/invoices/{invoiceId}/pdf  →  application/pdf
 *
 * Authentication: Clerk session cookie (same as the rest of the app).
 * Authorization: canViewInvoice() — consumer OR payer (billedToUserId) OR
 * same-club staff (FACILITY_ADMIN+) OR platform admin. Mirrors the
 * billing.getInvoice tRPC procedure.
 *
 * 404 hides existence: when the viewer is forbidden we return the SAME
 * "Invoice not found" 404 a genuinely missing id would produce, so an
 * unauthorized prober can't enumerate invoice ids.
 *
 * Caching: served via the InvoicePdf table; see getOrRender.ts. The HTTP
 * response itself is `Cache-Control: private, no-store` because the
 * canonical bytes live in the DB.
 *
 * Content-Disposition: `inline` so the browser opens the PDF in a new tab
 * by default. The on-page download link uses the `download` attribute to
 * force a save; that wins on the client side regardless of this header.
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { canViewInvoice } from "~/server/services/invoiceRenderer/authz";
import { getOrRenderInvoicePdf } from "~/server/services/invoiceRenderer/getOrRender";

export const runtime = "nodejs";
// `@react-pdf/renderer` uses Node-only modules (zlib, fontkit). Edge would
// crash at import time.

function notFound(): Response {
	return new Response("Invoice not found", {
		status: 404,
		headers: { "Cache-Control": "no-store" },
	});
}

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ invoiceId: string }> },
) {
	const { userId: clerkUserId } = await auth();
	if (!clerkUserId) {
		return new Response("Unauthorized", {
			status: 401,
			headers: { "Cache-Control": "no-store" },
		});
	}

	const viewer = await db.user.findUnique({
		where: { clerkUserId },
	});
	if (!viewer) {
		// User is signed in but doesn't have a DB profile yet — treat as
		// unauthorized so they're forced through the onboarding flow.
		return new Response("Unauthorized", {
			status: 401,
			headers: { "Cache-Control": "no-store" },
		});
	}

	const { invoiceId } = await params;
	const authResult = await canViewInvoice(viewer, invoiceId);
	if (authResult.kind !== "ok") {
		// Both "not-found" and "forbidden" surface as 404 — never confirm an
		// invoice's existence to a viewer who can't see it.
		return notFound();
	}

	try {
		const { buffer, filename } = await getOrRenderInvoicePdf(
			invoiceId,
			viewer.userId,
		);

		// Quote the filename to defend against any stray spaces if the
		// sanitization in buildInvoiceFilename ever loosens.
		const dispositionFilename = `"${filename.replace(/"/g, "")}"`;

		return new Response(new Uint8Array(buffer), {
			status: 200,
			headers: {
				"Content-Type": "application/pdf",
				"Content-Length": String(buffer.byteLength),
				// `inline` lets the browser open it in a tab. The on-page link
				// uses `download` to force a save when the user clicks Download.
				"Content-Disposition": `inline; filename=${dispositionFilename}`,
				"Cache-Control": "private, no-store",
				// Tiny x-* header for debugging staleness in the network panel.
				"X-Invoice-Pdf-Renderer": "react-pdf",
			},
		});
	} catch (err) {
		// Don't leak internal error shapes to the network. Log + return 500.
		console.error(
			`[invoice-pdf] failed to render invoice ${invoiceId}:`,
			err instanceof Error ? (err.stack ?? err.message) : err,
		);
		return new Response("Failed to render invoice PDF", {
			status: 500,
			headers: { "Cache-Control": "no-store" },
		});
	}
}
