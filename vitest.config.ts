import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		globals: true,
		// *.integration.test.ts files hit a real Postgres (the dev DB) and
		// must run inside the dev container where the backend network is
		// reachable. They're excluded from the default host-side `npm test`
		// run and triggered separately via `npm run test:integration`
		// (which execs into shuttlementor-app-dev). The pattern keeps the
		// fast host run green for everyone — including CI — without losing
		// coverage on the DB-coupled paths.
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.next/**",
			"**/*.integration.test.ts",
		],
	},
	resolve: {
		alias: {
			"~": resolve(__dirname, "./src"),
		},
	},
});
