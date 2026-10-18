import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedDiscovery, tempConfig, testIo, urlOf } from "./support.ts";

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
		updated_at: "2026-10-18T12:00:00.000Z",
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

function emptyList(url: string): Response | null {
	if (url.includes("/pulls?") || url.includes("/branches?")) {
		return page([], null);
	}
	return null;
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
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
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
		if (url === "https://api.linear.app/graphql") {
			return new Response(JSON.stringify({ data: { viewer: { id: "lev" } } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return emptyList(url) ?? new Response("not recorded", { status: 404 });
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
		updatedAt: "2026-08-18T12:00:00.000Z",
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

function linearProjectBody(name: string, slugId: string): string {
	const node = { id: "project-1", name, slugId };
	return JSON.stringify({
		data: {
			bySlug: { nodes: [node] },
			byName: { nodes: [] },
		},
	});
}

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
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
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
			if (query.query?.includes("ProjectByPin")) {
				return new Response(
					linearProjectBody(linearProject, `${linearProject}-0d42ae5d46d0`),
					{ status: 200, headers: { "content-type": "application/json" } },
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
		return emptyList(url) ?? new Response("not recorded", { status: 404 });
	};
}

describe("GET /api/overview", () => {
	test("a GitHub list failure does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const failing: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
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

	test("a later poll drops a repo that is no longer pinned", async () => {
		const repoA = "acme/alpha";
		const repoB = "acme/beta";
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recordedFetch =
			(pinned: string): Fetch =>
			async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
					});
				}
				if (url === "https://api.linear.app/graphql") {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{ status: 200 },
					);
				}
				const list = `https://api.github.com/repos/${pinned}/issues?state=all&per_page=100&page=1`;
				if (url === list) {
					return page([ticket(1, "open", null)], null);
				}
				if (url.includes("/pulls?") || url.includes("/branches?")) {
					return page([], null);
				}
				return emptyList(url) ?? new Response("not recorded", { status: 404 });
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
						env: {
							GITHUB_TOKEN: "recorded-token",
							LINEAR_API_KEY: "recorded-linear-key",
						},
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
		const rejected: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response("unauthorized", { status: 401 });
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
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
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
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
				if (body.includes("ProjectByPin")) {
					return new Response(
						linearProjectBody(linearProject, `${linearProject}-0d42ae5d46d0`),
						{ status: 200, headers: { "content-type": "application/json" } },
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
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
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

	test("a Linear pin that matches no project stops startup and names the pin", async () => {
		const pin = "agent-docs-cleanup";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: pin }],
			}),
		);
		const unmatched: Fetch = async (input, init) => {
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
					JSON.stringify({
						data: { bySlug: { nodes: [] }, byName: { nodes: [] } },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response("not recorded", { status: 404 });
		};
		try {
			const result = await run(["--config", path], {
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: unmatched,
				readGhToken: async () => null,
				databasePath: ":memory:",
				waitForStop: Promise.resolve(),
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(pin);
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a Linear project lookup failure stops startup and names the pin", async () => {
		const pin = "widget-launch";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: pin }],
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
				return new Response("recorded failure", { status: 502 });
			}
			return new Response("not recorded", { status: 404 });
		};
		try {
			const result = await run(["--config", path], {
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: failing,
				readGhToken: async () => null,
				databasePath: ":memory:",
				waitForStop: Promise.resolve(),
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(pin);
			expect(result.stderr).toContain("HTTP 502");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a Linear list failure does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const failing: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
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
				if (body.includes("ProjectByPin")) {
					return new Response(
						linearProjectBody(linearProject, `${linearProject}-0d42ae5d46d0`),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return new Response("recorded failure", { status: 500 });
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
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

	test("a Linear card heading shows the Linear project name", async () => {
		const pin = "agent-docs-cleanup";
		const projectName = "Agent docs cleanup";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: pin }],
			}),
		);
		const named: Fetch = async (input, init) => {
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
				if (body.includes("ProjectByPin")) {
					return new Response(
						linearProjectBody(projectName, `${pin}-0d42ae5d46d0`),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return new Response(
					linearBody([linearIssue("1", "completed")], false, null),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: named,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.exitCode).toBe(0);
			const overview = (await checks) as {
				projects: { name: string; tracker: string }[];
			};
			expect(overview.projects[0]?.name).toBe(projectName);
			expect(JSON.stringify(overview)).not.toContain(pin);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
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
				{ project: "project-1", after: null },
				{ project: "project-1", after: "page-2" },
			]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a pull-only collaborator repo appears", async () => {
		const pullRepo = "acme/pull-only";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const pullOnly: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: pullRepo,
							owner: { login: "other" },
							permissions: { admin: false, push: false, pull: true },
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${pullRepo}/issues?`)) {
				return page([ticket(1, "open", null)], null);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: pullOnly,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: pullRepo,
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
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("finds a Linear project and a GitHub repo with no configuration entry", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const finding: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			requests.push(body === "" ? url : body);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repo,
							owner: { login: "lev" },
							permissions: { admin: true, push: true, pull: true },
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`
			) {
				return page(
					[ticket(1, "open", null), ticket(2, "closed", "completed")],
					null,
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("viewer { id }") && !body.includes("projects(")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (body.includes("projects(")) {
					return new Response(
						JSON.stringify({
							data: {
								viewer: { id: "lev" },
								projects: {
									nodes: [
										{
											id: "linear-project-1",
											name: "Widget launch",
											slugId: linearProject,
											updatedAt: "2026-08-18T12:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return new Response(
					linearBody(
						[linearIssue("1", "backlog"), linearIssue("2", "completed")],
						false,
						null,
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: finding,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						done: 1,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
					},
					{
						name: linearProject,
						tracker: "linear",
						done: 1,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
					},
				],
			});
			expect(requests.some((sent) => sent.includes("viewer { id }"))).toBe(
				true,
			);
			expect(requests.some((sent) => sent.includes("projects("))).toBe(true);
			expect(requests.some((sent) => sent.includes("/user/repos?"))).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a GitHub project on the second organization page appears", async () => {
		const orgProjectId = "PVT_org_page_2";
		const requests: { variables?: Record<string, unknown> }[] = [];
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const orgPage: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response("[]", {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number: 1,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: "acme/org-board" },
											},
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("OrgProjects")
			) {
				const parsed = JSON.parse(body) as {
					variables?: Record<string, unknown>;
				};
				requests.push(parsed);
				const cursor = parsed.variables?.orgProjectAfter;
				const nodes =
					cursor === "org-projects-2"
						? [
								{
									id: orgProjectId,
									number: 9,
									owner: { login: "acme" },
									title: "Org board",
									closed: false,
									updatedAt: "2026-08-18T12:00:00Z",
								},
							]
						: [];
				return new Response(
					JSON.stringify({
						data: {
							organization: {
								projectsV2: {
									nodes,
									pageInfo: {
										hasNextPage: cursor === null,
										endCursor: cursor === null ? "org-projects-2" : null,
									},
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [{ login: "acme" }],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: orgPage,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: "Org board",
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
					},
				],
			});
			expect(
				requests.some(
					(sent) => sent.variables?.orgProjectAfter === "org-projects-2",
				),
			).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear project where the viewer is a member appears", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const member: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			requests.push(body === "" ? url : body);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null && url !== "https://api.linear.app/graphql") {
				return discovered;
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { viewer?: string };
				};
				if (parsed.variables?.viewer !== "lev") {
					return new Response("missing viewer", { status: 400 });
				}
				return new Response(
					JSON.stringify({
						data: {
							projects: {
								nodes: [
									{
										id: "linear-member",
										name: "Member launch",
										slugId: "member-launch",
										updatedAt: "2026-08-18T12:00:00.000Z",
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql" && body.includes("viewer")) {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							issues: {
								nodes: [linearIssue("1", "backlog")],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: member,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: "member-launch",
						tracker: "linear",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
					},
				],
			});
			const listed = requests.find((sent) => sent.includes("projects("));
			expect(listed).toContain("lead: { id: { eq: $viewer } }");
			expect(listed).toContain("members: { some: { id: { eq: $viewer } } }");
			expect(listed).not.toContain("members { nodes");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("two GitHub projects with the same title both appear", async () => {
		const sameTitle = "acme/widget";
		const firstId = "PVT_same_1";
		const secondId = "PVT_same_2";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const sameName: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: sameTitle,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${sameTitle}/issues?`)) {
				return page([ticket(1, "open", null)], null);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ViewerProjects")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: firstId,
											number: 1,
											owner: { login: "lev" },
											title: sameTitle,
											closed: false,
											updatedAt: "2026-08-18T12:00:00Z",
										},
										{
											id: secondId,
											number: 2,
											owner: { login: "lev" },
											title: sameTitle,
											closed: false,
											updatedAt: "2026-08-18T12:00:00Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				const variables = JSON.parse(body) as { variables?: { id?: string } };
				const number = variables.variables?.id === firstId ? 11 : 12;
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: "acme/other" },
											},
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("projects(")) {
					return new Response(
						JSON.stringify({
							data: {
								viewer: { id: "lev" },
								projects: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						}),
						{ status: 200 },
					);
				}
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: sameName,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const overview = (await checks) as {
				projects: { name: string; tracker: string; backlog: number }[];
			};
			const titled = overview.projects.filter(
				(project) => project.name === sameTitle,
			);
			expect(titled).toHaveLength(3);
			expect(titled.filter((project) => project.tracker === "github")).toEqual(
				titled,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a ticket on a repo and its GitHub project counts once under the project", async () => {
		const projectId = "PVT_widget";
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const shared = ticket(9, "open", null);
		const repoOnly = ticket(4, "open", null);
		const both: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			requests.push(body === "" ? url : body);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repo,
							owner: { login: "lev" },
							permissions: { push: true },
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`
			) {
				return page([shared, repoOnly], null);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number: 9,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: repo },
											},
										},
										{
											content: {
												__typename: "Issue",
												number: 8,
												state: "CLOSED",
												stateReason: "COMPLETED",
												repository: { nameWithOwner: repo },
											},
										},
										{
											content: {
												__typename: "PullRequest",
												number: 3,
												state: "OPEN",
												repository: { nameWithOwner: repo },
											},
										},
										{ content: null },
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: projectId,
											number: 3,
											owner: { login: "acme" },
											title: "Widget board",
											closed: false,
											updatedAt: "2026-08-18T12:00:00Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("projects(")) {
					return new Response(
						JSON.stringify({
							data: {
								viewer: { id: "lev" },
								projects: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						}),
						{ status: 200 },
					);
				}
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
					},
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: both,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: "Widget board",
						tracker: "github",
						done: 1,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
					},
					{
						name: repo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
					},
				],
			});
			expect(requests.some((sent) => sent.includes(`node(id: $id)`))).toBe(
				true,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a pinned GitHub project shows and a hidden GitHub project never shows", async () => {
		const pinnedId = "PVT_pinned";
		const hiddenId = "PVT_hidden";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				hidden: [{ tracker: "github", owner: "acme", project: 8 }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const board: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response("[]", {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ViewerProjects")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: hiddenId,
											number: 8,
											owner: { login: "acme" },
											title: "Hidden board",
											closed: false,
											updatedAt: "2026-08-18T12:00:00Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				const variables = JSON.parse(body) as { variables?: { id?: string } };
				const id = variables.variables?.id;
				const number = id === pinnedId ? 1 : 2;
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: "acme/other" },
											},
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.github.com/graphql" && body.includes("$owner")) {
				const variables = JSON.parse(body) as {
					variables?: { owner?: string; number?: number };
				};
				const number = variables.variables?.number;
				const id = number === 7 ? pinnedId : hiddenId;
				const title = number === 7 ? "Pinned board" : "Hidden board";
				return new Response(
					JSON.stringify({
						data: {
							repositoryOwner: {
								projectV2: {
									id,
									number,
									title,
									closed: false,
									updatedAt: "2026-01-01T12:00:00Z",
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: "Pinned board",
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
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a quiet GitHub project releases its tickets to the repo", async () => {
		const quietId = "PVT_quiet";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const quietBoard: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repo,
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${repo}/issues?`)) {
				return page([ticket(9, "open", null)], null);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ViewerProjects")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: quietId,
											number: 4,
											owner: { login: "acme" },
											title: "Quiet board",
											closed: false,
											updatedAt: "2026-01-01T12:00:00Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number: 9,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: repo },
											},
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: quietBoard,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: repo,
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
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a hidden GitHub project releases its tickets to the repo", async () => {
		const hiddenId = "PVT_hidden_claim";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				hidden: [{ tracker: "github", owner: "acme", project: 8 }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const hiddenBoard: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repo,
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${repo}/issues?`)) {
				return page([ticket(9, "open", null)], null);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ViewerProjects")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: hiddenId,
											number: 8,
											owner: { login: "acme" },
											title: "Hidden board",
											closed: false,
											updatedAt: "2026-08-18T12:00:00Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number: 9,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: repo },
											},
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: hiddenBoard,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: repo,
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
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a closed GitHub project releases its tickets to the repo", async () => {
		const closedId = "PVT_closed";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const closedBoard: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repo,
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${repo}/issues?`)) {
				return page([ticket(9, "open", null)], null);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ViewerProjects")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: closedId,
											number: 5,
											owner: { login: "acme" },
											title: "Closed board",
											closed: true,
											updatedAt: "2026-08-18T12:00:00Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number: 9,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: repo },
											},
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: closedBoard,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: repo,
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
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a quiet project is hidden, a pinned project always shows, and a hidden project never shows", async () => {
		const quietRepo = "acme/quiet";
		const activeRepo = "acme/active";
		const pinnedRepo = "acme/pinned-quiet";
		const hiddenRepo = "acme/hidden-active";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: pinnedRepo }],
				hidden: [{ tracker: "github", repo: hiddenRepo }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const now = new Date("2026-08-18T12:00:00.000Z");
		const recent = "2026-08-01T12:00:00.000Z";
		const stale = "2026-01-01T12:00:00.000Z";
		const visibility: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: quietRepo,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: stale,
						},
						{
							full_name: activeRepo,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: recent,
						},
						{
							full_name: pinnedRepo,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: stale,
						},
						{
							full_name: hiddenRepo,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: recent,
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			const match = url.match(
				/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?/,
			);
			if (match?.[1] !== undefined) {
				const open = match[1] === activeRepo || match[1] === hiddenRepo;
				return page(
					[
						{
							...ticket(1, open ? "open" : "closed", open ? null : "completed"),
							updated_at: match[1] === quietRepo ? stale : recent,
						},
					],
					null,
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("projects(")) {
					return new Response(
						JSON.stringify({
							data: {
								viewer: { id: "lev" },
								projects: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						}),
						{ status: 200 },
					);
				}
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
					},
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: visibility,
					readGhToken: async () => null,
					databasePath,
					now: () => now,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const overview = (await checks) as {
				projects: { name: string }[];
			};
			expect(overview.projects.map((project) => project.name).sort()).toEqual([
				activeRepo,
				pinnedRepo,
			]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty configuration with no membership shows no projects", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({}));
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: githubFetch([]),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({ projects: [] });
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank configuration file shows no projects", async () => {
		const { path, cleanup } = await tempConfig("   \n");
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const result = await run(["--config", `  ${path}  `], {
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: githubFetch([]),
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				waitForStop: Promise.resolve(),
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("not JSON");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a pinned quiet Linear project shows and a hidden active project does not", async () => {
		const pinnedLinear = "quiet-linear";
		const hiddenRepo = "acme/hidden-live";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: pinnedLinear }],
				hidden: [{ tracker: "github", repo: hiddenRepo }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const edge: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: hiddenRepo,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200 },
				);
			}
			if (url.includes("/issues?")) {
				return page(
					[
						{
							number: 1,
							title: "Open",
							state: "open",
							state_reason: null,
							updated_at: "2026-10-18T12:00:00.000Z",
						},
					],
					null,
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("ProjectIssues")
			) {
				return new Response(linearBody([], false, null), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: edge,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({
				projects: [
					{
						name: pinnedLinear,
						tracker: "linear",
						done: 0,
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

	test("a project with no open tickets stays off the overview", async () => {
		const closedRepo = "acme/closed";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const closedOnly: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: closedRepo,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes("/issues?")) {
				return page(
					[
						{
							number: 1,
							title: "Done",
							state: "closed",
							state_reason: "completed",
							updated_at: "2026-10-18T12:00:00.000Z",
						},
					],
					null,
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
					},
				);
			}
			return emptyList(url) ?? new Response("not recorded", { status: 404 });
		};
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
				{
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: closedOnly,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual({ projects: [] });
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
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
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
			expect(requests.some((url) => url.includes("/issues?"))).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
