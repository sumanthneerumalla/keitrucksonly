import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import { getCurrentUser, isPlatformAdmin } from "~/server/utils/utils";

// ============================================================
// INPUT SCHEMAS
// ============================================================

const createProductSchema = z.object({
	categoryId: z.string().min(1),
	name: z.string().min(1).max(200).trim(),
	description: z.string().max(2000).trim().optional(),
	sku: z.string().max(100).trim().optional(),
	priceInCents: z.number().int().min(0),
	currency: z.string().length(3).default("usd"),
});

const getProductsSchema = z.object({
	page: z.number().int().min(1).default(1),
	limit: z.number().int().min(10).max(200).default(20),
	categoryId: z.string().optional(),
	search: z.string().optional(),
	includeInactive: z.boolean().optional().default(false),
});

const updateProductSchema = z.object({
	productId: z.string(),
	categoryId: z.string().optional(),
	name: z.string().min(1).max(200).trim().optional(),
	description: z.string().max(2000).trim().nullable().optional(),
	sku: z.string().max(100).trim().nullable().optional(),
	priceInCents: z.number().int().min(0).optional(),
	isActive: z.boolean().optional(),
});

const deleteProductSchema = z.object({
	productId: z.string(),
});

// ============================================================
// ROUTER
// ============================================================

export const productsRouter = createTRPCRouter({
	createProduct: facilityProcedure
		.input(createProductSchema)
		.mutation(async ({ ctx, input }) => {
			// Verify category belongs to the same club and is a leaf (no active children)
			const category = await ctx.db.productCategory.findUnique({
				where: { categoryId: input.categoryId },
				include: { _count: { select: { children: { where: { isActive: true } } } } },
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
						"Products must be assigned to leaf categories (categories with no subcategories).",
				});
			}

			const product = await ctx.db.product.create({
				data: {
					clubShortName: ctx.user.clubShortName,
					categoryId: input.categoryId,
					name: input.name,
					description: input.description,
					sku: input.sku,
					priceInCents: input.priceInCents,
					currency: input.currency,
					createdByUserId: ctx.user.userId,
				},
			});

			return product;
		}),

	getProducts: protectedProcedure
		.input(getProductsSchema)
		.query(async ({ ctx, input }) => {
			const user = await getCurrentUser(ctx);
			const { page, limit } = input;

			const whereClause = {
				clubShortName: user.clubShortName,
				...(input.includeInactive ? {} : { isActive: true }),
				...(input.categoryId && { categoryId: input.categoryId }),
				...(input.search && {
					OR: [
						{ name: { contains: input.search, mode: "insensitive" as const } },
						{ sku: { contains: input.search, mode: "insensitive" as const } },
					],
				}),
			};

			const [total, products] = await Promise.all([
				ctx.db.product.count({ where: whereClause }),
				ctx.db.product.findMany({
					where: whereClause,
					skip: (page - 1) * limit,
					take: limit,
					include: {
						category: {
							select: {
								categoryId: true,
								name: true,
								parentCategoryId: true,
								parent: { select: { name: true } },
							},
						},
						createdByUser: {
							select: {
								firstName: true,
								lastName: true,
							},
						},
						_count: {
							select: {
								calendarEvents: true,
								registrations: true,
							},
						},
					},
					orderBy: {
						createdAt: "desc",
					},
				}),
			]);

			return {
				products: products.map((p) => ({
					productId: p.productId,
					categoryId: p.categoryId,
					categoryName: p.category.parent
						? `${p.category.parent.name} > ${p.category.name}`
						: p.category.name,
					name: p.name,
					description: p.description,
					sku: p.sku,
					priceInCents: p.priceInCents,
					currency: p.currency,
					stripeProductId: p.stripeProductId,
					stripePriceId: p.stripePriceId,
					isActive: p.isActive,
					createdByUser: p.createdByUser,
					_count: p._count,
					createdAt: p.createdAt,
				})),
				pagination: {
					total,
					page,
					limit,
					pageCount: Math.ceil(total / limit),
				},
			};
		}),

	updateProduct: facilityProcedure
		.input(updateProductSchema)
		.mutation(async ({ ctx, input }) => {
			const { productId, ...data } = input;

			const existing = await ctx.db.product.findUnique({
				where: { productId },
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Product not found",
				});
			}

			if (
				ctx.user.clubShortName !== existing.clubShortName &&
				!isPlatformAdmin(ctx.user)
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only access your own club's products",
				});
			}

			// If changing category, verify it's a leaf in the same club
			if (data.categoryId) {
				const category = await ctx.db.productCategory.findUnique({
					where: { categoryId: data.categoryId },
					include: { _count: { select: { children: { where: { isActive: true } } } } },
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
						message: "Products must be assigned to leaf categories.",
					});
				}
			}

			const updated = await ctx.db.product.update({
				where: { productId },
				data,
			});

			return updated;
		}),

	deleteProduct: facilityProcedure
		.input(deleteProductSchema)
		.mutation(async ({ ctx, input }) => {
			const { productId } = input;

			const existing = await ctx.db.product.findUnique({
				where: { productId },
				include: {
					_count: {
						select: {
							calendarEvents: true,
							registrations: true,
						},
					},
				},
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Product not found",
				});
			}

			if (
				ctx.user.clubShortName !== existing.clubShortName &&
				!isPlatformAdmin(ctx.user)
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You can only access your own club's products",
				});
			}

			if (existing._count.calendarEvents > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Cannot delete product that is linked to calendar events. Try marking as inactive instead",
				});
			}

			if (existing._count.registrations > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Cannot delete product that has registrations. Try marking as inactive instead",
				});
			}

			await ctx.db.product.update({
				where: { productId },
				data: { isActive: false },
			});

			return { success: true };
		}),
});
