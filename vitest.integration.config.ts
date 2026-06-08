import { resolve } from "path";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for DB-coupled integration tests (`*.itest.ts`).
 *
 * Run via `npm run test:integration`, which docker-execs into the dev app
 * container (where the backend-network Postgres is reachable) and points
 * vitest at this config. The file is NOT baked into the container image —
 * the test:integration script `docker cp`s it in before invoking vitest, so
 * iteration on the config doesn't require an image rebuild.
 *
 * Why a separate config: the host's `vitest.config.ts` runs jsdom + sets up
 * client-side mocks (Next.js navigation, Clerk, tRPC client). Both are wrong
 * for server-side DB-coupled tests; they'd also block `~/server/db`'s
 * env-aware imports. Sequential file execution (no parallelism) keeps the
 * shared-DB cleanup simple — each test creates a fresh DropInSession and
 * deletes it on teardown.
 */
export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		include: ["src/**/*.itest.ts"],
		fileParallelism: false,
		sequence: { concurrent: false },
	},
	resolve: {
		alias: {
			"~": resolve(__dirname, "./src"),
		},
	},
});
