import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		DATABASE_URL: z.string().url(),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		RESEND_API_KEY: z.string().optional(),
		RESEND_FROM_EMAIL: z.string().optional(),
		// Phase 12a — Stripe Connect. All optional so the app boots without
		// Stripe configured; payment surfaces lazy-fail when called (see
		// `src/server/services/payments/stripe.ts`).
		STRIPE_SECRET_KEY: z.string().min(1).optional(),
		STRIPE_WEBHOOK_SECRET_PLATFORM: z.string().min(1).optional(),
		STRIPE_WEBHOOK_SECRET_CONNECT: z.string().min(1).optional(),
		STRIPE_LIVEMODE: z.enum(["true", "false"]).default("false"),
		STRIPE_PLATFORM_ACCOUNT_NAME: z.string().min(1).optional(),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		// Phase 12a — Stripe.js publishable key, surfaced by the Embedded
		// Checkout page (Stream 7). Optional so the app boots without Stripe.
		NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		DATABASE_URL: process.env.DATABASE_URL,
		NODE_ENV: process.env.NODE_ENV,
		RESEND_API_KEY: process.env.RESEND_API_KEY,
		RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
		STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
		STRIPE_WEBHOOK_SECRET_PLATFORM: process.env.STRIPE_WEBHOOK_SECRET_PLATFORM,
		STRIPE_WEBHOOK_SECRET_CONNECT: process.env.STRIPE_WEBHOOK_SECRET_CONNECT,
		STRIPE_LIVEMODE: process.env.STRIPE_LIVEMODE,
		STRIPE_PLATFORM_ACCOUNT_NAME: process.env.STRIPE_PLATFORM_ACCOUNT_NAME,
		NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
			process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
