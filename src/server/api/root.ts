import { billingRouter } from "~/server/api/routers/billing";
import { calendarRouter } from "~/server/api/routers/calendar";
import { categoriesRouter } from "~/server/api/routers/categories";
import { checkinRouter } from "~/server/api/routers/checkin";
import { coachesRouter } from "~/server/api/routers/coaches";
import { coachingNotesRouter } from "~/server/api/routers/coachingNotes";
import { packagesRouter } from "~/server/api/routers/packages";
import { postRouter } from "~/server/api/routers/post";
import { productsRouter } from "~/server/api/routers/products";
import { rentalsRouter } from "~/server/api/routers/rentals";
import { shopRouter } from "~/server/api/routers/shop";
import { userRouter } from "~/server/api/routers/user";
import { videoCollectionRouter } from "~/server/api/routers/videoCollection";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
	post: postRouter,
	user: userRouter,
	videoCollection: videoCollectionRouter,
	coaches: coachesRouter,
	coachingNotes: coachingNotesRouter,
	calendar: calendarRouter,
	categories: categoriesRouter,
	checkin: checkinRouter,
	packages: packagesRouter,
	products: productsRouter,
	rentals: rentalsRouter,
	shop: shopRouter,
	billing: billingRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
