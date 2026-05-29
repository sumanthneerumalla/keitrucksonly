/**
 * Content image serving endpoint.
 *
 *   GET /api/content-image/{id}  →  the stored image bytes
 *
 * Reads a ContentImage row (binary-in-Postgres, same pattern as the invoice PDF
 * route) and streams the bytes back with a long immutable cache. Public — content
 * images are part of the public marketing site, and the id is an opaque cuid.
 *
 * NOTE: this route only serves ContentImage rows. Author avatars are NOT routed
 * here (User.profileImage is passed through as a URL/data-URI by the router).
 */

import { db } from "~/server/db";

export const runtime = "nodejs";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;

	const image = await db.contentImage.findUnique({
		where: { id },
		select: { data: true, mimeType: true },
	});

	if (!image) {
		return new Response("Not found", { status: 404 });
	}

	// Prisma returns `Bytes` as a Uint8Array/Buffer; wrap in a fresh Uint8Array
	// so it's a valid BodyInit for this runtime.
	return new Response(new Uint8Array(image.data), {
		status: 200,
		headers: {
			"Content-Type": image.mimeType,
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}
