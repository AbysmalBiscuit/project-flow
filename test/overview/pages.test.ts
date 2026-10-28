import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { repo } from "../support/github.ts";
import { repoReadFromLists } from "../support/repo-read.ts";
import {
	embeddedForRoute,
	embeddedStored,
	githubFetch,
	githubTicket,
	readServedOverview,
} from "./_support.ts";

describe("page responses", () => {
	test("each page carries the stored data its API returns", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		let finish: (error?: unknown) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			finish = (error) => {
				if (error === undefined) {
					resolve();
					return;
				}
				reject(error);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: githubFetch(),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => {
						void (async () => {
							const base = line;
							const overview = await readServedOverview(base);
							const projectName = overview.projects[0]?.name ?? repo;
							const routes = [
								{ page: "/", api: "/api/overview" },
								{
									page: `/projects/${encodeURIComponent(projectName)}`,
									api: `/api/projects/${encodeURIComponent(projectName)}?view=all`,
								},
								{ page: "/needs-you", api: "/api/needs-you" },
								{ page: "/inbox", api: "/api/inbox" },
								{ page: "/settings", api: "/api/settings" },
							];
							for (const route of routes) {
								const api = await fetch(new URL(route.api, base));
								expect(api.status).toBe(200);
								const pageResponse = await fetch(new URL(route.page, base));
								expect(pageResponse.status).toBe(200);
								const html = await pageResponse.text();
								expect(embeddedForRoute(html, route.page)).toEqual(
									await api.json(),
								);
							}
							finish();
						})().catch((error: unknown) => finish(error));
					},
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			await checks;
		} finally {
			finish();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a ticket title that holds a script end cannot break the page", async () => {
		const hostile = `</script><script>window.__broken=1</script> & <img>`;
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		let finish: (error?: unknown) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			finish = (error) => {
				if (error === undefined) {
					resolve();
					return;
				}
				reject(error);
			};
		});
		const hostileFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/graphql") {
				const read = repoReadFromLists(input, init, {
					[repo]: [githubTicket(5, "open", null, hostile)],
				});
				if (read !== null) {
					return read;
				}
			}
			return githubFetch()(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: hostileFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => {
						void (async () => {
							const base = line;
							const overview = await readServedOverview(base);
							const titles = overview.projects.flatMap((project) =>
								project.tickets.map((item) => item.title),
							);
							expect(titles).toContain(hostile);
							const pageResponse = await fetch(new URL("/", base));
							expect(pageResponse.status).toBe(200);
							const html = await pageResponse.text();
							expect(html).not.toContain("</script><script>");
							expect(html).not.toContain("<img>");
							expect(embeddedForRoute(html, "/")).toEqual(overview);
							const projectName = overview.projects[0]?.name ?? repo;
							const projectPage = await fetch(
								new URL(`/projects/${encodeURIComponent(projectName)}`, base),
							);
							expect(projectPage.status).toBe(200);
							const projectHtml = await projectPage.text();
							expect(projectHtml).not.toContain("</script><script>");
							expect(embeddedStored(projectHtml)).toEqual(
								await (
									await fetch(
										new URL(
											`/api/projects/${encodeURIComponent(projectName)}?view=all`,
											base,
										),
									)
								).json(),
							);
							finish();
						})().catch((error: unknown) => finish(error));
					},
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			await checks;
		} finally {
			finish();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank, spaced or missing project page stays a page", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		let finish: (error?: unknown) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			finish = (error) => {
				if (error === undefined) {
					resolve();
					return;
				}
				reject(error);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: githubFetch(),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => {
						void (async () => {
							const base = line;
							await readServedOverview(base);
							for (const pagePath of [
								"/projects/%20",
								"/projects/missing",
								`/projects/${encodeURIComponent("  acme/widget  ")}`,
							]) {
								const pageResponse = await fetch(new URL(pagePath, base));
								expect(pageResponse.status).toBe(200);
								const html = await pageResponse.text();
								expect(html).toContain('id="root"');
								expect(html).not.toContain('id="project-flow-stored"');
							}
							const overviewPage = await fetch(new URL("/", base));
							expect(overviewPage.status).toBe(200);
							const overviewHtml = await overviewPage.text();
							expect(overviewHtml).toContain('id="root"');
							expect(embeddedForRoute(overviewHtml, "/")).toEqual(
								await readServedOverview(base),
							);
							const malformed = await fetch(new URL("/projects/%E0", base));
							expect(malformed.status).toBe(200);
							const malformedHtml = await malformed.text();
							expect(malformedHtml).toContain('id="root"');
							expect(malformedHtml).not.toContain('id="project-flow-stored"');
							const missing = await fetch(
								new URL("/api/projects/missing", base),
							);
							expect(missing.status).toBe(404);
							finish();
						})().catch((error: unknown) => finish(error));
					},
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			await checks;
		} finally {
			finish();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
