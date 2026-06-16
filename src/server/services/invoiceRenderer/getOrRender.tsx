/**
 * Phase 9b — getOrRenderInvoicePdf.
 *
 * Cache layer in front of the @react-pdf/renderer pipeline.
 *
 * Algorithm (read-time, content-addressed):
 *   1. assembleRenderableInvoice → the customer-audience DTO (we already need
 *      it every read for the filename + any render).
 *   2. contentHash = sha256(the DTO) — a fingerprint of EXACTLY what the
 *      renderer draws.
 *   3. Find the latest InvoicePdf row for this invoice.
 *   4. Serve cached IFF
 *        latest.contentHash == contentHash
 *        AND latest.rendererVersion == CURRENT_RENDERER_VERSION
 *      (any change to anything rendered changes the hash → regen; any code-side
 *      layout bump changes the version → regen).
 *   5. Otherwise: render → INSERT a new row at version = latest.version + 1,
 *      then return the new buffer.
 *
 * Why a hash and not a per-field updatedAt watermark: the watermark had to list
 * the updatedAt of every row the renderer reads, kept in sync by hand — and it
 * drifted twice (invoice notes; the per-club phone move). Hashing the assembled
 * DTO makes the cache key the rendered content itself, so it can't drift.
 *
 * The InvoicePdf table keeps every historical render (audit trail), but
 * only the LATEST is ever served. Older rows are pruned out of band when
 * the table grows; the @@unique([invoiceId, version]) constraint plus a
 * version bump on every regen makes pruning trivial later.
 *
 * Concurrency: two parallel requests for the same stale invoice both read
 * latest.version = N and both try to INSERT version N+1. The
 * @@unique([invoiceId, version]) constraint lets exactly one win; the loser
 * catches the P2002 and serves the winner's freshly-written bytes instead of
 * erroring. No locking needed.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { renderToBuffer } from "@react-pdf/renderer";
// Explicit React import: this file ships JSX (`<InvoicePdfDocument …/>`)
// that compiles to React.createElement calls at runtime. Next.js's
// automatic JSX runtime injects this for client/server components but
// NOT for ad-hoc tools (tsx CLI, background jobs) that import this
// module directly — so import it explicitly to make the renderer
// portable to both call sites.
import React from "react";
import { db } from "~/server/db";
import { assembleRenderableInvoice } from "./assemble";
import { buildInvoiceFilename } from "./filename";
import { InvoicePdfDocument } from "./pdf/InvoicePdfDocument";
import type { RenderableInvoice } from "./types";

/**
 * Bump this when you change the PDF layout in a way that should
 * retroactively re-render all cached invoices on next read. The string is
 * free-form; any change to its value invalidates every cached row.
 */
// v1.4.0 — Phase 9c §6: Notes block now renders staff-attributed InvoiceNote
// rows (was the single `meta.notes` blob); invalidates cached PDFs.
// v1.4.1 — invoice-number title fontSize 20 → 18 (size-20 render artifact: a
// stray strike through the number in @react-pdf output). Layout change → regen.
export const CURRENT_RENDERER_VERSION = "v1.4.1";

export type InvoicePdfResult = {
	/** PDF bytes. Backed by a Node Buffer; safe to pass to NextResponse. */
	buffer: Buffer;
	/** "<ConsumerLast>_<ConsumerFirst>_<InvoiceNumber>.pdf" */
	filename: string;
	/** Whether this response came from the cache (vs. a fresh render). */
	fromCache: boolean;
	/** Version number recorded in InvoicePdf for the served bytes. */
	version: number;
};

/**
 * Render (or fetch the cached render of) an invoice PDF.
 *
 * Caller MUST have authorized the viewer for this invoice already (see
 * ./authz.ts). This function never checks permissions; it trusts the
 * caller. `generatedByUserId` is recorded on a fresh row for audit and
 * may be null for system-triggered renders (e.g. a future cron).
 */
export async function getOrRenderInvoicePdf(
	invoiceId: string,
	generatedByUserId: string | null,
): Promise<InvoicePdfResult> {
	// Assemble the DTO first — it's needed every read anyway (filename on a
	// cache HIT, render on a MISS) and it's the single source of truth for the
	// cache key. assembleRenderableInvoice throws NOT_FOUND if the invoice is
	// gone, so no separate existence check is needed.
	// The PDF is a customer-facing document (members can download it), so
	// assemble it with the customer audience — staff-only fields
	// (revenueCategoryLabel, payment/refund/close attribution) are omitted at
	// the source (phase9c §4.3).
	const dto = await assembleRenderableInvoice(invoiceId, {
		audience: "customer",
	});
	const filename = buildInvoiceFilename(dto);

	// Content-addressed cache key: a sha256 of the assembled DTO fingerprints
	// EXACTLY what the renderer draws, so any change to anything rendered
	// invalidates the cache without a hand-maintained per-field watermark.
	// JSON.stringify is deterministic here — the assembler builds the object the
	// same way every time (stable key order, Dates → ISO), and array order is
	// fixed by the query `orderBy`s.
	const contentHash = createHash("sha256")
		.update(JSON.stringify(dto))
		.digest("hex");

	const latest = await db.invoicePdf.findFirst({
		where: { invoiceId },
		orderBy: { version: "desc" },
		select: {
			version: true,
			pdfData: true,
			rendererVersion: true,
			contentHash: true,
		},
	});

	const isFresh =
		latest != null &&
		latest.rendererVersion === CURRENT_RENDERER_VERSION &&
		latest.contentHash === contentHash;

	if (isFresh && latest) {
		return {
			buffer: Buffer.from(latest.pdfData),
			filename,
			fromCache: true,
			version: latest.version,
		};
	}

	const buffer = await renderPdfBuffer(dto);
	// Prisma's Bytes column type wants Uint8Array<ArrayBuffer>; Node Buffer
	// is `Buffer<ArrayBufferLike>`. They're structurally identical at the
	// byte level — copy the contents into a fresh Uint8Array to align the
	// underlying buffer type so the Prisma client accepts it.
	const pdfBytes = new Uint8Array(buffer);

	// Concurrency: a parallel request for the same stale invoice can compute
	// the same nextVersion and insert it first, tripping the
	// @@unique([invoiceId, version]) constraint here. Both renders are
	// valid, so rather than 500-ing the loser, serve whatever the latest
	// row is now (the winner's bytes).
	//
	// The race window is doubly bounded: a concurrent pruner could also
	// delete the winner row between the P2002 and our re-read, so retry
	// the create with nextVersion+1 a few times before giving up.
	const MAX_RETRIES = 3;
	let attemptVersion = (latest?.version ?? 0) + 1;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			await db.invoicePdf.create({
				data: {
					invoiceId,
					version: attemptVersion,
					pdfData: pdfBytes,
					byteSize: buffer.length,
					rendererVersion: CURRENT_RENDERER_VERSION,
					contentHash,
					generatedBy: generatedByUserId,
				},
			});
			return {
				buffer,
				filename,
				fromCache: false,
				version: attemptVersion,
			};
		} catch (err) {
			// Only handle the SPECIFIC unique-constraint violation on
			// (invoiceId, version). Any other P2002 (e.g. a future second
			// unique index added to InvoicePdf) is a real bug and must
			// rethrow unchanged.
			if (
				!(err instanceof Prisma.PrismaClientKnownRequestError) ||
				err.code !== "P2002" ||
				!isInvoiceVersionUniqueViolation(err)
			) {
				throw err;
			}

			const winner = await db.invoicePdf.findFirst({
				where: { invoiceId },
				orderBy: { version: "desc" },
				select: { version: true, pdfData: true },
			});
			if (winner) {
				return {
					buffer: Buffer.from(winner.pdfData),
					filename,
					fromCache: true,
					version: winner.version,
				};
			}
			// Winner re-read returned null (concurrent prune in between).
			// Retry the create with the next version up.
			attemptVersion += 1;
		}
	}

	throw new Error(
		`getOrRenderInvoicePdf: exhausted ${MAX_RETRIES} retries for invoice ${invoiceId} due to concurrent version collisions`,
	);
}

/**
 * Returns true if the P2002 error is the (invoiceId, version) composite
 * unique-constraint violation we expect from concurrent renders. Prisma
 * normalizes `err.meta.target` differently across drivers — it can be
 * either an array of column names or the constraint's index name string —
 * so check both shapes.
 */
function isInvoiceVersionUniqueViolation(
	err: Prisma.PrismaClientKnownRequestError,
): boolean {
	const target = err.meta?.target;
	if (Array.isArray(target)) {
		const cols = target as string[];
		return cols.includes("invoiceId") && cols.includes("version");
	}
	if (typeof target === "string") {
		return target === "InvoicePdf_invoiceId_version_key";
	}
	return false;
}

async function renderPdfBuffer(dto: RenderableInvoice): Promise<Buffer> {
	// `renderToBuffer` returns a Node Buffer. The cast satisfies the
	// upstream type definition which sometimes resolves to NodeJS.Buffer
	// vs Buffer depending on @types/node alignment.
	const result = await renderToBuffer(<InvoicePdfDocument dto={dto} />);
	return result as Buffer;
}
