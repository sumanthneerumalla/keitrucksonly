import { z } from "zod";
import { CONTENT_IMAGE_URL } from "~/lib/article";
import { createTRPCRouter, staffProcedure } from "~/server/api/trpc";
import { processBase64Image } from "~/server/utils/utils";

/**
 * Phase 15 Step 6 — Shared content-image upload router.
 *
 * Extracted from `articles.uploadImage` so multiple Phase 15 surfaces (article
 * cover/inline images AND announcement cover/inline images) can call the same
 * mutation without duplicating logic. Images are pool-shared across scopes —
 * any staff member can upload; ContentImage rows aren't club-scoped, just
 * referenced by their owning row.
 *
 * Public URL pattern is unchanged: `/api/content-image/[id]`.
 */
export const contentImageRouter = createTRPCRouter({
	// Decode a base64 image and store it as a ContentImage. Returns its public
	// URL. Gate: `staffProcedure` (any staff can upload — no scope check).
	upload: staffProcedure
		.input(
			z.object({
				base64: z.string(),
				mimeType: z.string(),
				alt: z.string().max(300).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// processBase64Image strips any `data:<mime>;base64,` prefix and
			// enforces the 3MB default cap.
			const buf = processBase64Image(input.base64);
			// Copy into a fresh ArrayBuffer-backed Uint8Array; Prisma's `Bytes`
			// typing requires `Uint8Array<ArrayBuffer>`, but Node's
			// `Buffer.from` returns `Buffer<ArrayBufferLike>` (which could be a
			// SharedArrayBuffer), so we can't pass the Buffer directly.
			const ab = new ArrayBuffer(buf.byteLength);
			const data = new Uint8Array(ab);
			data.set(buf);

			const image = await ctx.db.contentImage.create({
				data: {
					data,
					mimeType: input.mimeType,
					alt: input.alt,
				},
				select: { id: true },
			});

			return { id: image.id, url: CONTENT_IMAGE_URL(image.id) };
		}),
});
