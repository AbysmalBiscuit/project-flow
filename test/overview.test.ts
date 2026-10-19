import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Overview, ProjectCounts } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { readGhAuthToken, run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

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

function page(
	items: Record<string, unknown>[],
	next: string | null,
	extra?: Record<string, string>,
): Response {
	const headers = new Headers({ "content-type": "application/json" });
	if (next !== null) {
		headers.set("link", `<${next}>; rel="next"`);
	}
	for (const [name, value] of Object.entries(extra ?? {})) {
		headers.set(name, value);
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
		if (url.includes("/check-runs")) {
			return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
		}
		if (
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			/\/pulls\/\d+$/.test(url)
		) {
			return page([], null);
		}
		if (url === "https://api.github.com/graphql") {
			return new Response(
				JSON.stringify({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				}),
				{ status: 200 },
			);
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
	const body = (await response.json()) as {
		projects: unknown;
		fetchedAt: string | null;
		error: string | null;
	};
	expect(body.projects).toEqual([
		{
			name: repo,
			tracker: "github",
			done: 2,
			dropped: 2,
			blocked: 0,
			backlog: 2,
			inProgress: 0,
			inReview: 0,
			awaitingMerge: 0,
			tags: [],
			unlinkedPrs: [],
			tickets: [
				{ key: `${repo}#1`, title: "Ticket 1", state: "done", blockers: [] },
				{
					key: `${repo}#2`,
					title: "Ticket 2",
					state: "dropped",
					blockers: [],
				},
				{
					key: `${repo}#3`,
					title: "Ticket 3",
					state: "dropped",
					blockers: [],
				},
				{ key: `${repo}#4`, title: "Ticket 4", state: "done", blockers: [] },
				{
					key: `${repo}#5`,
					title: "Ticket 5",
					state: "backlog",
					blockers: [],
				},
				{
					key: `${repo}#6`,
					title: "Ticket 6",
					state: "backlog",
					blockers: [],
				},
			],
			crossProjectBlockers: [],
			needsYou: 0,
			progress: 33,
			fetchedAt: body.fetchedAt,
			error: null,
		},
	]);
	expect(body.error).toBeNull();
	expect(body.fetchedAt).not.toBeNull();
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

const linearProject = "widget-launch-0d42ae5d46d0";
const linearName = "Widget launch";

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

function linearFetch(requests: string[]): Fetch {
	return linearFake({
		project: {
			id: "project-1",
			name: linearName,
			slugId: linearProject,
		},
		pages: [
			{ nodes: linearRecorded.slice(0, 4), endCursor: "page-2" },
			{ nodes: linearRecorded.slice(4), endCursor: null },
		],
		requests,
		github: async (input) => {
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
			if (url.includes("/check-runs")) {
				return new Response(JSON.stringify({ check_runs: [] }), {
					status: 200,
				});
			}
			if (
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions") ||
				/\/pulls\/\d+$/.test(url)
			) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							repository: {
								pullRequest: { closingIssuesReferences: { nodes: [] } },
							},
						},
					}),
					{ status: 200 },
				);
			}
			return new Response("not recorded", { status: 404 });
		},
	});
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
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("a later poll drops a repo that is no longer pinned", async () => {
		const repoA = "acme/alpha";
		const repoB = "acme/beta";
		const requests: string[] = [];
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
				const list = new URL(url);
				if (
					list.origin === "https://api.github.com" &&
					list.pathname === `/repos/${pinned}/issues`
				) {
					requests.push(url);
					return page([ticket(1, "open", null)], null);
				}
				if (url.includes("/pulls?") || url.includes("/branches?")) {
					return page([], null);
				}
				return emptyList(url) ?? new Response("not recorded", { status: 404 });
			};
		const store = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(store, "project-flow.sqlite");
		const serve = async (
			pinned: string,
			refresh: boolean,
		): Promise<unknown> => {
			const { path, cleanup } = await tempConfig(
				JSON.stringify({
					pinned: [{ tracker: "github", repo: pinned }],
				}),
			);
			let startChecks: (base: string) => void = () => {};
			const checks = new Promise<unknown>((resolve, reject) => {
				startChecks = (base: string) => {
					void (async () => {
						if (refresh) {
							const posted = await fetch(new URL("/api/refresh", base), {
								method: "POST",
							});
							expect(posted.status).toBe(204);
						}
						const response = await fetch(new URL("/api/overview", base));
						expect(response.status).toBe(200);
						resolve(await response.json());
					})().catch(reject);
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
			const first = (await serve(repoA, false)) as Overview;
			expect(first).toEqual({
				projects: [
					{
						name: repoA,
						tracker: "github",
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: `${repoA}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						fetchedAt: first.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: first.fetchedAt,
				error: null,
			});
			const before = requests.length;
			const second = (await serve(repoB, true)) as Overview;
			expect(second.projects.map((project) => project.name)).toEqual([repoB]);
			expect(second).toEqual({
				projects: [
					{
						name: repoB,
						tracker: "github",
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: `${repoB}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						fetchedAt: second.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: second.fetchedAt,
				error: null,
			});
			const beta = requests
				.slice(before)
				.filter((url) => url.includes(`/repos/${repoB}/issues`));
			expect(new URL(beta[0] ?? "").searchParams.get("since")).toBeNull();
		} finally {
			await rm(store, { recursive: true, force: true });
		}
	});

	test("a missing Linear key serves and names LINEAR_API_KEY on the pinned project", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-overview-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<Overview>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) =>
						resolve((await response.json()) as Overview),
					)
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token", LINEAR_API_KEY: "   " },
					fetch: linearFetch([]),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.listened).toBe(true);
			const body = await checks;
			expect(body.projects[0]?.error).toContain("LINEAR_API_KEY");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
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
		const rejected = linearFake({ fail: "key" });
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
		const unknown = linearFake({
			project: {
				id: "project-1",
				name: linearName,
				slugId: linearProject,
			},
			issues: [
				linearIssue("1", "completed"),
				{
					id: "9",
					identifier: "WID-9",
					updatedAt: "2026-04-01T00:00:00.000Z",
					state: { type: "archived-mystery" },
				},
				{
					id: "10",
					identifier: "WID-10",
					updatedAt: "2026-04-01T00:00:00.000Z",
					state: null,
				},
			],
		});
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
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: linearName,
						tracker: "linear",
						done: 1,
						dropped: 0,
						blocked: 0,
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: "WID-1",
								title: "Linear ticket 1",
								state: "done",
								blockers: [],
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 100,
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
		const unmatched = linearFake({ project: null });
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: unmatched,
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(pin);
			expect(result.listened).toBe(true);
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
		const failing = linearFake({ fail: "lookup", status: 502 });
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
			expect(result.stderr).toContain(pin);
			expect(result.stderr).toContain("HTTP 502");
			expect(result.listened).toBe(true);
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
		const failing = linearFake({
			project: {
				id: "project-1",
				name: linearName,
				slugId: linearProject,
			},
			fail: "issues",
		});
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
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("a Linear card heading shows the Linear project name", async () => {
		const pin = "agent-docs-cleanup-0d42ae5d46d0";
		const projectName = "Agent docs cleanup";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: pin }],
			}),
		);
		const named = linearFake({
			project: {
				id: "project-1",
				name: projectName,
				slugId: pin,
			},
			issues: [linearIssue("1", "completed")],
		});
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
					fetch: named,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
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
						const body = (await response.json()) as {
							projects: ProjectCounts[];
							error: string | null;
						};
						expect(body.projects).toHaveLength(2);
						const github = body.projects.find(
							(project) => project.tracker === "github",
						);
						expect(github).toEqual({
							name: repo,
							tracker: "github",
							done: 2,
							dropped: 2,
							blocked: 0,
							backlog: 2,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							tags: [],
							unlinkedPrs: [],
							tickets: [
								{
									key: `${repo}#1`,
									title: "Ticket 1",
									state: "done",
									blockers: [],
								},
								{
									key: `${repo}#2`,
									title: "Ticket 2",
									state: "dropped",
									blockers: [],
								},
								{
									key: `${repo}#3`,
									title: "Ticket 3",
									state: "dropped",
									blockers: [],
								},
								{
									key: `${repo}#4`,
									title: "Ticket 4",
									state: "done",
									blockers: [],
								},
								{
									key: `${repo}#5`,
									title: "Ticket 5",
									state: "backlog",
									blockers: [],
								},
								{
									key: `${repo}#6`,
									title: "Ticket 6",
									state: "backlog",
									blockers: [],
								},
							],
							crossProjectBlockers: [],
							needsYou: 0,
							progress: 33,
							fetchedAt: github?.fetchedAt ?? null,
							error: null,
						});
						const linear = body.projects.find(
							(project) => project.tracker === "linear",
						);
						expect(linear).toEqual({
							name: linearName,
							tracker: "linear",
							done: 2,
							dropped: 2,
							blocked: 0,
							backlog: 2,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							tags: [],
							unlinkedPrs: [],
							tickets: [
								{
									key: "WID-1",
									title: "Linear ticket 1",
									state: "done",
									blockers: [],
								},
								{
									key: "WID-2",
									title: "Linear ticket 2",
									state: "dropped",
									blockers: [],
								},
								{
									key: "WID-3",
									title: "Linear ticket 3",
									state: "dropped",
									blockers: [],
								},
								{
									key: "WID-4",
									title: "Linear ticket 4",
									state: "done",
									blockers: [],
								},
								{
									key: "WID-5",
									title: "Linear ticket 5",
									state: "backlog",
									blockers: [],
								},
								{
									key: "WID-6",
									title: "Linear ticket 6",
									state: "backlog",
									blockers: [],
								},
							],
							crossProjectBlockers: [],
							needsYou: 0,
							progress: 33,
							fetchedAt: linear?.fetchedAt ?? null,
							error: null,
						});
						expect(body.error).toBeNull();
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
			expect(sent.slice(0, 2).map((call) => call.variables)).toEqual([
				{
					filter: { project: { id: { eq: "project-1" } } },
					after: null,
				},
				{
					filter: { project: { id: { eq: "project-1" } } },
					after: "page-2",
				},
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: pullRepo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: `${pullRepo}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				if (body.includes("ProjectByPin")) {
					return new Response(
						JSON.stringify({
							data: {
								projects: {
									nodes: [
										{
											id: "linear-project-1",
											name: "Widget launch",
											slugId: linearProject,
										},
									],
								},
							},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
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
					JSON.stringify({
						data: {
							issues: {
								nodes: [
									linearIssue("1", "backlog"),
									linearIssue("2", "completed"),
								],
								pageInfo: { hasNextPage: false, endCursor: null },
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
					fetch: finding,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						done: 1,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 50,
						tickets: [
							{
								key: `${repo}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
							},
							{
								key: `${repo}#2`,
								title: "Ticket 2",
								state: "done",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
					{
						name: "Widget launch",
						tracker: "linear",
						done: 1,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 50,
						tickets: [
							{
								key: "WID-1",
								title: "Linear ticket 1",
								state: "backlog",
								blockers: [],
							},
							{
								key: "WID-2",
								title: "Linear ticket 2",
								state: "done",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[1]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: "Org board",
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: "acme/org-board#1",
								title: "",
								state: "backlog",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				body.includes("projects(") &&
				!body.includes("ProjectByPin")
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
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("ProjectByPin")
			) {
				return new Response(
					JSON.stringify({
						data: {
							projects: {
								nodes: [
									{
										id: "linear-member",
										name: "Member launch",
										slugId: "member-launch",
									},
								],
							},
						},
					}),
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: "Member launch",
						tracker: "linear",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: "WID-1",
								title: "Linear ticket 1",
								state: "backlog",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				testIo({
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
				}),
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: "Widget board",
						tracker: "github",
						done: 1,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 50,
						tickets: [
							{
								key: "acme/widget#9",
								title: "",
								state: "backlog",
								blockers: [],
							},
							{
								key: "acme/widget#8",
								title: "",
								state: "done",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
					{
						name: repo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: `${repo}#4`,
								title: "Ticket 4",
								state: "backlog",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[1]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: "Pinned board",
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: "acme/other#1",
								title: "",
								state: "backlog",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: `${repo}#9`,
								title: "Ticket 9",
								state: "backlog",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: `${repo}#9`,
								title: "Ticket 9",
								state: "backlog",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: `${repo}#9`,
								title: "Ticket 9",
								state: "backlog",
								blockers: [],
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				testIo({
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
				}),
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
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: githubFetch([]),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const empty = (await checks) as Overview;
			expect(empty).toEqual({
				projects: [],
				fetchedAt: empty.fetchedAt,
				error: null,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank configuration file shows no projects", async () => {
		const { path, cleanup } = await tempConfig("   \n");
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const result = await run(
				["--config", `  ${path}  `],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: githubFetch([]),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					waitForStop: Promise.resolve(),
				}),
			);
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
				return new Response(
					JSON.stringify({
						data: {
							issues: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("ProjectByPin")
			) {
				return new Response(
					JSON.stringify({
						data: {
							projects: {
								nodes: [
									{
										id: "quiet-linear-id",
										name: "Quiet linear",
										slugId: pinnedLinear,
									},
								],
							},
						},
					}),
					{ status: 200 },
				);
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: "Quiet linear",
						tracker: "linear",
						done: 0,
						dropped: 0,
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
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
				testIo({
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
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const empty = (await checks) as Overview;
			expect(empty).toEqual({
				projects: [],
				fetchedAt: empty.fetchedAt,
				error: null,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an open ask counts as needs you, and a quoted ask does not", async () => {
		const ask = "<!-- workcell:ask 11-1 -->";
		const quiet = "acme/quiet";
		const asked = "acme/asked";
		function issue(
			number: number,
			state: "open" | "closed",
		): Record<string, unknown> {
			return {
				number,
				title: `Ticket ${number}`,
				state,
				state_reason: state === "closed" ? "completed" : null,
				updated_at: "2026-10-18T12:00:00Z",
				body: "",
			};
		}
		const recorded: Fetch = async (input) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return page([], null);
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
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
					},
				);
			}
			const quietList = `https://api.github.com/repos/${quiet}/issues?`;
			const askedList = `https://api.github.com/repos/${asked}/issues?`;
			if (url.startsWith(quietList)) {
				return page(
					[issue(1, "closed"), issue(2, "closed"), issue(3, "open")],
					null,
				);
			}
			if (url.startsWith(askedList)) {
				return page(
					[
						{ ...issue(1, "open"), comments: 1 },
						{ ...issue(2, "open"), comments: 2 },
						{ ...issue(3, "open"), comments: 2 },
						{ ...issue(4, "open"), comments: 1 },
						{ ...issue(7, "closed"), comments: 1 },
						issue(8, "open"),
					],
					null,
				);
			}
			if (url.includes(`/repos/${asked}/issues/1/comments`)) {
				return page([{ body: `This waits on Lev.\n\n${ask}` }], null);
			}
			if (url.includes(`/repos/${asked}/issues/2/comments`)) {
				return page(
					[
						{ body: `This waits on Lev.\n\n${ask}` },
						{ body: "Use the short name.\n\n11-1" },
					],
					null,
				);
			}
			if (url.includes(`/repos/${asked}/issues/3/comments`)) {
				return page(
					[
						{ body: `This waits on Lev.\n\n${ask}` },
						{ body: "See 11-12 for the later ask." },
					],
					null,
				);
			}
			if (url.includes(`/repos/${asked}/issues/4/comments`)) {
				return page(
					[{ body: "Lev asked yesterday. The passphrase is in the vault." }],
					null,
				);
			}
			if (url.includes(`/repos/${asked}/issues/7/comments`)) {
				return page([{ body: `This waits on Lev.\n\n${ask}` }], null);
			}
			if (url.includes("/pulls?") || url.includes("/branches?")) {
				return page([], null);
			}
			return new Response("not recorded", { status: 404 });
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: quiet },
					{ tracker: "github", repo: asked },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const requests: string[] = [];
		const fetching: Fetch = async (input, init) => {
			requests.push(urlOf(input));
			return recorded(input, init);
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
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetching,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as {
				projects: { name: string; needsYou: number; progress: number }[];
			};
			expect(
				body.projects.find((project) => project.name === quiet),
			).toMatchObject({ needsYou: 0, progress: 67 });
			expect(
				body.projects.find((project) => project.name === asked),
			).toMatchObject({ needsYou: 2, progress: 17 });
			expect(requests.some((url) => url.includes("/issues/7/comments"))).toBe(
				false,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a recorded issue list with comments as a number still serves overview", async () => {
		const ask = "<!-- workcell:ask 11-2 -->";
		const listed = "acme/listed";
		const commentBody = `This waits on Lev.\n\n${ask}`;
		const recorded: Fetch = async (input) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return page([], null);
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
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			const list = `https://api.github.com/repos/${listed}/issues?`;
			if (url.startsWith(list)) {
				return page(
					[
						{
							number: 3,
							title: "Counted comments",
							state: "open",
							state_reason: null,
							updated_at: "2026-10-18T12:00:00Z",
							body: "",
							comments: 3,
						},
					],
					null,
				);
			}
			if (url.includes("/issues/3/comments")) {
				return page(
					[
						{ body: "Earlier note." },
						{ body: commentBody },
						{ body: "Still waiting." },
					],
					null,
				);
			}
			if (url.includes("/pulls?") || url.includes("/branches?")) {
				return page([], null);
			}
			return new Response("not recorded", { status: 404 });
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo: listed }] }),
		);
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
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as {
				projects: { name: string; needsYou: number }[];
			};
			expect(
				body.projects.find((project) => project.name === listed),
			).toMatchObject({ needsYou: 1 });
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty configuration takes the GitHub token from gh and lists found projects", async () => {
		const foundRepo = "lev/found-widget";
		const { path, cleanup } = await tempConfig("{}");
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const authorizations: string[] = [];
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const headers = new Headers(init?.headers);
			const authorization = headers.get("authorization");
			if (authorization !== null) {
				authorizations.push(authorization);
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: foundRepo,
							owner: { login: "lev" },
							permissions: { admin: true, push: true, pull: true },
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${foundRepo}/issues?`)) {
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
				testIo({
					env: {},
					fetch: recorded,
					readGhToken: async () => "gh-printed-token",
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body.projects.map((project) => project.name)).toEqual([foundRepo]);
			expect(body.projects[0]).toMatchObject({
				tracker: "github",
				error: null,
			});
			expect(body.error).toBeNull();
			expect(authorizations).toContain("Bearer gh-printed-token");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty configuration with no gh starts and names GITHUB_TOKEN on GitHub projects", async () => {
		const foundRepo = "lev/found-widget";
		const { path, cleanup } = await tempConfig("{}");
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const bin = await mkdtemp(join(tmpdir(), "project-flow-no-gh-"));
		const recorded: Fetch = async (input) => {
			const url = urlOf(input);
			if (url.startsWith("https://api.github.com/")) {
				throw new Error("GitHub must not be called without a token");
			}
			return new Response("not recorded", { status: 404 });
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
				testIo({
					env: { PATH: bin },
					fetch: recorded,
					readGhToken: readGhAuthToken,
					databasePath: join(root, "project-flow.sqlite"),
					listCheckouts: async () => [
						{
							tracker: "github",
							path: "/var/tmp/lev/found-widget",
							repo: foundRepo,
							originOwner: "lev",
							hasTrackerConfig: true,
							names: [],
						},
					],
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			const body = (await checks) as Overview;
			expect(body.projects.map((project) => project.name)).toContain(foundRepo);
			expect(
				body.projects.find((project) => project.name === foundRepo)?.error,
			).toContain("GITHUB_TOKEN");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
			await rm(bin, { recursive: true, force: true });
		}
	});

	test("a blank gh token and a blank checkout root start with no GitHub projects", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ checkoutRoots: ["   "] }),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const stray = await mkdtemp(join("/var/tmp", "project-flow-stray-"));
		await writeFile(join(stray, "note.txt"), "untracked");
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
					env: { GITHUB_TOKEN: "   " },
					fetch: async () => {
						throw new Error("GitHub must not be called for a blank token");
					},
					readGhToken: async () => "   ",
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			const body = (await checks) as Overview;
			expect(body.projects).toEqual([]);
			expect(body.error).toBeNull();
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
			await rm(stray, { recursive: true, force: true });
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

	test("an omitted poll interval is 300 seconds", async () => {
		const { path, cleanup } = await tempConfig("{}");
		const root = await mkdtemp(join("/var/tmp", "project-flow-poll-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const response = await fetch(new URL("/api/settings", base));
					expect(response.status).toBe(200);
					const settings = (await response.json()) as {
						pollIntervalSeconds: number;
					};
					expect(settings.pollIntervalSeconds).toBe(300);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {},
					fetch: async () => new Response("not recorded", { status: 404 }),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a second poll of an unchanged repo sends the first ETag and a 304 keeps the overview", async () => {
		const repoName = "acme/unchanged";
		const etag = '"recorded-issues-etag"';
		const pullEtag = '"recorded-pulls-etag"';
		const closedEtag = '"recorded-closed-pulls-etag"';
		const sent: { url: string; headers: Headers }[] = [];
		const reads = new Map<string, number>();
		const openPull = {
			number: 9,
			title: "Ship the widget",
			state: "open",
			draft: true,
			html_url: `https://github.com/${repoName}/pull/9`,
			body: "",
			head: { ref: "ship-widget", sha: "" },
		};
		const readOf = (url: string): number => {
			const count = (reads.get(url) ?? 0) + 1;
			reads.set(url, count);
			return count;
		};
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const headers = new Headers(init?.headers);
			sent.push({ url, headers });
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repoName,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				if (readOf(url) > 1) {
					return new Response(null, { status: 304, headers: { etag } });
				}
				return page([ticket(4, "open", null)], null, { etag });
			}
			if (url.includes(`/repos/${repoName}/pulls?state=open`)) {
				if (readOf(url) > 1) {
					return new Response(null, {
						status: 304,
						headers: { etag: pullEtag },
					});
				}
				return page([openPull], null, { etag: pullEtag });
			}
			if (url.includes(`/repos/${repoName}/pulls?state=closed`)) {
				if (readOf(url) > 1) {
					return new Response(null, {
						status: 304,
						headers: { etag: closedEtag },
					});
				}
				return page([], null, { etag: closedEtag });
			}
			if (url.includes("/branches?")) {
				return page([], null);
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
							repository: {
								pullRequest: { closingIssuesReferences: { nodes: [] } },
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response("not recorded", { status: 404 });
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-etag-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const before = (await first.json()) as Overview;
					expect(before.projects.map((project) => project.name)).toEqual([
						repoName,
					]);
					expect(before.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "backlog",
							blockers: [],
						},
					]);
					expect(before.projects[0]?.unlinkedPrs).toEqual([
						{
							number: 9,
							title: "Ship the widget",
							url: `https://github.com/${repoName}/pull/9`,
							repo: repoName,
						},
					]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const second = await fetch(new URL("/api/overview", base));
					expect(second.status).toBe(200);
					const after = (await second.json()) as Overview;
					expect(after.projects).toEqual(before.projects);
					const issueReads = sent.filter((item) =>
						item.url.includes(`/repos/${repoName}/issues?`),
					);
					const pullReads = sent.filter((item) =>
						item.url.includes(`/repos/${repoName}/pulls?state=open`),
					);
					expect(issueReads).toHaveLength(2);
					expect(pullReads).toHaveLength(2);
					expect(issueReads[0]?.headers.get("if-none-match")).toBeNull();
					expect(issueReads[1]?.headers.get("if-none-match")).toBe(etag);
					expect(pullReads[0]?.headers.get("if-none-match")).toBeNull();
					expect(pullReads[1]?.headers.get("if-none-match")).toBe(pullEtag);
					expect(issueReads[1]?.url).toContain("since=");
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a 304 with no stored ETag keeps the prior overview", async () => {
		const repoName = "acme/blank-interval";
		const sent: { url: string; headers: Headers }[] = [];
		const reads = new Map<string, number>();
		const readOf = (url: string): number => {
			const count = (reads.get(url) ?? 0) + 1;
			reads.set(url, count);
			return count;
		};
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			sent.push({ url, headers: new Headers(init?.headers) });
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repoName,
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				if (readOf(url) > 1) {
					return new Response(null, { status: 304 });
				}
				return page([ticket(4, "open", null)], null);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions")
			) {
				return page([], null);
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
			return new Response("not recorded", { status: 404 });
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-blank-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					const before = (await first.json()) as Overview;
					expect(before.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "backlog",
							blockers: [],
						},
					]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const second = await fetch(new URL("/api/overview", base));
					const after = (await second.json()) as Overview;
					expect(after.projects).toEqual(before.projects);
					expect(after.error).toBeNull();
					const issueReads = sent.filter((item) =>
						item.url.includes(`/repos/${repoName}/issues?`),
					);
					expect(issueReads[1]?.headers.get("if-none-match")).toBeNull();
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
