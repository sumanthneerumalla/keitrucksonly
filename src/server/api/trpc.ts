import { auth } from "@clerk/nextjs/server";
import { UserType } from "@prisma/client";
/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */
import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { loadCurrentUser } from "~/server/cache";
import { db } from "~/server/db";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
	return {
		db,
		auth: await auth(),
		// Per-request memo scratchpad. This object is rebuilt once per request, so
		// anything stored here is a request-scoped cache — no staleness, no
		// invalidation, no cross-user leakage. See ~/server/cache (requestCache).
		loaders: new Map<string, Promise<unknown>>(),
		...opts,
	};
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? error.cause.flatten() : null,
			},
		};
	},
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * Middleware to check if user is authenticated
 */
const isAuthed = t.middleware(({ next, ctx }) => {
	if (!ctx.auth.userId) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	return next({
		ctx: {
			auth: ctx.auth,
		},
	});
});

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path, ctx, input }) => {
	const start = Date.now();

	if (t._config.isDev) {
		// artificial delay in dev
		const waitMs = Math.floor(Math.random() * 400) + 100;
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}

	const result = await next();

	const end = Date.now();
	console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

	// Surface unexpected server-side failures so we have a post-mortem trail
	// when a redeploy wipes the container's logs (default json-file driver).
	// Skip user-facing TRPCError codes — those are valid client conditions
	// (validation, auth, missing rows), not bugs to debug.
	if (!result.ok) {
		const error = result.error;
		const isUserFacingError =
			error instanceof TRPCError &&
			[
				"BAD_REQUEST",
				"UNAUTHORIZED",
				"FORBIDDEN",
				"NOT_FOUND",
				"CONFLICT",
				"UNPROCESSABLE_CONTENT",
			].includes(error.code);
		if (!isUserFacingError) {
			const ctxAny = ctx as {
				user?: { userId?: string };
				auth?: { userId?: string | null };
			};
			const userId = ctxAny.user?.userId ?? ctxAny.auth?.userId ?? null;
			console.error(`[TRPC error] ${path}`, {
				userId,
				code: error instanceof TRPCError ? error.code : "UNKNOWN",
				message: error.message,
				cause: error.cause instanceof Error ? error.cause.message : undefined,
				input,
				stack: error.stack,
			});
		}
	}

	return result;
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Public (unauthenticated) procedure
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected procedure that requires authentication
 */
export const protectedProcedure = t.procedure
	.use(isAuthed)
	.use(timingMiddleware);

/**
 * Authenticated procedure that also resolves the local User row as `ctx.user`
 * (UNAUTHORIZED if the Clerk user has no User row). Use instead of
 * protectedProcedure whenever the handler needs the caller's User record —
 * replaces the per-procedure findUnique({ clerkUserId }) boilerplate.
 */
export const memberProcedure = t.procedure
	.use(isAuthed)
	.use(async ({ ctx, next }) => {
		const user = await loadCurrentUser(ctx);
		if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
		return next({ ctx: { ...ctx, user } });
	})
	.use(timingMiddleware);

/** Helper: fetch user and check role, throw if unauthorized */
async function requireRole(
	ctx: {
		db: typeof import("~/server/db").db;
		auth: { userId: string };
		loaders?: Map<string, Promise<unknown>>;
	},
	check: (userType: UserType) => boolean,
	message: string,
) {
	const user = await loadCurrentUser(ctx);
	if (!user || !check(user.userType)) {
		throw new TRPCError({ code: "FORBIDDEN", message });
	}
	return user;
}

/** Platform admin only — platform owner/developer */
export const adminProcedure = t.procedure
	.use(isAuthed)
	.use(async ({ ctx, next }) => {
		const user = await requireRole(
			ctx,
			(t) => t === UserType.PLATFORM_ADMIN,
			"Platform admin access required",
		);
		return next({ ctx: { ...ctx, user } });
	})
	.use(timingMiddleware);

/** Club admin or platform admin */
export const clubAdminProcedure = t.procedure
	.use(isAuthed)
	.use(async ({ ctx, next }) => {
		const user = await requireRole(
			ctx,
			(t) => t === UserType.CLUB_ADMIN || t === UserType.PLATFORM_ADMIN,
			"Club admin access required",
		);
		return next({ ctx: { ...ctx, user } });
	})
	.use(timingMiddleware);

/** Facility staff, club admin, or platform admin */
export const facilityProcedure = t.procedure
	.use(isAuthed)
	.use(async ({ ctx, next }) => {
		const user = await requireRole(
			ctx,
			(t) =>
				t === UserType.FACILITY ||
				t === UserType.CLUB_ADMIN ||
				t === UserType.PLATFORM_ADMIN,
			"Facility or admin access required",
		);
		return next({ ctx: { ...ctx, user } });
	})
	.use(timingMiddleware);

/** Coach only */
export const coachProcedure = t.procedure
	.use(isAuthed)
	.use(async ({ ctx, next }) => {
		const user = await requireRole(
			ctx,
			(t) => t === UserType.COACH,
			"Coach access required",
		);
		return next({ ctx: { ...ctx, user } });
	})
	.use(timingMiddleware);

/** Staff: facility, club admin, platform admin, or coach */
export const staffProcedure = t.procedure
	.use(isAuthed)
	.use(async ({ ctx, next }) => {
		const user = await requireRole(
			ctx,
			(t) =>
				t === UserType.FACILITY ||
				t === UserType.CLUB_ADMIN ||
				t === UserType.PLATFORM_ADMIN ||
				t === UserType.COACH,
			"Staff access required",
		);
		return next({ ctx: { ...ctx, user } });
	})
	.use(timingMiddleware);
