import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	RESERVED_TOP_LEVEL_SEGMENTS,
	matchClubShortUrlPathname,
} from "./clubLanding";

describe("matchClubShortUrlPathname", () => {
	it("rewrites a bare club short URL to /club/<short>", () => {
		expect(matchClubShortUrlPathname("/featherballer")).toEqual({
			shortname: "featherballer",
			rewritePath: "/club/featherballer",
		});
		// Trailing slash normalizes to the same result.
		expect(matchClubShortUrlPathname("/featherballer/")).toEqual({
			shortname: "featherballer",
			rewritePath: "/club/featherballer",
		});
	});

	it("rewrites the articles surfaces", () => {
		expect(matchClubShortUrlPathname("/cba/articles")).toEqual({
			shortname: "cba",
			rewritePath: "/club/cba/articles",
		});
		expect(matchClubShortUrlPathname("/cba/articles/hello-world")).toEqual({
			shortname: "cba",
			rewritePath: "/club/cba/articles/hello-world",
		});
		expect(matchClubShortUrlPathname("/cba/articles/tag/news")).toEqual({
			shortname: "cba",
			rewritePath: "/club/cba/articles/tag/news",
		});
		expect(matchClubShortUrlPathname("/cba/articles/rss.xml")).toEqual({
			shortname: "cba",
			rewritePath: "/club/cba/articles/rss.xml",
		});
	});

	it("rewrites the announcements feed", () => {
		expect(matchClubShortUrlPathname("/cba/announcements")).toEqual({
			shortname: "cba",
			rewritePath: "/club/cba/announcements",
		});
	});

	it("optimistically rewrites an unknown (not-yet-validated) shortname", () => {
		// The club may or may not exist — the /club/<short> page's
		// db.club.findUnique → notFound() is the source of truth, not this matcher.
		expect(matchClubShortUrlPathname("/brand-new-club")).toEqual({
			shortname: "brand-new-club",
			rewritePath: "/club/brand-new-club",
		});
	});

	it("never rewrites a reserved top-level app route", () => {
		for (const seg of RESERVED_TOP_LEVEL_SEGMENTS) {
			expect(matchClubShortUrlPathname(`/${seg}`)).toBeNull();
			// ...nor its deeper paths that share the short-URL shape.
			expect(matchClubShortUrlPathname(`/${seg}/articles`)).toBeNull();
		}
	});

	it("rejects non-slug segments (dotted asset/feed paths, uppercase)", () => {
		expect(matchClubShortUrlPathname("/robots.txt")).toBeNull();
		expect(matchClubShortUrlPathname("/sitemap.xml")).toBeNull();
		expect(matchClubShortUrlPathname("/Featherballer")).toBeNull();
		expect(matchClubShortUrlPathname("/-leading-hyphen")).toBeNull();
	});

	it("returns null for the root and for unrecognized deeper paths", () => {
		expect(matchClubShortUrlPathname("/")).toBeNull();
		// /<short>/dashboard is an authed app route by coincidence of prefix, not
		// a public club surface.
		expect(matchClubShortUrlPathname("/somewhere/dashboard")).toBeNull();
		expect(matchClubShortUrlPathname("/cba/articles/foo/bar")).toBeNull();
	});
});

describe("RESERVED_TOP_LEVEL_SEGMENTS stays in sync with the app routes", () => {
	it("reserves every (app) route directory", () => {
		const appDir = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../app/(app)",
		);
		const routeDirs = readdirSync(appDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			// Route groups "(x)" and private "_x" folders don't create URL segments.
			.filter(
				(entry) => !entry.name.startsWith("(") && !entry.name.startsWith("_"),
			)
			.map((entry) => entry.name);

		const missing = routeDirs.filter(
			(name) => !RESERVED_TOP_LEVEL_SEGMENTS.has(name),
		);

		// If this fails, a new top-level route was added — add its segment to
		// RESERVED_TOP_LEVEL_SEGMENTS or the optimistic club rewrite will shadow it.
		expect(missing).toEqual([]);
	});
});
