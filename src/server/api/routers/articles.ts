import { ArticleStatus, type Prisma, UserType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	type ArticleCard,
	type ArticleDetail,
	CONTENT_IMAGE_URL,
} from "~/lib/article";
import { readingTimeMinutes } from "~/lib/readingTime";
import { slugify } from "~/lib/slug";
import {
	createTRPCRouter,
	publicProcedure,
	staffProcedure,
} from "~/server/api/trpc";

// ─── Phase 15 Stage 2 — Authorization helper ─────────────────────────────────

// Server-side canModifyArticle check.
//
// PLATFORM_ADMIN: can modify any article in any scope.
// Caller must be in the post's scope to modify (clubShortName must match —
// note that a caller from `shuttlementor` cannot modify a `nvbc` article and
// vice-versa; platform articles have post.clubShortName === null but no
// caller will ever have user.clubShortName === null, so platform articles are
// only editable by PLATFORM_ADMIN).
// CLUB_ADMIN: any article in their own scope.
// COACH / FACILITY: only articles they themselves authored.
//
// Mirrored client-side at `~/lib/article.ts#canModifyArticleClient` so the UI
// can hide the edit/delete buttons (server still enforces — defense in depth).
function canModifyArticle(
	user: { userId: string; userType: UserType; clubShortName: string },
	post: { authorId: string; clubShortName: string | null },
): boolean {
	if (user.userType === UserType.PLATFORM_ADMIN) return true;
	if (user.clubShortName !== post.clubShortName) return false;
	if (user.userType === UserType.CLUB_ADMIN) return true;
	return user.userId === post.authorId;
}

/**
 * Authorization-error posture (Phase 15 design decision, 2026-05-29):
 *
 * - READS (`adminGetById`): return NOT_FOUND when the caller lacks scope/author
 *   access, to avoid leaking the existence of an article via the read path
 *   (the discovery channel).
 * - WRITES (`update`, `setStatus`, `delete`): return FORBIDDEN when the caller
 *   lacks modification rights. Rationale: mutations require knowing the
 *   article ID, so the attack surface is low, and FORBIDDEN is a clearer
 *   signal to legitimate callers (e.g., a CLUB_ADMIN who knows the article
 *   exists but is enforced into per-author trust at the wrong scope).
 */

// ─── Zod schemas (limits mirror the @db constraints in schema.prisma) ────────

const articleInputSchema = z.object({
	title: z.string().min(1).max(200),
	slug: z.string().max(200).optional(),
	excerpt: z.string().max(500).optional(),
	bodyHtml: z.string(),
	status: z.nativeEnum(ArticleStatus),
	publishedAt: z.date().optional(),
	coverImageId: z.string().nullable().optional(),
	metaTitle: z.string().max(200).optional(),
	metaDescription: z.string().max(500).optional(),
	tagIds: z.array(z.string()).optional(),
	// Phase 15 Stage 2: scope. Null = platform; string = that club. Locked at
	// creation (Q8); `update` strips this field even if a client sends it.
	clubShortName: z.string().nullable().optional(),
});

// `update` accepts an id plus a partial of the create input. clubShortName is
// stripped server-side regardless of what the client sends.
const articleUpdateSchema = articleInputSchema.partial().extend({
	id: z.string(),
});

// ─── Author display helpers (single source of truth for return shapes) ───────

// Author display name = full name, falling back to the brand.
function authorName(author: {
	firstName: string | null;
	lastName: string | null;
}): string {
	return (
		[author.firstName, author.lastName].filter(Boolean).join(" ") ||
		"Facility Presence"
	);
}

// User.profileImage is a String? (URL or data URI) — passed through AS-IS.
// Avatars are NOT routed through /api/content-image (that's only for ContentImage).
function authorAvatarUrl(author: { profileImage: string | null }):
	| string
	| null {
	return author.profileImage ?? null;
}

function coverImageUrl(coverImageId: string | null): string | null {
	return coverImageId ? CONTENT_IMAGE_URL(coverImageId) : null;
}

// Phase 15 Step 5 polish (F8): card vs detail selects.
//
// articleCardSelect is the minimum payload for list/grid surfaces — NO bodyHtml,
// NO authorBio. Reading time is read from the precomputed `readingTimeMinutes`
// column (kept in sync on every write below), so we don't ship full bodies over
// the wire just to display "N min read".
//
// articleDetailSelect extends with the heavy fields (bodyHtml + authorBio) for
// the single-article detail page only.
const articleCardSelect = {
	id: true,
	slug: true,
	title: true,
	excerpt: true,
	coverImageId: true,
	publishedAt: true,
	readingTimeMinutes: true,
	clubShortName: true,
	author: {
		select: {
			userId: true,
			firstName: true,
			lastName: true,
			profileImage: true,
		},
	},
	tags: {
		select: {
			tag: { select: { name: true, slug: true } },
		},
	},
} satisfies Prisma.ArticleSelect;

const articleDetailSelect = {
	...articleCardSelect,
	bodyHtml: true,
	author: {
		select: {
			userId: true,
			firstName: true,
			lastName: true,
			profileImage: true,
			authorBio: true,
		},
	},
} satisfies Prisma.ArticleSelect;

type ArticleCardRow = Prisma.ArticleGetPayload<{
	select: typeof articleCardSelect;
}>;

type ArticleDetailRow = Prisma.ArticleGetPayload<{
	select: typeof articleDetailSelect;
}>;

function toArticleCard(article: ArticleCardRow): ArticleCard {
	return {
		id: article.id,
		slug: article.slug,
		title: article.title,
		excerpt: article.excerpt,
		coverImageUrl: coverImageUrl(article.coverImageId),
		// publishedAt is non-null for every card we surface (published only).
		publishedAt: article.publishedAt as Date,
		readingTimeMinutes: article.readingTimeMinutes,
		clubShortName: article.clubShortName,
		author: {
			name: authorName(article.author),
			avatarUrl: authorAvatarUrl(article.author),
		},
		tags: article.tags.map((t) => ({ name: t.tag.name, slug: t.tag.slug })),
	};
}

function toArticleDetail(article: ArticleDetailRow): ArticleDetail {
	return {
		// Card fields — note: ArticleDetailRow is a superset of ArticleCardRow,
		// so this is type-safe.
		id: article.id,
		slug: article.slug,
		title: article.title,
		excerpt: article.excerpt,
		coverImageUrl: coverImageUrl(article.coverImageId),
		publishedAt: article.publishedAt as Date,
		readingTimeMinutes: article.readingTimeMinutes,
		clubShortName: article.clubShortName,
		tags: article.tags.map((t) => ({ name: t.tag.name, slug: t.tag.slug })),
		// Detail-only fields.
		bodyHtml: article.bodyHtml,
		coverImageAlt: null,
		metaTitle: null,
		metaDescription: null,
		author: {
			userId: article.author.userId,
			name: authorName(article.author),
			avatarUrl: authorAvatarUrl(article.author),
			bio: article.author.authorBio,
		},
	};
}

// ─── Slug uniqueness helper ──────────────────────────────────────────────────

// Ensure a unique slug WITHIN A SCOPE (clubShortName: null = platform; string
// = that club). Appends -2, -3, … on collision. `excludeId` lets an update
// keep its own slug.
async function uniqueSlug(
	db: Prisma.TransactionClient | typeof import("~/server/db").db,
	base: string,
	scope: string | null,
	excludeId?: string,
): Promise<string> {
	let candidate = base;
	let suffix = 2;
	while (true) {
		const existing = await db.article.findFirst({
			where: { clubShortName: scope, slug: candidate },
			select: { id: true },
		});
		if (!existing || existing.id === excludeId) return candidate;
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
}

// Phase 15 Step 5 polish (F5) — race-condition defense for the per-scope slug
// composite unique. Two concurrent creates against the same (scope, base-title)
// can both pass `uniqueSlug` (which is read-only) and then one of them fails
// at INSERT with Prisma's P2002 on the composite unique. We retry ONCE with a
// fresh `uniqueSlug` lookup; if it still collides, surface a clean CONFLICT to
// the client. Defense for concurrent creates under the same scope+slug;
// expected to be rare in editorial cadence.
function isPrismaUniqueConstraintError(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as { code?: unknown }).code === "P2002"
	);
}

async function retryOnSlugCollision<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (err) {
		if (!isPrismaUniqueConstraintError(err)) throw err;
		try {
			return await work();
		} catch (err2) {
			if (!isPrismaUniqueConstraintError(err2)) throw err2;
			throw new TRPCError({
				code: "CONFLICT",
				message: "Slug collision — please try a different title.",
			});
		}
	}
}

// ─── Scope input helpers ─────────────────────────────────────────────────────

// Public listing scope: `undefined` or `null` collapse to "platform only"
// (where clubShortName IS NULL). A string narrows to that club.
function scopeWhere(scope: string | null | undefined): {
	clubShortName: string | null;
} {
	if (scope === undefined || scope === null) {
		return { clubShortName: null };
	}
	return { clubShortName: scope };
}

export const articlesRouter = createTRPCRouter({
	// ─── PUBLIC ────────────────────────────────────────────────────────────────

	// Paginated feed of published articles, optionally filtered by tag.
	// `clubShortName`: undefined/null = platform; string = that club.
	listPublished: publicProcedure
		.input(
			z.object({
				limit: z.number().int().min(1).max(50).default(12),
				cursor: z.string().optional(),
				tagSlug: z.string().optional(),
				clubShortName: z.string().nullable().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { limit, cursor, tagSlug, clubShortName } = input;

			const where: Prisma.ArticleWhereInput = {
				status: ArticleStatus.PUBLISHED,
				publishedAt: { lte: new Date() },
				...scopeWhere(clubShortName),
				...(tagSlug ? { tags: { some: { tag: { slug: tagSlug } } } } : {}),
			};

			const rows = await ctx.db.article.findMany({
				where,
				select: articleCardSelect,
				orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
				take: limit + 1,
				...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			});

			let nextCursor: string | undefined;
			if (rows.length > limit) {
				const next = rows.pop();
				nextCursor = next?.id;
			}

			return {
				items: rows.map(toArticleCard),
				nextCursor,
			};
		}),

	// Single published article by slug WITHIN A SCOPE. NOT_FOUND if missing or
	// not published in that scope. We use findFirst because nullable composite
	// uniques can't be queried via findUnique.
	getBySlug: publicProcedure
		.input(
			z.object({
				slug: z.string(),
				clubShortName: z.string().nullable().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const article = await ctx.db.article.findFirst({
				where: {
					slug: input.slug,
					...scopeWhere(input.clubShortName),
				},
				select: {
					...articleDetailSelect,
					coverImage: { select: { alt: true } },
					metaTitle: true,
					metaDescription: true,
					status: true,
				},
			});

			if (
				!article ||
				article.status !== ArticleStatus.PUBLISHED ||
				!article.publishedAt ||
				article.publishedAt > new Date()
			) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Article not found",
				});
			}

			const detail = toArticleDetail(article);
			detail.coverImageAlt = article.coverImage?.alt ?? null;
			detail.metaTitle = article.metaTitle;
			detail.metaDescription = article.metaDescription;
			return detail;
		}),

	// Tags WITHIN A SCOPE that have ≥1 published article in that scope, with
	// the per-scope published-article count.
	listTags: publicProcedure
		.input(
			z
				.object({
					clubShortName: z.string().nullable().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const scope = input?.clubShortName;
			const now = new Date();
			const tags = await ctx.db.articleTag.findMany({
				where: scopeWhere(scope),
				select: {
					name: true,
					slug: true,
					_count: {
						select: {
							articles: {
								where: {
									article: {
										status: ArticleStatus.PUBLISHED,
										publishedAt: { lte: now },
										...scopeWhere(scope),
									},
								},
							},
						},
					},
				},
				orderBy: { name: "asc" },
			});

			return tags
				.map((t) => ({ name: t.name, slug: t.slug, count: t._count.articles }))
				.filter((t) => t.count > 0);
		}),

	// Resolve a tag by slug WITHIN A SCOPE (for tag landing pages). NOT_FOUND
	// if missing. findFirst — nullable composite unique.
	getTagBySlug: publicProcedure
		.input(
			z.object({
				slug: z.string(),
				clubShortName: z.string().nullable().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const tag = await ctx.db.articleTag.findFirst({
				where: {
					slug: input.slug,
					...scopeWhere(input.clubShortName),
				},
				select: { name: true, slug: true },
			});
			if (!tag) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
			}
			return tag;
		}),

	// Published articles by a given author WITHIN A SCOPE. Same shape as
	// listPublished.
	listByAuthor: publicProcedure
		.input(
			z.object({
				authorId: z.string(),
				limit: z.number().int().min(1).max(50).default(12),
				cursor: z.string().optional(),
				clubShortName: z.string().nullable().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { authorId, limit, cursor, clubShortName } = input;

			const rows = await ctx.db.article.findMany({
				where: {
					authorId,
					status: ArticleStatus.PUBLISHED,
					publishedAt: { lte: new Date() },
					...scopeWhere(clubShortName),
				},
				select: articleCardSelect,
				orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
				take: limit + 1,
				...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			});

			let nextCursor: string | undefined;
			if (rows.length > limit) {
				const next = rows.pop();
				nextCursor = next?.id;
			}

			return {
				items: rows.map(toArticleCard),
				nextCursor,
			};
		}),

	// ─── ADMIN ───────────────────────────────────────────────────────────────

	// Admin list view.
	//
	// PLATFORM_ADMIN:
	//   - clubShortName === undefined → ALL scopes
	//   - clubShortName === null      → platform only
	//   - clubShortName === <string>  → that club
	//
	// Non-platform-admin staff: clubShortName is IGNORED; force-scope to the
	// caller's club. Draft privacy (Q11): COACH/FACILITY see published rows
	// plus their own drafts; CLUB_ADMIN sees everything in scope.
	adminList: staffProcedure
		.input(
			z.object({
				status: z.nativeEnum(ArticleStatus).optional(),
				clubShortName: z.string().nullable().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;

			// Build scope filter.
			let scopeFilter: Prisma.ArticleWhereInput = {};
			if (isPlatformAdmin) {
				if (input.clubShortName !== undefined) {
					scopeFilter = { clubShortName: input.clubShortName };
				}
				// else undefined → all scopes (no filter)
			} else {
				// Non-platform-admin: always scoped to own club
				scopeFilter = { clubShortName: ctx.user.clubShortName };
			}

			// Draft-visibility filter (Q11). CLUB_ADMIN and PLATFORM_ADMIN see all.
			const isAdminish =
				isPlatformAdmin || ctx.user.userType === UserType.CLUB_ADMIN;
			const draftPrivacyFilter: Prisma.ArticleWhereInput = isAdminish
				? {}
				: {
						OR: [
							{ status: ArticleStatus.PUBLISHED },
							{
								status: ArticleStatus.DRAFT,
								authorId: ctx.user.userId,
							},
						],
					};

			const where: Prisma.ArticleWhereInput = {
				...scopeFilter,
				...draftPrivacyFilter,
				...(input.status ? { status: input.status } : {}),
			};

			const rows = await ctx.db.article.findMany({
				where,
				select: {
					id: true,
					title: true,
					slug: true,
					status: true,
					publishedAt: true,
					updatedAt: true,
					clubShortName: true,
					authorId: true,
					author: { select: { firstName: true, lastName: true } },
				},
				orderBy: { updatedAt: "desc" },
			});

			return rows.map((p) => ({
				id: p.id,
				title: p.title,
				slug: p.slug,
				status: p.status,
				publishedAt: p.publishedAt,
				updatedAt: p.updatedAt,
				clubShortName: p.clubShortName,
				authorName: authorName(p.author),
				canEdit: canModifyArticle(ctx.user, {
					authorId: p.authorId,
					clubShortName: p.clubShortName,
				}),
			}));
		}),

	// Full editable detail for one article. Throws NOT_FOUND if the caller
	// can't access it (don't leak existence to outsiders).
	adminGetById: staffProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const article = await ctx.db.article.findUnique({
				where: { id: input.id },
				select: {
					id: true,
					title: true,
					slug: true,
					excerpt: true,
					bodyHtml: true,
					status: true,
					publishedAt: true,
					coverImageId: true,
					metaTitle: true,
					metaDescription: true,
					coverImage: { select: { alt: true } },
					tags: { select: { tagId: true } },
					clubShortName: true,
					authorId: true,
				},
			});

			if (!article) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Article not found",
				});
			}

			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;
			const inScope =
				isPlatformAdmin || ctx.user.clubShortName === article.clubShortName;
			// For drafts, apply Q11: only author / CLUB_ADMIN / PLATFORM_ADMIN can
			// view another author's draft.
			const canSee =
				inScope &&
				(article.status === ArticleStatus.PUBLISHED ||
					canModifyArticle(ctx.user, article));
			if (!canSee) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Article not found",
				});
			}

			return {
				id: article.id,
				title: article.title,
				slug: article.slug,
				excerpt: article.excerpt,
				bodyHtml: article.bodyHtml,
				status: article.status,
				publishedAt: article.publishedAt,
				coverImageId: article.coverImageId,
				coverImageUrl: coverImageUrl(article.coverImageId),
				coverImageAlt: article.coverImage?.alt ?? null,
				metaTitle: article.metaTitle,
				metaDescription: article.metaDescription,
				tagIds: article.tags.map((t) => t.tagId),
				clubShortName: article.clubShortName,
				canEdit: canModifyArticle(ctx.user, article),
			};
		}),

	// Create an article. authorId = current staff member. Auto-slug + auto-
	// publishedAt. Scope rules:
	//   - clubShortName === null/undefined: caller defaults to own club for
	//     non-platform-admins; PLATFORM_ADMIN must EXPLICITLY pass null to
	//     create a platform article (we don't infer platform for non-admins).
	//   - clubShortName === <string>: caller must be PLATFORM_ADMIN OR in that
	//     club.
	create: staffProcedure
		.input(articleInputSchema)
		.mutation(async ({ ctx, input }) => {
			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;

			// Resolve scope.
			let scope: string | null;
			if (input.clubShortName === undefined) {
				// Omitted → default to caller's club (non-admins) OR force admin to
				// be explicit about platform vs club.
				if (isPlatformAdmin) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"PLATFORM_ADMIN must explicitly specify clubShortName (null for platform, a club shortname for a club article)",
					});
				}
				scope = ctx.user.clubShortName;
			} else if (input.clubShortName === null) {
				// Explicit platform — only PLATFORM_ADMIN.
				if (!isPlatformAdmin) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Only platform admins can create platform articles",
					});
				}
				scope = null;
			} else {
				// Explicit club shortname.
				if (
					!isPlatformAdmin &&
					ctx.user.clubShortName !== input.clubShortName
				) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You can only create articles in your own club",
					});
				}
				scope = input.clubShortName;
			}

			const baseSlug = slugify(input.slug?.trim() || input.title);

			const publishedAt =
				input.status === ArticleStatus.PUBLISHED
					? (input.publishedAt ?? new Date())
					: (input.publishedAt ?? null);

			// Phase 15 Step 5 polish (F8): precompute reading time at write-time so
			// card queries can read it from the column instead of shipping bodyHtml.
			const readingTime = readingTimeMinutes(input.bodyHtml);

			// F5: wrap the insert in a retry-once-on-P2002. `uniqueSlug` is
			// recomputed inside `work` on each attempt so the second try sees any
			// concurrently-inserted slug.
			const article = await retryOnSlugCollision(async () => {
				const slug = await uniqueSlug(ctx.db, baseSlug, scope);
				return ctx.db.article.create({
					data: {
						title: input.title,
						slug,
						excerpt: input.excerpt,
						bodyHtml: input.bodyHtml,
						readingTimeMinutes: readingTime,
						status: input.status,
						publishedAt,
						coverImageId: input.coverImageId ?? null,
						metaTitle: input.metaTitle,
						metaDescription: input.metaDescription,
						authorId: ctx.user.userId,
						clubShortName: scope,
						...(input.tagIds && input.tagIds.length > 0
							? {
									tags: {
										create: input.tagIds.map((tagId) => ({ tagId })),
									},
								}
							: {}),
					},
					select: { id: true, slug: true },
				});
			});

			return article;
		}),

	// Update an article. Re-validates slug WITHIN EXISTING SCOPE, auto-
	// publishes, replaces tag set. clubShortName is STRIPPED from input — scope
	// is locked at creation (Q8).
	update: staffProcedure
		.input(articleUpdateSchema)
		.mutation(async ({ ctx, input }) => {
			// Q8: strip clubShortName from update payload.
			const { id, tagIds, clubShortName: _ignoredScope, ...rest } = input;

			const existing = await ctx.db.article.findUnique({
				where: { id },
				select: {
					id: true,
					slug: true,
					status: true,
					publishedAt: true,
					clubShortName: true,
					authorId: true,
				},
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Article not found",
				});
			}

			if (!canModifyArticle(ctx.user, existing)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You don't have permission to edit this article",
				});
			}

			const data: Prisma.ArticleUpdateInput = {};

			if (rest.title !== undefined) data.title = rest.title;
			if (rest.excerpt !== undefined) data.excerpt = rest.excerpt;
			if (rest.bodyHtml !== undefined) {
				data.bodyHtml = rest.bodyHtml;
				// F8: recompute reading time whenever bodyHtml changes.
				data.readingTimeMinutes = readingTimeMinutes(rest.bodyHtml);
			}
			if (rest.metaTitle !== undefined) data.metaTitle = rest.metaTitle;
			if (rest.metaDescription !== undefined)
				data.metaDescription = rest.metaDescription;
			if (rest.coverImageId !== undefined) {
				data.coverImage =
					rest.coverImageId === null
						? { disconnect: true }
						: { connect: { id: rest.coverImageId } };
			}

			// Status + publishedAt transitions.
			const nextStatus = rest.status ?? existing.status;
			if (rest.status !== undefined) data.status = rest.status;
			if (rest.publishedAt !== undefined) data.publishedAt = rest.publishedAt;

			// First publish: stamp publishedAt = now() when transitioning to
			// PUBLISHED and no publishedAt is set (existing or incoming).
			const willHavePublishedAt =
				rest.publishedAt !== undefined
					? rest.publishedAt
					: existing.publishedAt;
			if (nextStatus === ArticleStatus.PUBLISHED && !willHavePublishedAt) {
				data.publishedAt = new Date();
			}

			// Replace the full tag set when tagIds provided.
			if (tagIds !== undefined) {
				data.tags = {
					deleteMany: {},
					...(tagIds.length > 0
						? { create: tagIds.map((tagId) => ({ tagId })) }
						: {}),
				};
			}

			// F5: when slug changes, both `uniqueSlug` and the UPDATE need to be
			// inside the retry block so the second attempt re-resolves a fresh
			// candidate. When slug is NOT changing, the UPDATE never races on slug
			// — but wrapping it costs nothing and keeps the code simple.
			const baseSlugForUpdate =
				rest.slug !== undefined
					? slugify(rest.slug.trim() || rest.title || existing.slug)
					: null;

			const article = await retryOnSlugCollision(async () => {
				if (baseSlugForUpdate !== null) {
					data.slug = await uniqueSlug(
						ctx.db,
						baseSlugForUpdate,
						existing.clubShortName,
						id,
					);
				}
				return ctx.db.article.update({
					where: { id },
					data,
					select: { id: true, slug: true },
				});
			});

			return article;
		}),

	// Toggle status. First publish stamps publishedAt = now().
	setStatus: staffProcedure
		.input(z.object({ id: z.string(), status: z.nativeEnum(ArticleStatus) }))
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.article.findUnique({
				where: { id: input.id },
				select: {
					id: true,
					publishedAt: true,
					clubShortName: true,
					authorId: true,
				},
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Article not found",
				});
			}

			if (!canModifyArticle(ctx.user, existing)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You don't have permission to change this article's status",
				});
			}

			const shouldStamp =
				input.status === ArticleStatus.PUBLISHED && !existing.publishedAt;

			const article = await ctx.db.article.update({
				where: { id: input.id },
				data: {
					status: input.status,
					...(shouldStamp ? { publishedAt: new Date() } : {}),
				},
				select: { id: true, status: true, publishedAt: true },
			});

			return article;
		}),

	// Delete an article (ArticleTagJoin rows cascade).
	delete: staffProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.article.findUnique({
				where: { id: input.id },
				select: { id: true, clubShortName: true, authorId: true },
			});
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Article not found",
				});
			}

			if (!canModifyArticle(ctx.user, existing)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You don't have permission to delete this article",
				});
			}

			await ctx.db.article.delete({ where: { id: input.id } });
			return { success: true };
		}),

	// Scoped tag list for the admin TagPicker. Same scope semantics as
	// `adminList`: PLATFORM_ADMIN honors clubShortName as-is (undefined = all
	// scopes, null = platform only, string = that club); other staff are
	// force-scoped to their own club. Tag.articleCount is per-scope.
	//
	// Phase 15 Step 5 polish (F10) — cross-scope count caveat:
	// When PLATFORM_ADMIN omits `clubShortName` (ALL-scopes view), the per-row
	// `articleCount` is a single JOIN-count over `articles` without a scope
	// filter. This is correct TODAY because the schema enforces per-scope
	// taxonomy: ArticleTag has its own clubShortName and a tag can only be
	// attached to articles via ArticleTagJoin where the article scope happens to
	// match the tag scope (the admin UI's TagPicker filters by scope, and the
	// `adminCreateTag` mutation creates tags in a single scope). So today every
	// article on a tag IS in that tag's scope — the count is implicitly
	// scope-aware.
	//
	// IF cross-scope joins ever become possible (e.g. a future "promote club tag
	// to platform tag" workflow, or a shared taxonomy migration), this query
	// will silently over-count. The fix is to switch to N+1: fetch tag rows,
	// then per-tag run a count scoped to `articles.clubShortName === tag.clubShortName`.
	// Tags are small (single digits per club), so N+1 is acceptable.
	adminListTags: staffProcedure
		.input(
			z
				.object({
					clubShortName: z.string().nullable().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;

			let tagWhere: Prisma.ArticleTagWhereInput = {};
			let articleCountScope: { clubShortName: string | null } | null = null;
			if (isPlatformAdmin) {
				if (input?.clubShortName !== undefined) {
					tagWhere = { clubShortName: input.clubShortName };
					articleCountScope = { clubShortName: input.clubShortName };
				}
				// else undefined → all scopes (count is implicitly per-tag-scope; see F10 note above)
			} else {
				tagWhere = { clubShortName: ctx.user.clubShortName };
				articleCountScope = { clubShortName: ctx.user.clubShortName };
			}

			const tags = await ctx.db.articleTag.findMany({
				where: tagWhere,
				select: {
					id: true,
					name: true,
					slug: true,
					clubShortName: true,
					_count: {
						select: {
							articles: articleCountScope
								? {
										where: {
											article: articleCountScope,
										},
									}
								: true,
						},
					},
				},
				orderBy: { name: "asc" },
			});

			return tags.map((t) => ({
				id: t.id,
				name: t.name,
				slug: t.slug,
				clubShortName: t.clubShortName,
				articleCount: t._count.articles,
			}));
		}),

	// Create a tag IN A SCOPE. Same scope-auth rules as `create` for articles:
	//   - clubShortName === null: only PLATFORM_ADMIN may create platform tags
	//   - clubShortName === <string>: must be PLATFORM_ADMIN or in that club
	// clubShortName is REQUIRED (caller must specify scope explicitly).
	// Unique within scope on both name and slug (CONFLICT if either exists).
	adminCreateTag: staffProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100),
				clubShortName: z.string().nullable(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;
			const scope = input.clubShortName;

			if (scope === null) {
				if (!isPlatformAdmin) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Only platform admins can create platform tags",
					});
				}
			} else if (!isPlatformAdmin && ctx.user.clubShortName !== scope) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only create tags in your own club",
				});
			}

			const name = input.name.trim();
			const slug = slugify(name);

			const existing = await ctx.db.articleTag.findFirst({
				where: {
					clubShortName: scope,
					OR: [{ name }, { slug }],
				},
				select: { id: true },
			});
			if (existing) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "A tag with that name already exists in this scope",
				});
			}

			const tag = await ctx.db.articleTag.create({
				data: { name, slug, clubShortName: scope },
				select: { id: true, name: true, slug: true, clubShortName: true },
			});
			return tag;
		}),

	// Delete a tag (ArticleTagJoin rows cascade). PLATFORM_ADMIN any. Other
	// staff must be CLUB_ADMIN AND in the tag's scope. COACH/FACILITY can
	// create and use tags but not delete (prevents accidental destruction of
	// taxonomy shared with other authors).
	adminDeleteTag: staffProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const tag = await ctx.db.articleTag.findUnique({
				where: { id: input.id },
				select: { id: true, clubShortName: true },
			});
			if (!tag) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Tag not found",
				});
			}

			const isPlatformAdmin = ctx.user.userType === UserType.PLATFORM_ADMIN;
			if (!isPlatformAdmin) {
				if (ctx.user.userType !== UserType.CLUB_ADMIN) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Only club admins can delete tags",
					});
				}
				if (ctx.user.clubShortName !== tag.clubShortName) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You can only delete tags in your own club",
					});
				}
			}

			await ctx.db.articleTag.delete({ where: { id: input.id } });
			return { success: true };
		}),
});
