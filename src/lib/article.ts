/**
 * Public Article type contracts.
 *
 * The TS types that the admin UI and public-page agents import. The tRPC
 * procedures in `~/server/api/routers/articles.ts` return exactly these
 * shapes.
 */

import type { ArticleStatus } from "@prisma/client";
import type { RouterOutputs } from "~/trpc/react";

/** Public URL for a ContentImage row served by the image route handler. */
export const CONTENT_IMAGE_URL = (imageId: string) =>
	`/api/content-image/${imageId}`;

// ─── Return-shape type contracts (imported by UI agents) ─────────────────────

export type ArticleInput = {
	title: string;
	slug?: string;
	excerpt?: string;
	bodyHtml: string;
	status: ArticleStatus;
	publishedAt?: Date;
	coverImageId?: string | null;
	metaTitle?: string;
	metaDescription?: string;
	tagIds?: string[];
	// Phase 15 Stage 2 — scope discriminator. Null = platform article (FP
	// brand, /articles); string = club article (/<clubShort>/articles). Locked
	// after creation (Q8); the update procedure silently strips this field.
	clubShortName?: string | null;
};

export type ArticleCard = {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	coverImageUrl: string | null;
	publishedAt: Date;
	readingTimeMinutes: number;
	clubShortName: string | null;
	author: { name: string; avatarUrl: string | null };
	tags: { name: string; slug: string }[];
};

export type ArticleDetail = ArticleCard & {
	bodyHtml: string;
	coverImageAlt: string | null;
	metaTitle: string | null;
	metaDescription: string | null;
	author: {
		userId: string;
		name: string;
		avatarUrl: string | null;
		bio: string | null;
	};
};

/**
 * Phase 15 Step 5 polish (F14) — admin-side detail shape.
 *
 * The canonical shape returned by `api.articles.adminGetById`. Distinct from
 * `ArticleDetail` (the PUBLIC shape) because the admin form needs editable
 * fields and the `canEdit` capability bit. Exported here so any admin
 * surface (`ArticleEditor`, future admin tables, etc.) can import the
 * canonical type instead of redefining it locally.
 */
export type AdminArticleDetail = RouterOutputs["articles"]["adminGetById"];

/**
 * Client-side mirror of the server `canModifyArticle` helper. The server
 * still enforces (defense in depth) — this is purely for hiding UI
 * affordances that wouldn't work.
 *
 *   - PLATFORM_ADMIN: any article anywhere.
 *   - Caller must be in the post's scope.
 *   - CLUB_ADMIN: any article in their scope.
 *   - COACH / FACILITY: only their own authored articles.
 */
export function canModifyArticleClient(
	user: { userId: string; userType: string; clubShortName: string },
	post: { authorId: string; clubShortName: string | null },
): boolean {
	if (user.userType === "PLATFORM_ADMIN") return true;
	if (user.clubShortName !== post.clubShortName) return false;
	if (user.userType === "CLUB_ADMIN") return true;
	return user.userId === post.authorId;
}
