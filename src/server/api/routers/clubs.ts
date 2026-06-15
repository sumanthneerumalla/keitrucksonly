import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/**
 * Phase 15 Stage 2 — clubs router.
 *
 * Minimal surface for admin UI dropdowns (scope picker). Only exposes a
 * lightweight list of clubs (shortname + display name) — no member data.
 * Public-procedure because the data is non-sensitive (clubs are listed in
 * public URLs anyway via `/<clubShort>/articles`).
 */
export const clubsRouter = createTRPCRouter({
	list: publicProcedure.query(async ({ ctx }) => {
		return ctx.db.club.findMany({
			select: { clubShortName: true, clubName: true },
			orderBy: { clubName: "asc" },
		});
	}),

	/**
	 * Phase 16 — public branding for club landing-page chrome (navbar + footer).
	 * Public because logged-out visitors render the club-branded chrome. Returns
	 * only non-sensitive branding + the club's ACTIVE facilities' NAP/hours
	 * (local-SEO signal). Throws NOT_FOUND when the club does not exist.
	 */
	getPublicBranding: publicProcedure
		.input(z.object({ clubShortName: z.string() }))
		.query(async ({ ctx, input }) => {
			const club = await ctx.db.club.findUnique({
				where: { clubShortName: input.clubShortName },
				select: {
					clubShortName: true,
					clubName: true,
					tagline: true,
					description: true,
					websiteUrl: true,
					socialLinks: true,
					logoImageId: true,
					canonicalDomain: true,
					facilities: {
						where: { isActive: true },
						orderBy: { position: "asc" },
						select: {
							facilityId: true,
							name: true,
							streetAddress: true,
							city: true,
							state: true,
							zipCode: true,
							phone: true,
							email: true,
							operatingHours: true,
						},
					},
				},
			});

			if (!club) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Club "${input.clubShortName}" not found`,
				});
			}

			const { facilities, ...clubFields } = club;
			return { club: clubFields, facilities };
		}),
});
