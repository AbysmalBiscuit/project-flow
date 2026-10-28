import { describe, expect, test } from "bun:test";

import { githubFetch, githubRepo, withApp } from "../project-harness.ts";

describe("GET /api/projects/:name", () => {
	test("a missing project is not found, and a blank name is not found", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const missing = await fetch(new URL("/api/projects/missing", base));
				expect(missing.status).toBe(404);
				const blank = await fetch(new URL("/api/projects/%20", base));
				expect(blank.status).toBe(404);
				const spaced = await fetch(
					new URL(`/api/projects/${encodeURIComponent("acme/widget  ")}`, base),
				);
				expect(spaced.status).toBe(404);
				const percent = await fetch(
					new URL(`/api/projects/${encodeURIComponent("100%")}`, base),
				);
				expect(percent.status).toBe(404);
				const pageResponse = await fetch(
					new URL(`/projects/${encodeURIComponent(githubRepo)}`, base),
				);
				expect(pageResponse.status).toBe(200);
				const html = await pageResponse.text();
				expect(html).toContain('id="root"');
				expect(html).not.toContain("Feature map");
			},
		);
	});
});
