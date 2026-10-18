import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo, urlOf } from "./support.ts";

const repo = "acme/widget";

function ticket(
	number: number,
	state: "open" | "closed",
	stateReason: string | null,
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: stateReason,
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

function pullRequest(number: number): Record<string, unknown> {
	return {
		...ticket(number, "closed", "completed"),
		pull_request: {
			url: `https://api.github.com/repos/${repo}/pulls/${number}`,
		},
	};
}

function page(items: Record<string, unknown>[], next: string | null): Response {
	const headers = new Headers({ "content-type": "application/json" });
	if (next !== null) {
		headers.set("link", `<${next}>; rel="next"`);
	}
	return new Response(JSON.stringify(items), { status: 200, headers });
}

const recorded = [
	ticket(1, "closed", "completed"),
	ticket(2, "closed", "not_planned"),
	ticket(3, "closed", "duplicate"),
	ticket(4, "closed", null),
	ticket(5, "open", null),
	ticket(6, "open", null),
	pullRequest(7),
];

function githubFetch(requests: string[] = []): Fetch {
	return async (input) => {
		const url = urlOf(input);
		requests.push(url);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const first = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
		const second = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=2`;
		if (url === first) {
			return page(recorded.slice(0, 4), second);
		}
		if (url === second) {
			return page(recorded.slice(4), null);
		}
		if (url.includes("/pulls?") || url.includes("/branches?")) {
			return page([], null);
		}
		return new Response("not recorded", { status: 404 });
	};
}

async function assertCard(base: string): Promise<void> {
	const response = await fetch(new URL("/api/overview", base));
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		projects: [
			{
				name: repo,
				tracker: "github",
				done: 2,
				dropped: 2,
				backlog: 2,
				inProgress: 0,
				unlinkedPrs: [],
			},
		],
	});
	const pageResponse = await fetch(new URL("/", base));
	expect(pageResponse.status).toBe(200);
	expect(pageResponse.headers.get("content-type")).toContain("text/html");
	const html = await pageResponse.text();
	expect(html).toContain('<div id="root"></div>');
	expect(html).not.toContain(repo);
	expect(html).not.toContain("Done ");
	expect(html).not.toContain("Dropped ");
	expect(html).not.toContain("Backlog ");
}

const linearProject = "widget-launch";

function linearIssue(
	id: string,
	stateType: "completed" | "canceled" | "duplicate" | "backlog" | "started",
): Record<string, unknown> {
	return {
		id,
		identifier: `WID-${id}`,
		title: `Linear ticket ${id}`,
		state: { type: stateType },
	};
}

const linearRecorded = [
	linearIssue("1", "completed"),
	linearIssue("2", "canceled"),
	linearIssue("3", "duplicate"),
	linearIssue("4", "completed"),
	linearIssue("5", "backlog"),
	linearIssue("6", "started"),
];

function linearBody(
	nodes: Record<string, unknown>[],
	hasNextPage: boolean,
	endCursor: string | null,
): string {
	return JSON.stringify({
		data: {
			issues: {
				nodes,
				pageInfo: { hasNextPage, endCursor },
			},
		},
	});
}

function linearFetch(requests: string[]): Fetch {
	return async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const list = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
		if (url === list) {
			return page(recorded, null);
		}
		if (url.includes("/pulls?") || url.includes("/branches?")) {
			return page([], null);
		}
		if (url === "https://api.linear.app/graphql") {
			const body =
				typeof init?.body === "string" ? init.body : JSON.stringify(init?.body);
			const query = JSON.parse(body) as {
				query?: string;
				variables?: { after?: string | null };
			};
			if (query.query?.includes("viewer")) {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			requests.push(body);
			const after = query.variables?.after;
			if (after === undefined || after === null) {
				return new Response(
					linearBody(linearRecorded.slice(0, 4), true, "page-2"),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (after === "page-2") {
				return new Response(linearBody(linearRecorded.slice(4), false, null), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
		}
		return new Response("not recorded", { status: 404 });
	};
}

describe("GET /api/overview", () => {
	test("a GitHub list failure does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const failing: Fetch = async (input) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			return new Response("recorded failure", { status: 500 });
		};
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: failing,
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a later poll drops a repo that is no longer pinned", async () => {
		const repoA = "acme/alpha";
		const repoB = "acme/beta";
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recordedFetch =
			(pinned: string): Fetch =>
			async (input) => {
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
					});
				}
				const list = `https://api.github.com/repos/${pinned}/issues?state=all&per_page=100&page=1`;
				if (url === list) {
					return page([ticket(1, "open", null)], null);
				}
				if (url.includes("/pulls?") || url.includes("/branches?")) {
					return page([], null);
				}
				return new Response("not recorded", { status: 404 });
			};
		const serve = async (pinned: string): Promise<unknown> => {
			const { path, cleanup } = await tempConfig(
				JSON.stringify({
					pinned: [{ tracker: "github", repo: pinned }],
				}),
			);
			let startChecks: (base: string) => void = () => {};
			const checks = new Promise<unknown>((resolve, reject) => {
				startChecks = (base: string) => {
					fetch(new URL("/api/overview", base))
						.then(async (response) => {
							expect(response.status).toBe(200);
							resolve(await response.json());
						})
						.catch(reject);
				};
			});
			try {
				const result = await run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo({
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: recordedFetch(pinned),
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => startChecks(line),
						waitForStop: checks.then(() => undefined),
					}),
				);
				expect(result.exitCode).toBe(0);
				expect(result.listened).toBe(true);
				return await checks;
			} finally {
				await cleanup();
			}
		};
		try {
			const first = await serve(repoA);
			expect(first).toEqual({
				projects: [
					{
						name: repoA,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
					},
				],
			});
			const second = await serve(repoB);
			expect(second).toEqual({
				projects: [
					{
						name: repoB,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
					},
				],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a missing Linear key does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token", LINEAR_API_KEY: "   " },
					fetch: linearFetch([]),
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("LINEAR_API_KEY");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a blank Linear project slug names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "   " }],
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: linearFetch([]),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pinned.0.project");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a rejected Linear key does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const rejected: Fetch = async (input) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response("unauthorized", { status: 401 });
			}
			return new Response("not recorded", { status: 404 });
		};
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "rejected-key",
					},
					fetch: rejected,
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("LINEAR_API_KEY");
			expect(result.stderr).toContain("401");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("an unknown Linear state type does not count as a ticket", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const unknown: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("viewer")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{ status: 200 },
					);
				}
				return new Response(
					linearBody(
						[
							linearIssue("1", "completed"),
							{ id: "9", state: { type: "archived-mystery" } },
							{ id: "10", state: null },
						],
						false,
						null,
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response("not recorded", { status: 404 });
		};
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => resolve(await response.json()))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: unknown,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: linearProject,
						tracker: "linear",
						done: 1,
						dropped: 0,
						backlog: 0,
						inProgress: 0,
						unlinkedPrs: [],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear list failure does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const failing: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("viewer")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{ status: 200 },
					);
				}
				return new Response("recorded failure", { status: 500 });
			}
			return new Response("not recorded", { status: 404 });
		};
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: failing,
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("counts done, dropped and backlog from recorded Linear tickets", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo },
					{ tracker: "linear", project: linearProject },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						expect(await response.json()).toEqual({
							projects: [
								{
									name: repo,
									tracker: "github",
									done: 2,
									dropped: 2,
									backlog: 2,
									inProgress: 0,
									unlinkedPrs: [],
								},
								{
									name: linearProject,
									tracker: "linear",
									done: 2,
									dropped: 2,
									backlog: 2,
									inProgress: 0,
									unlinkedPrs: [],
								},
							],
						});
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: linearFetch(requests),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(requests.length).toBeGreaterThan(0);
			const sent = requests.map(
				(body) => JSON.parse(body) as { query: string; variables: unknown },
			);
			expect(sent.every((call) => call.query.includes("state"))).toBe(true);
			expect(sent.map((call) => call.variables)).toEqual([
				{ project: linearProject, after: null },
				{ project: linearProject, after: "page-2" },
			]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("counts done, dropped and backlog from recorded GitHub tickets", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "missing", "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				assertCard(base).then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: githubFetch(requests),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await Bun.file(databasePath).exists()).toBe(true);
			expect(requests.some((url) => url.includes("linear.app"))).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
