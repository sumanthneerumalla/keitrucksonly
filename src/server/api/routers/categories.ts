import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	clubAdminProcedure,
	createTRPCRouter,
	facilityProcedure,
} from "~/server/api/trpc";

// ============================================================
// INPUT SCHEMAS
// ============================================================

const createCategorySchema = z.object({
	name: z.string().min(1).max(200).trim(),
	parentCategoryId: z.string().optional(),
	sortOrder: z.number().int().min(0).default(0),
});

const updateCategorySchema = z.object({
	categoryId: z.string(),
	name: z.string().min(1).max(200).trim().optional(),
	parentCategoryId: z.string().nullable().optional(),
	sortOrder: z.number().int().min(0).optional(),
	isActive: z.boolean().optional(),
});

const archiveCategorySchema = z.object({
	categoryId: z.string(),
});

// ============================================================
// HELPERS
// ============================================================

/** Enforce 2-category-level cap: a category at depth 2 cannot have children. */
async function getCategoryDepth(
	db: PrismaClient,
	categoryId: string,
): Promise<number> {
	let depth = 0;
	let currentId: string | null = categoryId;

	while (currentId) {
		const cat: { parentCategoryId: string | null } | null =
			await db.productCategory.findUnique({
				where: { categoryId: currentId },
				select: { parentCategoryId: true },
			});
		if (!cat?.parentCategoryId) break;
		currentId = cat.parentCategoryId;
		depth++;
	}

	return depth;
}

// ============================================================
// ROUTER
// ============================================================

export const categoriesRouter = createTRPCRouter({
	/** Full category tree for the club, with product counts */
	listCategories: facilityProcedure.query(async ({ ctx }) => {
		const categories = await ctx.db.productCategory.findMany({
			where: { clubShortName: ctx.user.clubShortName },
			include: {
				_count: { select: { products: true, children: true } },
			},
			orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
		});

		// Build tree structure
		const byId = new Map(categories.map((c) => [c.categoryId, c]));
		const roots: typeof categories = [];

		for (const cat of categories) {
			if (!cat.parentCategoryId) {
				roots.push(cat);
			}
		}

		// Return flat list with parentCategoryId — let the client build the tree
		return { categories };
	}),

	/** Create a category. Enforces 2-level cap. */
	createCategory: clubAdminProcedure
		.input(createCategorySchema)
		.mutation(async ({ ctx, input }) => {
			// Enforce 2-level cap: if parent exists, parent must be at depth 0 (top-level)
			if (input.parentCategoryId) {
				const parentDepth = await getCategoryDepth(
					ctx.db,
					input.parentCategoryId,
				);
				if (parentDepth >= 1) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"Cannot create a subcategory more than 2 levels deep. Categories support 2 levels of categories + products at the leaf.",
					});
				}

				// Verify parent belongs to the same club
				const parent = await ctx.db.productCategory.findUnique({
					where: { categoryId: input.parentCategoryId },
					select: { clubShortName: true },
				});
				if (!parent || parent.clubShortName !== ctx.user.clubShortName) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Parent category not found",
					});
				}
			}

			return ctx.db.productCategory.create({
				data: {
					clubShortName: ctx.user.clubShortName,
					name: input.name,
					parentCategoryId: input.parentCategoryId ?? null,
					sortOrder: input.sortOrder,
				},
			});
		}),

	/** Update a category. */
	updateCategory: clubAdminProcedure
		.input(updateCategorySchema)
		.mutation(async ({ ctx, input }) => {
			const { categoryId, ...data } = input;

			const existing = await ctx.db.productCategory.findUnique({
				where: { categoryId },
			});

			if (!existing || existing.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Category not found",
				});
			}

			// If changing parent, enforce 2-level cap
			if (
				data.parentCategoryId !== undefined &&
				data.parentCategoryId !== null
			) {
				const parentDepth = await getCategoryDepth(
					ctx.db,
					data.parentCategoryId,
				);
				if (parentDepth >= 1) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Cannot move category: would exceed 2-level depth limit",
					});
				}
			}

			return ctx.db.productCategory.update({
				where: { categoryId },
				data: {
					...(data.name !== undefined && { name: data.name }),
					...(data.parentCategoryId !== undefined && {
						parentCategoryId: data.parentCategoryId,
					}),
					...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
					...(data.isActive !== undefined && { isActive: data.isActive }),
				},
			});
		}),

	/** Archive a category. Blocked if active children or active products exist. */
	archiveCategory: clubAdminProcedure
		.input(archiveCategorySchema)
		.mutation(async ({ ctx, input }) => {
			const category = await ctx.db.productCategory.findUnique({
				where: { categoryId: input.categoryId },
				include: {
					_count: {
						select: {
							products: { where: { isActive: true } },
							children: { where: { isActive: true } },
						},
					},
				},
			});

			if (!category || category.clubShortName !== ctx.user.clubShortName) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Category not found",
				});
			}

			if (category._count.children > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Cannot archive category with active subcategories. Archive or remove subcategories first.",
				});
			}

			if (category._count.products > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Cannot archive category with active products. Archive or reassign products first.",
				});
			}

			return ctx.db.productCategory.update({
				where: { categoryId: input.categoryId },
				data: { isActive: false },
			});
		}),
});
