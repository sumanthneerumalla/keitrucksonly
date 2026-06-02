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
});
