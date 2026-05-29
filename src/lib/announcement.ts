/**
 * Public ClubAnnouncement type contracts.
 *
 * The TS types the admin UI and public-feed page import. The tRPC procedures
 * in `~/server/api/routers/announcements.ts` return exactly these shapes.
 *
 * Announcements are deliberately simpler than Articles: no slug, no tags, no
 * detail page (single scrollable feed at `/<short>/announcements`), no SEO
 * meta fields. See designFiles/roadmap/phase15-articles-and-announcements.md
 * §"ClubAnnouncement".
 */

import type { AnnouncementStatus } from "@prisma/client";
import type { RouterOutputs } from "~/trpc/react";

// ─── Authoring input shape ───────────────────────────────────────────────────

export type AnnouncementInput = {
	title?: string;
	bodyHtml: string;
	status: AnnouncementStatus;
	publishedAt?: Date;
	coverImageId?: string | null;
	// Phase 15 Step 6 — REQUIRED at create, stripped on update (Q8 — scope is
	// locked after creation).
	clubShortName: string;
};

// ─── Public feed shape (returned by api.announcements.listPublished) ─────────

export type AnnouncementCard = {
	id: string;
	title: string | null;
	bodyHtml: string; // full body — feed renders inline (no per-announcement URL)
	coverImageUrl: string | null;
	coverImageAlt: string | null;
	publishedAt: Date;
	author: { name: string; avatarUrl: string | null };
};

// ─── Admin list-row shape (returned by api.announcements.adminList) ──────────

export type AdminAnnouncementRow = {
	id: string;
	title: string | null;
	status: AnnouncementStatus;
	publishedAt: Date | null;
	updatedAt: Date;
	authorName: string;
	clubShortName: string;
};

// ─── Admin detail shape (returned by api.announcements.adminGetById) ─────────
//
// Distinct from `AnnouncementCard` because the admin editor needs the editable
// fields (status, coverImageId) and a couple of UI-only fields. Exported here
// so the editor doesn't redefine it locally.
export type AdminAnnouncementDetail =
	RouterOutputs["announcements"]["adminGetById"];

// Older alias retained as documented type name in the brief.
export type AnnouncementDetail = AdminAnnouncementDetail;

/**
 * Client-side mirror of the server `canModifyAnnouncement` helper (Q10).
 * The server still enforces (defense in depth) — this exists purely to hide
 * UI affordances that wouldn't work.
 *
 *   - PLATFORM_ADMIN: any announcement in any club.
 *   - Else: caller's clubShortName must match the announcement's clubShortName.
 *   - NO per-author check (Q10 — collaborative within club).
 */
export function canModifyAnnouncementClient(
	user: { userType: string; clubShortName: string },
	announcement: { clubShortName: string },
): boolean {
	if (user.userType === "PLATFORM_ADMIN") return true;
	return user.clubShortName === announcement.clubShortName;
}
