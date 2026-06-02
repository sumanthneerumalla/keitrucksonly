/**
 * Phase 9b — getOrRenderInvoicePdf.
 *
 * Cache layer in front of the @react-pdf/renderer pipeline.
 *
 * Algorithm (read-time):
 *   1. Look up the live invoice + the updatedAt of every related row the
 *      renderer reads (club, facility, both parties + their profiles), and
 *      reduce to a single `sourceUpdatedAt` staleness watermark.
 *   2. Find the latest InvoicePdf row for this invoice.
 *   3. Serve cached IFF
 *        latest.invoiceUpdatedAt == sourceUpdatedAt
 *        AND latest.rendererVersion == CURRENT_RENDERER_VERSION
 *      (so any edit to the invoice OR to a name/phone/address it renders, or
 *      any code-side layout bump, forces a regen on the next request).
 *   4. Otherwise: assembleRenderableInvoice → render → INSERT a new row at
 *      version = latest.version + 1, then return the new buffer.
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
export const CURRENT_RENDERER_VERSION = "v1.1.0";

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
	const invoice = await db.invoice.findUnique({
		where: { invoiceId },
		select: {
			updatedAt: true,
			clubShortName: true,
			// The rendered PDF pulls in data from related rows that DON'T bump
			// Invoice.updatedAt when they change: club name, facility contact
			// block, and each party's name/email (User) + phone
			// (StudentProfile). Fold their updatedAt into a single staleness
			// watermark so editing a member's phone or a facility's address
			// regenerates the PDF on the next read.
			club: { select: { updatedAt: true } },
			facility: { select: { updatedAt: true } },
			user: {
				select: {
					updatedAt: true,
					studentProfile: { select: { updatedAt: true } },
				},
			},
			billedToUser: {
				select: {
					updatedAt: true,
					studentProfile: { select: { updatedAt: true } },
				},
			},
		},
	});
	if (!invoice) {
		// Caller's authz check should already have caught this, but defend
		// in depth — never render a missing invoice.
		throw new Error(`Invoice ${invoiceId} not found`);
	}

	// Facility-less legacy invoices use a fallback facility (any active
	// facility in the same club — see assemble.ts). That facility's
	// updatedAt isn't reachable through `invoice.facility` (which is null
	// here), so we mirror assemble.ts's fallback query and fold its
	// updatedAt into the watermark — otherwise edits to that facility's
	// address would silently keep serving the stale cached PDF.
	let fallbackFacilityUpdatedAt: Date | null = null;
	if (invoice.facility == null) {
		const fb = await db.clubFacility.findFirst({
			where: { clubShortName: invoice.clubShortName, isActive: true },
			orderBy: [{ position: "asc" }, { createdAt: "asc" }],
			select: { updatedAt: true },
		});
		fallbackFacilityUpdatedAt = fb?.updatedAt ?? null;
	}

	// Single staleness signal = newest updatedAt across every row the renderer
	// reads. Stored in InvoicePdf.invoiceUpdatedAt (the column name predates
	// this composite use). On the first read after deploy, rows cached against
	// the old pure-invoice timestamp simply regenerate once.
	const sourceUpdatedAt = latestDate([
		invoice.updatedAt,
		invoice.club.updatedAt,
		invoice.facility?.updatedAt,
		fallbackFacilityUpdatedAt,
		invoice.user.updatedAt,
		invoice.user.studentProfile?.updatedAt,
		invoice.billedToUser?.updatedAt,
		invoice.billedToUser?.studentProfile?.updatedAt,
	]);

	const latest = await db.invoicePdf.findFirst({
		where: { invoiceId },
		orderBy: { version: "desc" },
		select: {
			version: true,
			pdfData: true,
			rendererVersion: true,
			invoiceUpdatedAt: true,
		},
	});

	// Re-assemble the DTO every time — we need it both for cache HITs (to
	// compute the filename, which depends on consumer name + invoiceNumber)
	// AND for cache MISSes (to render). The Prisma query in
	// assembleRenderableInvoice is small enough that the cost is negligible
	// vs. the @react-pdf render cost, and this keeps `filename` strictly
	// derived from CURRENT data (consumer-name edits show up in the filename
	// of subsequent downloads).
	const dto = await assembleRenderableInvoice(invoiceId);
	const filename = buildInvoiceFilename(dto);

	const isFresh =
		latest != null &&
		latest.rendererVersion === CURRENT_RENDERER_VERSION &&
		latest.invoiceUpdatedAt.getTime() === sourceUpdatedAt.getTime();

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
					invoiceUpdatedAt: sourceUpdatedAt,
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

/** Newest of a list of dates, ignoring null/undefined. The list always
 * contains at least invoice.updatedAt, so the result is never null. */
function latestDate(dates: Array<Date | null | undefined>): Date {
	let max: Date | undefined;
	for (const d of dates) {
		if (d && (max === undefined || d.getTime() > max.getTime())) max = d;
	}
	// Safe: callers always pass invoice.updatedAt as a non-null first element.
	return max as Date;
}

async function renderPdfBuffer(dto: RenderableInvoice): Promise<Buffer> {
	// `renderToBuffer` returns a Node Buffer. The cast satisfies the
	// upstream type definition which sometimes resolves to NodeJS.Buffer
	// vs Buffer depending on @types/node alignment.
	const result = await renderToBuffer(<InvoicePdfDocument dto={dto} />);
	return result as Buffer;
}
