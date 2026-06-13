import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { socialLinksSchema } from "~/lib/clubProfile";
import { clubAdminProcedure, createTRPCRouter } from "~/server/api/trpc";
import { revalidateClub } from "~/server/revalidateClub";

/**
 * Phase 16 Step 2 — club-level public branding (landing page identity).
 * Gated to club admins: brand identity is club-wide, so facility staff and
 * coaches cannot change it. Facility-level fields (hours, address, blurb)
 * stay on calendar.updateFacility with its existing facility-staff gate.
 */

const updateBrandingSchema = z.object({
	tagline: z.string().trim().max(200).nullable(),
	description: z.string().trim().max(5000).nullable(),
	// Empty string from a cleared input means "remove the link".
	websiteUrl: z
		.union([z.string().trim().url().max(500), z.literal(""), z.null()])
		.transform((v) => (v ? v : null)),
	socialLinks: socialLinksSchema.nullable(),
	logoImageId: z.string().nullable(),
	heroImageId: z.string().nullable(),
	canonicalDomain: z
		.union([z.string().trim().url().max(255), z.literal(""), z.null()])
		.transform((v) => (v ? v : null)),
});

export const clubSettingsRouter = createTRPCRouter({
	getBranding: clubAdminProcedure.query(async ({ ctx }) => {
		const club = await ctx.db.club.findUnique({
			where: { clubShortName: ctx.user.clubShortName },
			select: {
				clubShortName: true,
				clubName: true,
				tagline: true,
				description: true,
				websiteUrl: true,
				socialLinks: true,
				logoImageId: true,
				heroImageId: true,
				canonicalDomain: true,
			},
		});
		if (!club) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Club not found" });
		}
		return club;
	}),

	updateBranding: clubAdminProcedure
		.input(updateBrandingSchema)
		.mutation(async ({ ctx, input }) => {
			// Referenced images must exist (FK would also catch this, but a typed
			// error beats a P2003).
			const imageIds = [input.logoImageId, input.heroImageId].filter(
				(id): id is string => id !== null,
			);
			if (imageIds.length > 0) {
				const found = await ctx.db.contentImage.count({
					where: { id: { in: imageIds } },
				});
				if (found !== new Set(imageIds).size) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Referenced image does not exist",
					});
				}
			}

			const updated = await ctx.db.club.update({
				where: { clubShortName: ctx.user.clubShortName },
				data: {
					tagline: input.tagline,
					description: input.description,
					websiteUrl: input.websiteUrl,
					// Prisma Json null semantics: DbNull clears the column.
					socialLinks:
						input.socialLinks === null
							? { set: null }
							: (input.socialLinks ?? undefined),
					logoImageId: input.logoImageId,
					heroImageId: input.heroImageId,
					canonicalDomain: input.canonicalDomain,
				},
				select: { clubShortName: true },
			});

			revalidateClub(updated.clubShortName);
			return { ok: true };
		}),
});
