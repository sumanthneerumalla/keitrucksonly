import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		globals: true,
		// *.itest.ts files are DB-coupled integration tests that hit a real
		// Postgres (the dev DB). They must run inside the dev container where
		// the backend network is reachable. They use the `.itest.ts` extension
		// (not `.test.ts`) so vitest's default include glob doesn't pick them
		// up on the host side. Trigger them via `npm run test:integration`
		// (which execs into shuttlementor-app-dev and passes the file path
		// explicitly).
	},
	resolve: {
		alias: {
			"~": resolve(__dirname, "./src"),
		},
	},
});
