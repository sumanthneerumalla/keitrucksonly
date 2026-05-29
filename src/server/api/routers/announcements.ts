import { AnnouncementStatus, type Prisma, UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
	AdminAnnouncementRow,
	AnnouncementCard,
} from "~/lib/announcement";
import { CONTENT_IMAGE_URL } from "~/lib/article";
import {
	createTRPCRouter,
	publicProcedure,
	staffProcedure,
} from "~/server/api/trpc";

/**
 * Phase 15 Step 6 — ClubAnnouncement router.
 *
 * Authorization model (mirrors articles.ts authz posture):
 *
 *   - READS (`adminGetById`): return NOT_FOUND when the caller can't access,
 *     to avoid leaking existence via the read channel.
 *   - WRITES (`update`, `setStatus`, `delete`): return FORBIDDEN — mutations
 *     require knowing the id, so attack surface is low; FORBIDDEN is the
 *     clearer signal to legitimate callers.
 *
 * Key differences vs articles (locked decisions):
 *
 *   - Q10 (collaborative edit): any staff in the announcement's club can
 *     edit/delete ANY announcement in that club, regardless of authorship.
 *     PLATFORM_ADMIN any club. NO per-author trust (no canModifyArticle-style
 *     authorId match).
 *   - Q11 (draft privacy in admin list): COACH/FACILITY see their own drafts
 *     plus all published. CLUB_ADMIN/PLATFORM_ADMIN see all drafts in scope.
 *     Note tension with Q10: a COACH cannot SEE other staff's drafts via the
 *     list, but COULD edit them via the direct edit URL. Intentional — Q11
 *     governs discovery, Q10 governs the action.
 *   - Q8 (scope locked): clubShortName REQUIRED at create, STRIPPED from
 *     update input.
 *   - No tags, no slug, no detail page.
 */

// ─── Authorization helpers ───────────────────────────────────────────────────

/**
 * Q10 — Collaborative edit/delete within club.
 *
 * No per-author check. Caller must be PLATFORM_ADMIN OR a staff member whose
 * clubShortName matches the announcement's clubShortName.
 *
 * Mirrored client-side at `~/lib/announcement.ts` via
 * `canModifyAnnouncementClient` for hiding UI affordances.
 */
function canModifyAnnouncement(
	user: { userType: UserType; clubShortName: string },
	announcement: { clubShortName: string },
): boolean {
	if (user.userType === UserType.PLATFORM_ADMIN) return true;
	return user.clubShortName === announcement.clubShortName;
}

// ─── Author display helpers ──────────────────────────────────────────────────

// Q12 — Real name byline for all authors (PLATFORM_ADMIN included), falling
// back to the FP brand if both names are blank.
function authorName(author: {
	firstName: string | null;
	lastName: string | null;
}): string {
	return (
		[author.firstName, author.lastName].filter(Boolean).join(" ") ||
		"Facility Presence"
	);
}

function authorAvatarUrl(author: { profileImage: string | null }):
	| string
	| null {
	return author.profileImage ?? null;
}

function coverImageUrl(coverImageId: string | null): string | null {
	return coverImageId ? CONTENT_IMAGE_URL(coverImageId) : null;
}

// ─── Zod schemas (limits mirror @db constraints in schema.prisma) ────────────

const announcementCreateSchema = z.object({
	clubShortName: z.string(),
	title: z.string().max(200).nullable().optional(),
	bodyHtml: z.string(),
	status: z.nativeEnum(AnnouncementStatus),
	publishedAt: z.date().optional(),
	coverImageId: z.string().nullable().optional(),
});

const announcementUpdateSchema = z.object({
	id: z.string(),
	title: z.string().max(200).nullable().optional(),
	bodyHtml: z.string().optional(),
	status: z.nativeEnum(AnnouncementStatus).optional(),
	// F25: parity with articles router. null is unreachable from the UI today
	// (Q-style clearing of publishedAt isn't a flow we expose), so keep the
	// schema tight.
	publishedAt: z.date().optional(),
	coverImageId: z.string().nullable().optional(),
	// Q8 — Even if clients send this, the server strips it. Accepted in the
	// schema so older payloads don't fail the parse.
	clubShortName: z.string().optional(),
});

// ─── Select shapes ───────────────────────────────────────────────────────────

const announcementCardSelect = {
	id: true,
	title: true,
	bodyHtml: true,
	coverImageId: true,
	publishedAt: true,
	coverImage: { select: { alt: true } },
	author: {
		select: {
			firstName: true,
			lastName: true,
			profileImage: true,
		},
	},
} satisfies Prisma.ClubAnnouncementSelect;

type AnnouncementCardRow = Prisma.ClubAnnouncementGetPayload<{
	select: typeof announcementCardSelect;
}>;

function toAnnouncementCard(row: AnnouncementCardRow): AnnouncementCard {
	return {
		id: row.id,
		title: row.title,
		bodyHtml: row.bodyHtml,
		coverImageUrl: coverImageUrl(row.coverImageId),
		coverImageAlt: row.coverImage?.alt ?? null,
		// publishedAt is non-null on PUBLISHED rows (the only ones we surface).
		publishedAt: row.publishedAt as Date,
		author: {
			name: authorName(row.author),
			avatarUrl: authorAvatarUrl(row.author),
		},
	};
}

export const announcementsRouter = createTRPCRouter({
	// ─── PUBLIC ────────────────────────────────────────────────────────────

	// Paginated feed of published announcements for one club. Cursor on id;
	// orderBy publishedAt desc then id desc (stable secondary sort).
	listPublished: publicProcedure
		.input(
			z.object({
				clubShortName: z.string(),
				limit: z.number().int().min(1).max(50).default(20),
				cursor: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { clubShortName, limit, cursor } = input;

			const rows = await ctx.db.clubAnnouncement.findMany({
				where: {
					clubShortName,
					status: AnnouncementStatus.PUBLISHED,
					publishedAt: { lte: new Date() },
				},
				select: announcementCardSelect,
				orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
				take: limit + 1,
				...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			});

			// Cursor pattern (matches checkin.ts:737-741): take limit+1 to peek
			// ahead, then slice off the extra row. nextCursor is the LAST
			// DISPLAYED id — the next call uses `cursor: { id: cursor }, skip: 1`
			// to skip past that id and resume with the next row.
			const hasMore = rows.length > limit;
			const page = hasMore ? rows.slice(0, limit) : rows;
			const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;

			return {
				items: page.map(toAnnouncementCard),
				nextCursor,
			};
		}),

	// ─── ADMIN ─────────────────────────────────────────────────────────────

	// Admin list view.
	//
	// PLATFORM_ADMIN:
	//   - clubShortName === undefined → ALL clubs
	//   - clubShortName === <string>  → that club
	//   (Note: announcements have NO platform scope, so `null` is meaningless
	//   here — the schema requires a clubShortName on every row.)
	//
	// Non-platform-admin staff: clubShortName is IGNORED; force-scope to the
	// caller's club.
	//
	// Q11 draft privacy: COACH/FACILITY see published + their own drafts.
	// CLUB_ADMIN/PLATFORM_ADMIN see all in scope.
	adminList: staffProcedure
		.input(
			z.object({
				clubShortName: z.string().optional(),
				status: z.nativeEnum(AnnouncementStatus).optional(),
			}),
		)
		.query(async ({ ctx, input }): Promise<AdminAnnouncementRow[]> => {
			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;

			// Scope filter.
			let scopeFilter: Prisma.ClubAnnouncementWhereInput = {};
			if (isPlatformAdmin) {
				if (input.clubShortName !== undefined) {
					scopeFilter = { clubShortName: input.clubShortName };
				}
				// else undefined → all clubs (no filter)
			} else {
				scopeFilter = { clubShortName: ctx.user.clubShortName };
			}

			// Draft-visibility filter (Q11). CLUB_ADMIN + PLATFORM_ADMIN see all.
			const isAdminish =
				isPlatformAdmin || ctx.user.userType === UserType.CLUB_ADMIN;
			const draftPrivacyFilter: Prisma.ClubAnnouncementWhereInput = isAdminish
				? {}
				: {
						OR: [
							{ status: AnnouncementStatus.PUBLISHED },
							{
								status: AnnouncementStatus.DRAFT,
								authorId: ctx.user.userId,
							},
						],
					};

			const where: Prisma.ClubAnnouncementWhereInput = {
				...scopeFilter,
				...draftPrivacyFilter,
				...(input.status ? { status: input.status } : {}),
			};

			const rows = await ctx.db.clubAnnouncement.findMany({
				where,
				select: {
					id: true,
					title: true,
					status: true,
					publishedAt: true,
					updatedAt: true,
					clubShortName: true,
					author: { select: { firstName: true, lastName: true } },
				},
				orderBy: { updatedAt: "desc" },
			});

			return rows.map((r) => ({
				id: r.id,
				title: r.title,
				status: r.status,
				publishedAt: r.publishedAt,
				updatedAt: r.updatedAt,
				clubShortName: r.clubShortName,
				authorName: authorName(r.author),
			}));
		}),

	// Full editable detail. NOT_FOUND if missing or unauthorized (Q11 draft
	// privacy applies to read access too — otherwise a COACH could enumerate
	// other authors' drafts by trying IDs).
	adminGetById: staffProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const announcement = await ctx.db.clubAnnouncement.findUnique({
				where: { id: input.id },
				select: {
					id: true,
					title: true,
					bodyHtml: true,
					status: true,
					publishedAt: true,
					coverImageId: true,
					coverImage: { select: { alt: true } },
					clubShortName: true,
					authorId: true,
				},
			});

			if (!announcement) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Announcement not found",
				});
			}

			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;
			const inScope =
				isPlatformAdmin ||
				ctx.user.clubShortName === announcement.clubShortName;

			// Apply Q11 draft privacy on reads. For drafts, only author/CLUB_ADMIN/
			// PLATFORM_ADMIN can see another author's draft. Per Q10, once in
			// scope all staff can EDIT, but for DISCOVERY (read) we mirror
			// articles' privacy posture.
			const isAdminish =
				isPlatformAdmin || ctx.user.userType === UserType.CLUB_ADMIN;
			const canSee =
				inScope &&
				(announcement.status === AnnouncementStatus.PUBLISHED ||
					isAdminish ||
					announcement.authorId === ctx.user.userId);

			if (!canSee) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Announcement not found",
				});
			}

			return {
				id: announcement.id,
				title: announcement.title,
				bodyHtml: announcement.bodyHtml,
				status: announcement.status,
				publishedAt: announcement.publishedAt,
				coverImageId: announcement.coverImageId,
				coverImageUrl: coverImageUrl(announcement.coverImageId),
				coverImageAlt: announcement.coverImage?.alt ?? null,
				clubShortName: announcement.clubShortName,
			};
		}),

	// Create an announcement. authorId = current staff member.
	create: staffProcedure
		.input(announcementCreateSchema)
		.mutation(async ({ ctx, input }) => {
			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;

			// Authorization: PLATFORM_ADMIN any club; else caller must be in the
			// target club AND be staff (FACILITY/CLUB_ADMIN/COACH — the staff
			// procedure already gates this, so we only need the club match).
			if (!isPlatformAdmin && ctx.user.clubShortName !== input.clubShortName) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only create announcements in your own club",
				});
			}

			// Stamp publishedAt = now() if publishing and not explicitly set.
			const publishedAt =
				input.status === AnnouncementStatus.PUBLISHED
					? (input.publishedAt ?? new Date())
					: (input.publishedAt ?? null);

			const announcement = await ctx.db.clubAnnouncement.create({
				data: {
					clubShortName: input.clubShortName,
					title: input.title ?? null,
					bodyHtml: input.bodyHtml,
					status: input.status,
					publishedAt,
					coverImageId: input.coverImageId ?? null,
					authorId: ctx.user.userId,
				},
				select: { id: true },
			});

			return announcement;
		}),

	// Update an announcement. Q8: clubShortName STRIPPED from input.
	// Q10: any staff in announcement's club can edit; NO per-author check.
	update: staffProcedure
		.input(announcementUpdateSchema)
		.mutation(async ({ ctx, input }) => {
			// Q8: strip clubShortName from update payload (even if a client sends
			// it, scope is locked at creation).
			const { id, clubShortName: _ignoredScope, ...rest } = input;

			const existing = await ctx.db.clubAnnouncement.findUnique({
				where: { id },
				select: {
					id: true,
					status: true,
					publishedAt: true,
					clubShortName: true,
				},
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Announcement not found",
				});
			}

			if (!canModifyAnnouncement(ctx.user, existing)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You don't have permission to edit this announcement",
				});
			}

			const data: Prisma.ClubAnnouncementUpdateInput = {};

			if (rest.title !== undefined) data.title = rest.title;
			if (rest.bodyHtml !== undefined) data.bodyHtml = rest.bodyHtml;
			if (rest.coverImageId !== undefined) {
				data.coverImage =
					rest.coverImageId === null
						? { disconnect: true }
						: { connect: { id: rest.coverImageId } };
			}

			// Status + publishedAt transitions. First publish stamps publishedAt.
			const nextStatus = rest.status ?? existing.status;
			if (rest.status !== undefined) data.status = rest.status;
			if (rest.publishedAt !== undefined) data.publishedAt = rest.publishedAt;

			const willHavePublishedAt =
				rest.publishedAt !== undefined
					? rest.publishedAt
					: existing.publishedAt;
			if (nextStatus === AnnouncementStatus.PUBLISHED && !willHavePublishedAt) {
				data.publishedAt = new Date();
			}

			const announcement = await ctx.db.clubAnnouncement.update({
				where: { id },
				data,
				select: { id: true },
			});

			return announcement;
		}),

	// Toggle status. First publish stamps publishedAt = now(). Q10 check.
	setStatus: staffProcedure
		.input(
			z.object({ id: z.string(), status: z.nativeEnum(AnnouncementStatus) }),
		)
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.clubAnnouncement.findUnique({
				where: { id: input.id },
				select: {
					id: true,
					publishedAt: true,
					clubShortName: true,
				},
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Announcement not found",
				});
			}

			if (!canModifyAnnouncement(ctx.user, existing)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"You don't have permission to change this announcement's status",
				});
			}

			const shouldStamp =
				input.status === AnnouncementStatus.PUBLISHED && !existing.publishedAt;

			const announcement = await ctx.db.clubAnnouncement.update({
				where: { id: input.id },
				data: {
					status: input.status,
					...(shouldStamp ? { publishedAt: new Date() } : {}),
				},
				select: { id: true, status: true, publishedAt: true },
			});

			return announcement;
		}),

	// Delete. Q10 check (any staff in club). Cascades handle FK rows.
	delete: staffProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.clubAnnouncement.findUnique({
				where: { id: input.id },
				select: { id: true, clubShortName: true },
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Announcement not found",
				});
			}

			if (!canModifyAnnouncement(ctx.user, existing)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You don't have permission to delete this announcement",
				});
			}

			await ctx.db.clubAnnouncement.delete({ where: { id: input.id } });
			return { success: true };
		}),
});
