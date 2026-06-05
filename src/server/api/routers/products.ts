import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	facilityProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import {
	assertFound,
	assertSameClub,
	getCurrentUser,
} from "~/server/utils/utils";

// ============================================================
// HELPERS
// ============================================================

/**
 * Image storage bridge (public-shop.md D2 / I2). `ProfileImageUploader`
 * returns a `data:image/png;base64,...` string; our schema stores raw bytes
 * + MIME separately. Splits the data URL on the first comma.
 */
function parseDataUrl(dataUrl: string): {
	bytes: Uint8Array<ArrayBuffer>;
	mime: string;
} {
	const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
	if (!match) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid image data URL",
		});
	}
	const buf = Buffer.from(match[2]!, "base64");
	// Copy into a fresh Uint8Array<ArrayBuffer> so Prisma's `Bytes` typing accepts it.
	const ab = new ArrayBuffer(buf.byteLength);
	const bytes = new Uint8Array(ab);
	bytes.set(buf);
	return { mime: match[1]!, bytes };
}

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
	// Public shop fields (decisions #2 + #5).
	isPubliclyListed: z.boolean().optional(),
	publicDescription: z.string().max(2000).optional().nullable(),
	publicImageDataUrl: z.string().optional().nullable(),
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
	// Public shop fields (decisions #2 + #5).
	isPubliclyListed: z.boolean().optional(),
	publicDescription: z.string().max(2000).optional().nullable(),
	publicImageDataUrl: z.string().optional().nullable(),
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

			// Public shop image: parse data URL → bytes + mime (D2).
			let publicImageData: Uint8Array<ArrayBuffer> | null | undefined;
			let publicImageType: string | null | undefined;
			if (typeof input.publicImageDataUrl === "string") {
				const parsed = parseDataUrl(input.publicImageDataUrl);
				publicImageData = parsed.bytes;
				publicImageType = parsed.mime;
			} else if (input.publicImageDataUrl === null) {
				publicImageData = null;
				publicImageType = null;
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
					isPubliclyListed: input.isPubliclyListed ?? false,
					publicDescription: input.publicDescription ?? null,
					...(publicImageData !== undefined ? { publicImageData } : {}),
					...(publicImageType !== undefined ? { publicImageType } : {}),
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
			const { productId, publicImageDataUrl, ...rest } = input;

			const existing = await ctx.db.product.findUnique({
				where: { productId },
			});

			assertFound(existing, "Product not found");
			assertSameClub(ctx.user, existing.clubShortName, {
				message: "You can only access your own club's products",
			});

			// If changing category, verify it's a leaf in the same club
			if (rest.categoryId) {
				const category = await ctx.db.productCategory.findUnique({
					where: { categoryId: rest.categoryId },
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

			// Public shop image: parse data URL → bytes + mime, or clear both
			// columns when explicitly null (D2 — image storage bridge).
			const data: Record<string, unknown> = { ...rest };
			if (typeof publicImageDataUrl === "string") {
				const parsed = parseDataUrl(publicImageDataUrl);
				data.publicImageData = parsed.bytes;
				data.publicImageType = parsed.mime;
			} else if (publicImageDataUrl === null) {
				data.publicImageData = null;
				data.publicImageType = null;
			}

			// I3 save-handler guard: archiving (isActive=false) auto-unlists
			// from the public shop. Prevents the "archived but listed"
			// inconsistency (decision #22).
			if (data.isActive === false) {
				data.isPubliclyListed = false;
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

			assertFound(existing, "Product not found");
			assertSameClub(ctx.user, existing.clubShortName, {
				message: "You can only access your own club's products",
			});

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