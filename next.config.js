/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
	// Allow the dev server to accept requests from the Caddy reverse proxy domain.
	// Without this, Next.js 15.2.2+ warns on cross-origin /_next/* requests,
	// and Next.js 16 will block them by default.
	allowedDevOrigins: [
		"www.dev.shuttlementor.com",
		"dev.shuttlementor.com",
		"www.dev.facilitypresence.com",
		"dev.facilitypresence.com",
	],
	// Phase 15: isomorphic-dompurify wraps jsdom, which expects relative CSS paths
	// (`browser/default-stylesheet.css`) that don't survive Next.js' default server
	// bundling. Listing the package as external lets it resolve normally from
	// node_modules at runtime. Without this, `next build` fails to collect page
	// data for any route that imports `DOMPurify.sanitize` server-side (the
	// /articles/[slug] and /club/[clubShortName]/articles/[slug] pages).
	serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
	// Ignore TypeScript errors during build when NEXT_IGNORE_TYPE_ERRORS is set
	typescript: {
		// !! WARN !!
		// Dangerously allow production builds to successfully complete even if
		// your project has type errors.
		// commented out for now
		// ignoreBuildErrors: process.env.NEXT_IGNORE_TYPE_ERRORS === '1',
	},
};

export default config;
