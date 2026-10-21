import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Overview, ProjectCounts, ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { readGhAuthToken, run } from "../src/main.ts";
import {
	emptyProjectFields,
	githubIssueNode,
	linearFake,
	recordedDiscovery,
	repoReadFromHandler,
	repoReadFromLists,
	repoReadResponse,
	settledOverview,
	tempConfig,
	testIo,
	trackFound,
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = "acme/widget";

async function readOverview(base: string): Promise<Overview> {
	const response = await fetch(new URL("/api/overview", base));
	expect(response.status).toBe(200);
	return (await response.json()) as Overview;
}

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
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?")
	) {
		return page([], null);
	}
	return null;
}

const fixtureTickets = [
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
			return page(fixtureTickets.slice(0, 4), second);
		}
		if (url === second) {
			return page(fixtureTickets.slice(4), null);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?")
		) {
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
			const read = repoReadFromLists(input, init, {
				[repo]: [...fixtureTickets.slice(0, 4), ...fixtureTickets.slice(4)],
			});
			if (read !== null) {
				requests.push(
					`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`,
				);
				return read;
			}
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
		return (
			emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
		);
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
			ref: { tracker: "github", repo },
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
					lane: "Done",
					statusType: "done",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#2`,
					title: "Ticket 2",
					state: "dropped",
					blockers: [],
					lane: "Dropped",
					statusType: "dropped",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#3`,
					title: "Ticket 3",
					state: "dropped",
					blockers: [],
					lane: "Dropped",
					statusType: "dropped",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#4`,
					title: "Ticket 4",
					state: "done",
					blockers: [],
					lane: "Done",
					statusType: "done",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#5`,
					title: "Ticket 5",
					state: "backlog",
					blockers: [],
					lane: "Backlog",
					statusType: "backlog",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#6`,
					title: "Ticket 6",
					state: "backlog",
					blockers: [],
					lane: "Backlog",
					statusType: "backlog",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
			],
			crossProjectBlockers: [],
			needsYou: 0,
			progress: 33,
			fetchedAt: body.fetchedAt,
			error: null,
			statusTypes: {
				backlog: 2,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 0,
				done: 2,
				dropped: 2,
			},
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
		github: async (input, init) => {
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
				return page(
					fixtureTickets.filter((item) => item.pull_request === undefined),
					null,
				);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
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
				const listed = await repoReadFromHandler(input, init, githubFetch());
				if (listed !== null) {
					return listed;
				}
				const read = repoReadResponse(input, init);
				if (read !== null) {
					return read;
				}
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
			return emptyProjectFields(input, init) ?? unrecorded(input);
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
				if (
					url.includes("/pulls?") ||
					url.includes("/branches?") ||
					url.includes("/labels?") ||
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/commits/") ||
					url.includes("/check-runs")
				) {
					return url.includes("/check-runs")
						? new Response(JSON.stringify({ check_runs: [] }), { status: 200 })
						: url.includes("/commits/")
							? Response.json({ commit: { committer: { date: null } } })
							: page([], null);
				}
				return (
					emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
				);
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
				expect(result.stderr).toBe("");
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
						ref: { tracker: "github", repo: repoA },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						fetchedAt: first.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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
						ref: { tracker: "github", repo: repoB },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						fetchedAt: second.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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
		const root = await mkdtemp(join("/var/tmp", "project-flow-overview-"));
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
					databasePath: join(root, "project-flow.sqlite"),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("LINEAR_API_KEY");
			expect(result.stderr).toContain("401");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
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
						ref: { tracker: "linear", project: linearProject },
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
								lane: "Done",
								statusType: "done",
								enteredStateAt: "2026-08-18T12:00:00.000Z",
								updatedAt: "2026-08-18T12:00:00.000Z",
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 100,
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 0,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 1,
							dropped: 0,
						},
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
			expect(overview.projects[0]?.name).not.toContain(pin);
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
							ref: { tracker: "github", repo },
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
									lane: "Done",
									statusType: "done",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#2`,
									title: "Ticket 2",
									state: "dropped",
									blockers: [],
									lane: "Dropped",
									statusType: "dropped",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#3`,
									title: "Ticket 3",
									state: "dropped",
									blockers: [],
									lane: "Dropped",
									statusType: "dropped",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#4`,
									title: "Ticket 4",
									state: "done",
									blockers: [],
									lane: "Done",
									statusType: "done",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#5`,
									title: "Ticket 5",
									state: "backlog",
									blockers: [],
									lane: "Backlog",
									statusType: "backlog",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#6`,
									title: "Ticket 6",
									state: "backlog",
									blockers: [],
									lane: "Backlog",
									statusType: "backlog",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
							],
							crossProjectBlockers: [],
							needsYou: 0,
							progress: 33,
							fetchedAt: github?.fetchedAt ?? null,
							error: null,
							statusTypes: {
								backlog: 2,
								inProgress: 0,
								inReview: 0,
								awaitingMerge: 0,
								done: 2,
								dropped: 2,
							},
						});
						const linear = body.projects.find(
							(project) => project.tracker === "linear",
						);
						expect(linear).toEqual({
							name: linearName,
							tracker: "linear",
							ref: { tracker: "linear", project: linearProject },
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
									lane: "Done",
									statusType: "done",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-2",
									title: "Linear ticket 2",
									state: "dropped",
									blockers: [],
									lane: "Dropped",
									statusType: "dropped",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-3",
									title: "Linear ticket 3",
									state: "dropped",
									blockers: [],
									lane: "Dropped",
									statusType: "dropped",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-4",
									title: "Linear ticket 4",
									state: "done",
									blockers: [],
									lane: "Done",
									statusType: "done",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-5",
									title: "Linear ticket 5",
									state: "backlog",
									blockers: [],
									lane: "Backlog",
									statusType: "backlog",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-6",
									title: "Linear ticket 6",
									state: "backlog",
									blockers: [],
									lane: "Backlog",
									statusType: "backlog",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
							],
							crossProjectBlockers: [],
							needsYou: 0,
							progress: 33,
							fetchedAt: linear?.fetchedAt ?? null,
							error: null,
							statusTypes: {
								backlog: 2,
								inProgress: 0,
								inReview: 0,
								awaitingMerge: 0,
								done: 2,
								dropped: 2,
							},
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
						ref: { tracker: "github", repo: pullRepo },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
						ref: { tracker: "github", repo: repo },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
							{
								key: `${repo}#2`,
								title: "Ticket 2",
								state: "done",
								blockers: [],
								lane: "Done",
								statusType: "done",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 1,
							dropped: 0,
						},
					},
					{
						name: "Widget launch",
						tracker: "linear",
						ref: { tracker: "linear", project: linearProject },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-08-18T12:00:00.000Z",
								updatedAt: "2026-08-18T12:00:00.000Z",
							},
							{
								key: "WID-2",
								title: "Linear ticket 2",
								state: "done",
								blockers: [],
								lane: "Done",
								statusType: "done",
								enteredStateAt: "2026-08-18T12:00:00.000Z",
								updatedAt: "2026-08-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[1]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 1,
							dropped: 0,
						},
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
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
						ref: { tracker: "github", owner: "acme", project: 9 },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
						ref: { tracker: "linear", project: "member-launch" },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-08-18T12:00:00.000Z",
								updatedAt: "2026-08-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
						ref: { tracker: "github", owner: "acme", project: 3 },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "",
							},
							{
								key: "acme/widget#8",
								title: "",
								state: "done",
								blockers: [],
								lane: "Done",
								statusType: "done",
								enteredStateAt: "",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 1,
							dropped: 0,
						},
					},
					{
						name: repo,
						tracker: "github",
						ref: { tracker: "github", repo: repo },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[1]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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

	test("a tracked GitHub project shows and an untracked GitHub project never shows", async () => {
		const pinnedId = "PVT_pinned";
		const hiddenId = "PVT_hidden";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", owner: "acme", project: 7 }],
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
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
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
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
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
						ref: { tracker: "github", owner: "acme", project: 7 },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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

	test("an untracked GitHub project releases its tickets to the repo", async () => {
		const hiddenId = "PVT_hidden_claim";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo }] }),
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
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
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
						ref: { tracker: "github", repo: repo },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
						ref: { tracker: "github", repo: repo },
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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
				tracked: false,
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

	test("a tracked quiet Linear project shows and an untracked active project does not", async () => {
		const pinnedLinear = "quiet-linear";
		const hiddenRepo = "acme/hidden-live";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "linear", project: pinnedLinear }],
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
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
						ref: { tracker: "linear", project: pinnedLinear },
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
						statusTypes: {
							backlog: 0,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
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
				tracked: false,
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
		const recorded: Fetch = async (input, init) => {
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
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([], null);
			}
			return emptyProjectFields(input, init) ?? unrecorded(input);
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
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a recorded issue list with comments as a number still serves overview", async () => {
		const ask = "<!-- workcell:ask 11-2 -->";
		const listed = "acme/listed";
		const commentBody = `This waits on Lev.\n\n${ask}`;
		const recorded: Fetch = async (input, init) => {
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
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([], null);
			}
			return emptyProjectFields(input, init) ?? unrecorded(input);
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.startsWith("https://api.github.com/")) {
				throw new Error("GitHub must not be called without a token");
			}
			return emptyProjectFields(input, init) ?? unrecorded(input);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
		const sent: { url: string; headers: Headers; body: string }[] = [];
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
			sent.push({
				url,
				headers,
				body: typeof init?.body === "string" ? init.body : "",
			});
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
				readOf(url);
				return page([ticket(4, "open", null)], null, { etag });
			}
			if (url.includes(`/repos/${repoName}/pulls?state=open`)) {
				readOf(url);
				return page([openPull], null, { etag: pullEtag });
			}
			if (url.includes(`/repos/${repoName}/pulls?state=closed`)) {
				readOf(url);
				return page([], null, { etag: closedEtag });
			}
			if (url.includes("/branches?") || url.includes("/labels?")) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, recorded);
				if (listed !== null) {
					return listed;
				}
				const read = repoReadResponse(input, init);
				if (read !== null) {
					return read;
				}
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
			return unrecorded(input);
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
							lane: "Backlog",
							statusType: "backlog",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
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
					const after = await settledOverview(base, readOverview);
					expect(after.projects).toEqual(before.projects);
					const repoReads = sent.filter((item) =>
						item.body.includes("query RepoRead"),
					);
					// One poll shares one repository snapshot, so a start plus a
					// refresh is two reads.
					expect(repoReads).toHaveLength(2);
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
				readOf(url);
				return page([ticket(4, "open", null)], null);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions")
			) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, recorded);
				if (listed !== null) {
					return listed;
				}
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
			return unrecorded(input);
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
							lane: "Backlog",
							statusType: "backlog",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const after = await settledOverview(base, readOverview);
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

	test("a 304 on a later page keeps that page's branches on the overview", async () => {
		const repoName = "acme/paged-branches";
		const pageEtag = '"recorded-branches-page-1"';
		const laterEtag = '"recorded-branches-page-2"';
		const issueEtag = '"recorded-paged-issues"';
		const later = `https://api.github.com/repos/${repoName}/branches?per_page=100&page=2`;
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
				readOf(url);
				return page([ticket(21, "open", null)], null, { etag: issueEtag });
			}
			if (
				url.includes(`/repos/${repoName}/branches?`) &&
				!url.includes("page=2")
			) {
				readOf(url);
				return page([{ name: "main" }], later, { etag: pageEtag });
			}
			if (url === later) {
				readOf(url);
				return page([{ name: "21-feat-ship-the-widget" }], null, {
					etag: laterEtag,
				});
			}
			if (url.includes("/pulls?") || url.includes("/labels?")) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, recorded);
				if (listed !== null) {
					return listed;
				}
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
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-pages-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const before = (await first.json()) as Overview;
					expect(before.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#21`,
							title: "Ticket 21",
							state: "inProgress",
							blockers: [],
							lane: "In progress",
							statusType: "inProgress",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const after = await settledOverview(base, readOverview);
					expect(after.projects).toEqual(before.projects);
					expect(after.error).toBeNull();
					expect(
						sent.filter((item) => item.url === later).length,
					).toBeGreaterThan(0);
					expect(
						sent.filter((item) => item.url === "https://api.github.com/graphql")
							.length,
					).toBeGreaterThan(0);
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

	test("a later issue window sends its own ETag, not the full read's", async () => {
		const repoName = "acme/since-window";
		const fullEtag = '"recorded-full-issues"';
		const windowEtag = '"recorded-window-issues"';
		const sent: { url: string; headers: Headers; body: string }[] = [];
		const reads = new Map<string, number>();
		const readOf = (url: string): number => {
			const count = (reads.get(url) ?? 0) + 1;
			reads.set(url, count);
			return count;
		};
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			sent.push({
				url,
				headers: new Headers(init?.headers),
				body: typeof init?.body === "string" ? init.body : "",
			});
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
				return page([ticket(4, "open", null)], null, { etag: fullEtag });
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions") ||
				url.includes("/check-runs") ||
				url.includes("/commits/")
			) {
				return url.includes("/check-runs")
					? Response.json({ check_runs: [] })
					: url.includes("/commits/")
						? Response.json({ commit: { committer: { date: null } } })
						: page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("query RepoRead")) {
					readOf(body);
					const listed = await repoReadFromHandler(input, init, recorded);
					if (listed?.ok) {
						const payload = (await listed.json()) as {
							data: {
								repository: Record<string, unknown>;
								editedIssues?: unknown;
							};
						};
						if (body.includes("editedQuery")) {
							payload.data.editedIssues = {
								nodes: [githubIssueNode(ticket(8, "open", null))],
								pageInfo: { hasNextPage: false, endCursor: null },
							};
						}
						return Response.json(payload, {
							headers: { etag: windowEtag },
						});
					}
					return listed ?? unrecorded(input);
				}
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
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-since-"));
		const clock = { polls: 0, frozen: false };
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const before = (await first.json()) as Overview;
					expect(before.projects[0]?.tickets.map((item) => item.key)).toEqual([
						`${repoName}#4`,
					]);
					clock.frozen = true;
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const after = await settledOverview(base, readOverview);
					expect(after.projects[0]?.tickets.map((item) => item.key)).toEqual([
						`${repoName}#4`,
						`${repoName}#8`,
					]);
					const again = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(again.status).toBe(204);
					const kept = await settledOverview(base, readOverview);
					expect(kept.projects[0]?.tickets).toEqual(after.projects[0]?.tickets);
					expect(kept.error).toBeNull();
					const repoReads = sent.filter((item) =>
						item.body.includes("query RepoRead"),
					);
					const full = repoReads.filter(
						(item) => !item.body.includes("editedQuery"),
					);
					const windows = repoReads.filter((item) =>
						item.body.includes("editedQuery"),
					);
					expect(full.length).toBeGreaterThan(0);
					expect(windows.length).toBeGreaterThan(0);
					expect(windows[0]?.body).toContain(`repo:${repoName}`);
					expect(windows[0]?.body).not.toContain(fullEtag);
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
					now: () => {
						if (!clock.frozen) {
							clock.polls += 1;
						}
						return new Date(
							Date.parse("2026-10-18T12:00:00.000Z") + clock.polls,
						);
					},
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

	test("a later issue window does not send a superseded window's ETag", async () => {
		const repoName = "acme/window-evict";
		const otherRepo = "acme/other-window";
		const stableEtag = '"recorded-stable-pulls"';
		const sent: { url: string; headers: Headers; body: string }[] = [];
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			sent.push({ url, headers: new Headers(init?.headers), body });
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
						{
							full_name: otherRepo,
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url.includes(`/repos/${repoName}/issues?`) ||
				url.includes(`/repos/${otherRepo}/issues?`)
			) {
				const number = url.includes(repoName) ? 4 : 1;
				return page([ticket(number, "open", null)], null);
			}
			if (url.includes("/pulls?")) {
				if (url.includes("state=closed")) {
					return page([], null);
				}
				return page([], null, { etag: stableEtag });
			}
			if (url.includes("/labels?")) {
				return page([], null);
			}
			if (url.includes("/branches?")) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				if (body.includes("query RepoRead")) {
					const listed = await repoReadFromHandler(input, init, recorded);
					if (listed?.ok) {
						const payload = (await listed.json()) as {
							data: { editedIssues?: unknown };
						};
						if (body.includes("editedQuery")) {
							const editedRepo = body.includes(otherRepo)
								? otherRepo
								: repoName;
							payload.data.editedIssues = {
								nodes: [
									githubIssueNode(
										ticket(editedRepo === otherRepo ? 2 : 8, "open", null),
									),
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							};
						}
						return Response.json(payload);
					}
					return listed ?? unrecorded(input);
				}
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
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: repoName },
					{ tracker: "github", repo: otherRepo },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-evict-"));
		const clockPath = join(root, "clock");
		await writeFile(clockPath, "2026-10-18T12:00:00.000Z");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const before = (await first.json()) as Overview;
					expect(
						before.projects
							.find((project) => project.name === repoName)
							?.tickets.map((item) => item.key),
					).toEqual([`${repoName}#4`]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					await settledOverview(base, readOverview);
					await writeFile(clockPath, "2026-10-18T12:01:00.000Z");
					const sameWindow = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(sameWindow.status).toBe(204);
					await settledOverview(base, readOverview);
					const moved = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(moved.status).toBe(204);
					await settledOverview(base, readOverview);
					const windows = sent.filter(
						(item) =>
							item.body.includes("query RepoRead") &&
							item.body.includes(repoName) &&
							item.body.includes("editedQuery"),
					);
					expect(windows.length).toBeGreaterThan(1);
					expect(windows[0]?.body).toContain("2026-10-18T12:00:00.000Z");
					expect(windows.at(-1)?.body).toContain("2026-10-18T12:01:00.000Z");
					expect(windows[0]?.body).not.toBe(windows.at(-1)?.body);
					const otherWindows = sent.filter(
						(item) =>
							item.body.includes("query RepoRead") &&
							item.body.includes(otherRepo) &&
							item.body.includes("editedQuery"),
					);
					expect(otherWindows.length).toBeGreaterThan(1);
					expect(otherWindows[0]?.body).toContain("2026-10-18T12:00:00.000Z");
					expect(otherWindows.at(-1)?.body).toContain(
						"2026-10-18T12:01:00.000Z",
					);
					const pullReads = sent.filter((item) =>
						item.url.includes(`/repos/${repoName}/pulls?state=open`),
					);
					expect(pullReads.length).toBeGreaterThan(1);
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
					now: () => new Date(readFileSync(clockPath, "utf8")),
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

	test("a failed poll still sends the current issue window's ETag", async () => {
		const repoName = "acme/window-retry";
		const sent: {
			url: string;
			headers: Headers;
			status: number;
			body: string;
		}[] = [];
		let failWindow = false;
		let repoReads = 0;
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const note = (status: number, response: Response): Response => {
				sent.push({
					url,
					headers: new Headers(init?.headers),
					status,
					body,
				});
				return response;
			};
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return note(
					200,
					new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
				);
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return note(
					200,
					new Response(
						JSON.stringify([
							{
								full_name: repoName,
								pushed_at: "2026-10-18T12:00:00.000Z",
							},
						]),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				);
			}
			if (
				url.includes(`/repos/${repoName}/issues?`) &&
				url.includes("page=1")
			) {
				return note(200, page([ticket(4, "open", null)], null));
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/labels?") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions") ||
				url.includes("/check-runs") ||
				url.includes("/commits/")
			) {
				return note(
					200,
					url.includes("/check-runs")
						? Response.json({ check_runs: [] })
						: url.includes("/commits/")
							? Response.json({ commit: { committer: { date: null } } })
							: page([], null),
				);
			}
			if (url === "https://api.github.com/graphql") {
				if (body.includes("query RepoRead")) {
					repoReads += 1;
					if (failWindow) {
						failWindow = false;
						return note(503, new Response("unavailable", { status: 503 }));
					}
					const listed = await repoReadFromHandler(input, init, recorded);
					return note(listed?.status ?? 500, listed ?? unrecorded(input));
				}
				return note(
					200,
					new Response(
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
					),
				);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-retry-"));
		const clockPath = join(root, "clock");
		await writeFile(clockPath, "2026-10-18T12:00:00.000Z");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const seen = repoReads;
					failWindow = true;
					const failed = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(failed.status).toBe(204);
					const failedBody = await settledOverview(base, readOverview);
					expect(repoReads).toBeGreaterThan(seen);
					expect(
						`${failedBody.error ?? ""} ${failedBody.projects[0]?.error ?? ""} ${sent.map((item) => item.status).join(",")}`,
					).toContain("503");
					const retry = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(retry.status).toBe(204);
					const recovered = await settledOverview(base, readOverview);
					expect(recovered.projects[0]?.error).toBeNull();
					const windows = sent.filter((item) =>
						item.body.includes("query RepoRead"),
					);
					expect(windows.length).toBeGreaterThan(1);
					expect(windows.some((item) => item.status === 503)).toBe(true);
					expect(
						windows.filter((item) => item.status === 200).length,
					).toBeGreaterThan(0);
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
					now: () => new Date(readFileSync(clockPath, "utf8")),
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

	test("a stop during a poll ends the process within 5 seconds and the next start serves the stored data", async () => {
		const repoName = "acme/stop";
		const never = new Promise<Response>(() => {});
		const hung: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (
				url.startsWith("http://127.0.0.1") ||
				url.startsWith("http://localhost")
			) {
				return fetch(input, init);
			}
			const signal = init?.signal ?? null;
			if (signal?.aborted === true) {
				throw new DOMException("The operation was aborted.", "AbortError");
			}
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener(
					"abort",
					() => {
						reject(
							new DOMException("The operation was aborted.", "AbortError"),
						);
					},
					{ once: true },
				);
				void never;
			});
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-stop-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table snapshots (
				snapshot_key text primary key,
				name text not null,
				tracker text not null,
				payload text not null
			)
		`);
		seeded
			.query(
				"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
			)
			.run(
				`github:${repoName}`,
				repoName,
				"github",
				JSON.stringify({
					tickets: [
						{
							id: "4",
							tracker: "github",
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "open",
							stateReason: null,
							updatedAt: "2026-10-18T12:00:00.000Z",
							ref: `${repoName}#4`,
							body: "",
							blockedBy: [],
							milestone: null,
							parent: null,
							labels: [],
						},
					],
					pulls: [],
					branches: [],
					startedKeys: [],
				}),
			);
		seeded.close();
		let stopRestart: () => void = () => {};
		let stopRun: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			stopRun = resolve;
		});
		let listening: (base: string) => void = () => {};
		const ready = new Promise<string>((resolve) => {
			listening = resolve;
		});
		const first = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo(
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: hung,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => listening(line),
					waitForStop: stopped,
				},
				{ first: true },
			),
		);
		try {
			const base = await ready;
			const opened = await fetch(new URL("/api/overview", base));
			expect(opened.status).toBe(200);
			const before = (await opened.json()) as Overview;
			expect(before.projects[0]?.tickets[0]?.key).toBe(`${repoName}#4`);
			const started = Date.now();
			stopRun();
			const result = await Promise.race([
				first.then((ended) => ({ ended, timedOut: false })),
				Bun.sleep(5_000).then(() => ({ ended: null, timedOut: true })),
			]);
			expect(result.timedOut).toBe(false);
			expect(Date.now() - started).toBeLessThan(5_000);
			expect(result.ended?.exitCode).toBe(0);
			const restartStopped = new Promise<void>((resolve) => {
				stopRestart = resolve;
			});
			let restartChecks: (line: string) => void = () => {};
			const restartDone = new Promise<void>((resolve, reject) => {
				restartChecks = (line) => {
					void (async () => {
						const response = await fetch(new URL("/api/overview", line));
						expect(response.status).toBe(200);
						const body = (await response.json()) as Overview;
						expect(body.error).toBeNull();
						expect(body.projects[0]?.error).toBeNull();
						expect(body.projects[0]?.tickets).toEqual([
							{
								key: `${repoName}#4`,
								title: "Ticket 4",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						]);
						resolve();
					})().catch(reject);
				};
			});
			const restartRun = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: hung,
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => restartChecks(line),
						waitForStop: restartStopped,
					},
					{ first: true },
				),
			);
			await Promise.race([
				restartDone,
				Bun.sleep(3_000).then(() => {
					throw new Error("restart overview did not answer");
				}),
			]);
			stopRestart();
			const restart = await restartRun;
			expect(restart.stderr).toBe("");
			expect(restart.exitCode).toBe(0);
		} finally {
			stopRun();
			stopRestart();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	}, 15_000);

	test("a warm start releases the first poll when the overview is read", async () => {
		const repoName = "acme/warm-release";
		let repoReads = 0;
		let releaseRead: () => void = () => {};
		const readHeld = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				repoReads += 1;
				await readHeld;
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 4,
							title: "Ticket 4",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/4`,
							updated_at: "2026-10-18T12:00:00.000Z",
						},
					],
					null,
				);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-warm-release-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table snapshots (
				snapshot_key text primary key,
				name text not null,
				tracker text not null,
				payload text not null
			)
		`);
		seeded
			.query(
				"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
			)
			.run(
				`github:${repoName}`,
				repoName,
				"github",
				JSON.stringify({
					tickets: [
						{
							id: "4",
							tracker: "github",
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "open",
							stateReason: null,
							updatedAt: "2026-10-18T12:00:00.000Z",
							ref: `${repoName}#4`,
							body: "",
							blockedBy: [],
							milestone: null,
							parent: null,
							labels: [],
						},
					],
					pulls: [],
					branches: [],
					startedKeys: [],
				}),
			);
		seeded.close();
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					await Bun.sleep(100);
					expect(repoReads).toBe(0);
					const opened = await fetch(new URL("/api/overview", base));
					expect(opened.status).toBe(200);
					const released = await Promise.race([
						(async () => {
							while (repoReads === 0) {
								await Bun.sleep(20);
							}
							return true;
						})(),
						Bun.sleep(1_000).then(() => false),
					]);
					expect(released).toBe(true);
					expect(repoReads).toBe(1);
					releaseRead();
					resolve();
				})().catch((error: unknown) => {
					releaseRead();
					reject(error);
				});
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: recordedFetch,
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releaseRead();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a warm start runs one poll until the poll interval passes", async () => {
		const repoName = "acme/warm";
		const intervalMs = 1_000;
		const requests: string[] = [];
		let releaseFirst: () => void = () => {};
		const firstHeld = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let repoReads = 0;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const local =
				url.startsWith("http://127.0.0.1") ||
				url.startsWith("http://localhost");
			if (!local) {
				requests.push(url);
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				repoReads += 1;
				await firstHeld;
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 4,
							title: "Ticket 4",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/4`,
							updated_at: "2026-10-18T12:00:00.000Z",
						},
					],
					null,
					{ etag: '"warm-issues"' },
				);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: intervalMs / 1_000,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-warm-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table snapshots (
				snapshot_key text primary key,
				name text not null,
				tracker text not null,
				payload text not null
			)
		`);
		seeded
			.query(
				"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
			)
			.run(
				`github:${repoName}`,
				repoName,
				"github",
				JSON.stringify({
					tickets: [
						{
							id: "4",
							tracker: "github",
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "open",
							stateReason: null,
							updatedAt: "2026-10-18T12:00:00.000Z",
							ref: `${repoName}#4`,
							body: "",
							blockedBy: [],
							milestone: null,
							parent: null,
							labels: [],
						},
					],
					pulls: [],
					branches: [],
					startedKeys: [],
				}),
			);
		seeded.run(`
			create table project_polls (
				project text primary key,
				fetched_at text not null
			)
		`);
		seeded
			.query("insert into project_polls (project, fetched_at) values (?, ?)")
			.run(repoName, "2026-10-18T12:00:00.000Z");
		seeded.close();
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const opened = await fetch(new URL("/api/overview", base));
					expect(opened.status).toBe(200);
					const before = (await opened.json()) as Overview;
					expect(before.projects.map((project) => project.name)).toEqual([
						repoName,
					]);
					await Bun.sleep(intervalMs + 250);
					const during = repoReads;
					expect(during).toBe(1);
					releaseFirst();
					await Bun.sleep(50);
					expect(repoReads).toBeLessThan(3);
					const after = await fetch(new URL("/api/overview", base));
					expect(after.status).toBe(200);
					const kept = (await after.json()) as Overview;
					expect(kept.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "backlog",
							blockers: [],
							lane: "Backlog",
							statusType: "backlog",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					resolve();
				})().catch((error: unknown) => {
					releaseFirst();
					reject(error);
				});
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: recordedFetch,
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releaseFirst();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a restart with a good-poll time and an empty snapshot reads the issue list without since", async () => {
		const repoName = "acme/empty-poll";
		const issueUpdatedAt = "2026-09-01T12:00:00.000Z";
		const repoReads: { since: string | null }[] = [];
		let issuePhase: "empty" | "recovered" = "empty";
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { since?: string | null };
				};
				const since = parsed.variables?.since;
				repoReads.push({
					since: since === undefined || since === null ? null : String(since),
				});
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				if (issuePhase === "empty") {
					return page([], null);
				}
				return page(
					[
						{
							number: 9,
							title: "Ticket 9",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/9`,
							updated_at: issueUpdatedAt,
						},
					],
					null,
				);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-empty-poll-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFill: () => void = () => {};
		const fillStopped = new Promise<void>((resolve) => {
			stopFill = resolve;
		});
		let filled: (base: string) => void = () => {};
		const fill = new Promise<string>((resolve) => {
			filled = resolve;
		});
		const fillRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch,
				readGhToken: async () => null,
				databasePath,
				stdout: filled,
				waitForStop: fillStopped,
			}),
		);
		let stopRestart: () => void = () => {};
		const restartStopped = new Promise<void>((resolve) => {
			stopRestart = resolve;
		});
		let restartRun: Promise<unknown> = Promise.resolve();
		try {
			const base = await fill;
			const emptyOverview = await fetch(new URL("/api/overview", base));
			expect(emptyOverview.status).toBe(200);
			const emptyBody = (await emptyOverview.json()) as Overview;
			expect(emptyBody.projects[0]?.tickets).toEqual([]);
			expect(emptyBody.error).toBeNull();
			expect(repoReads).toEqual([{ since: null }]);
			stopFill();
			await fillRun;
			repoReads.length = 0;
			issuePhase = "recovered";
			const recovered = new Promise<void>((resolve, reject) => {
				restartRun = run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo(
						{
							env: { GITHUB_TOKEN: "recorded-token" },
							fetch: recordedFetch,
							readGhToken: async () => null,
							databasePath,
							stdout: (line) => {
								void (async () => {
									const deadline = Date.now() + 3_000;
									let overviewBody = await readOverview(line);
									while (
										overviewBody.polling === true ||
										(repoReads.length === 0 && Date.now() < deadline)
									) {
										await Bun.sleep(20);
										overviewBody = await readOverview(line);
									}
									expect(repoReads).toEqual([{ since: null }]);
									expect(overviewBody.error).toBeNull();
									expect(overviewBody.projects[0]?.tickets).toEqual([
										{
											key: `${repoName}#9`,
											title: "Ticket 9",
											state: "backlog",
											blockers: [],
											lane: "Backlog",
											statusType: "backlog",
											enteredStateAt: issueUpdatedAt,
											updatedAt: issueUpdatedAt,
										},
									]);
									const project = await fetch(
										new URL(
											`/api/projects/${encodeURIComponent(repoName)}`,
											line,
										),
									);
									expect(project.status).toBe(200);
									const report = (await project.json()) as ProjectReport;
									expect(report.tickets.map((ticket) => ticket.key)).toEqual([
										`${repoName}#9`,
									]);
									expect(report.total).toBe(1);
									resolve();
								})().catch(reject);
							},
							waitForStop: restartStopped,
						},
						{ first: true },
					),
				).then((result) => {
					reject(
						new Error(
							`app exited ${result.exitCode} before the recovered overview: ${result.stderr}`,
						),
					);
					return result;
				}, reject);
			});
			await recovered;
			stopRestart();
			const result = await restartRun;
			expect(result).toMatchObject({ exitCode: 0, stderr: "" });
		} finally {
			stopFill();
			stopRestart();
			await fillRun;
			await restartRun;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a start with a good-poll time and no snapshot reads the issue list without since", async () => {
		const repoName = "acme/missing-row";
		const issueUpdatedAt = "2026-09-01T12:00:00.000Z";
		const goodPollAt = "2026-10-18T12:00:00.000Z";
		const repoReads: { since: string | null }[] = [];
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { since?: string | null };
				};
				const since = parsed.variables?.since;
				repoReads.push({
					since: since === undefined || since === null ? null : String(since),
				});
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 9,
							title: "Ticket 9",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/9`,
							updated_at: issueUpdatedAt,
						},
					],
					null,
				);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-missing-row-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table project_polls (
				project text primary key,
				fetched_at text not null
			)
		`);
		seeded
			.query("insert into project_polls (project, fetched_at) values (?, ?)")
			.run(repoName, goodPollAt);
		seeded.close();
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const deadline = Date.now() + 3_000;
					let overviewBody = await readOverview(base);
					while (
						overviewBody.polling === true ||
						(repoReads.length === 0 && Date.now() < deadline)
					) {
						await Bun.sleep(20);
						overviewBody = await readOverview(base);
					}
					expect(repoReads).toEqual([{ since: null }]);
					expect(overviewBody.error).toBeNull();
					expect(overviewBody.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#9`,
							title: "Ticket 9",
							state: "backlog",
							blockers: [],
							lane: "Backlog",
							statusType: "backlog",
							enteredStateAt: issueUpdatedAt,
							updatedAt: issueUpdatedAt,
						},
					]);
					const project = await fetch(
						new URL(`/api/projects/${encodeURIComponent(repoName)}`, base),
					);
					expect(project.status).toBe(200);
					const report = (await project.json()) as ProjectReport;
					expect(report.tickets.map((ticket) => ticket.key)).toEqual([
						`${repoName}#9`,
					]);
					expect(report.total).toBe(1);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: recordedFetch,
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a tracked repo whose issues a tracked board claims keeps incremental reads", async () => {
		const projectId = "PVT_claimed_repo";
		const repoName = "acme/claimed-repo";
		const issueUpdatedAt = "2026-10-18T12:00:00.000Z";
		const repoReads: { since: string | null }[] = [];
		const claimed: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { since?: string | null };
				};
				const since = parsed.variables?.since;
				repoReads.push({
					since: since === undefined || since === null ? null : String(since),
				});
				const listed = await repoReadFromHandler(input, init, claimed);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 9,
							title: "Ticket 9",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/9`,
							updated_at: issueUpdatedAt,
						},
					],
					null,
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
				return new Response(
					JSON.stringify({
						data: {
							repositoryOwner: {
								projectV2: {
									id: projectId,
									number: 4,
									title: "Claimed board",
									closed: false,
									updatedAt: "2026-08-18T12:00:00Z",
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
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
												title: "Ticket 9",
												state: "OPEN",
												stateReason: null,
												updatedAt: issueUpdatedAt,
												repository: { nameWithOwner: repoName },
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
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", owner: "acme", project: 4 },
					{ tracker: "github", repo: repoName },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-claimed-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		let ready: (base: string) => void = () => {};
		const opened = new Promise<string>((resolve) => {
			ready = resolve;
		});
		const started = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: claimed,
				readGhToken: async () => null,
				databasePath,
				stdout: ready,
				waitForStop: stopped,
			}),
		);
		try {
			const base = await opened;
			const first = await settledOverview(base, readOverview);
			expect(first.error).toBeNull();
			expect(
				first.projects.find((project) => project.name === repoName)?.tickets,
			).toEqual([]);
			expect(
				first.projects.find((project) => project.name === "Claimed board")
					?.tickets,
			).toEqual([
				{
					key: `${repoName}#9`,
					title: "Ticket 9",
					state: "backlog",
					blockers: [],
					lane: "Backlog",
					statusType: "backlog",
					enteredStateAt: issueUpdatedAt,
					updatedAt: issueUpdatedAt,
				},
			]);
			expect(repoReads).toEqual([{ since: null }]);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const deadline = Date.now() + 3_000;
			while (repoReads.length < 2 && Date.now() < deadline) {
				await Bun.sleep(20);
			}
			const second = await settledOverview(base, readOverview);
			expect(second.error).toBeNull();
			const fetchedAt = first.projects.find(
				(project) => project.name === repoName,
			)?.fetchedAt;
			if (fetchedAt == null) {
				throw new Error("missing fetchedAt");
			}
			expect(repoReads[1]).toEqual({ since: fetchedAt });
			expect(repoReads[1]?.since).not.toBeNull();
		} finally {
			stop();
			await started;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a genuinely empty tracked project full-reads again on the next poll", async () => {
		const repoName = "acme/genuinely-empty";
		const repoReads: { since: string | null }[] = [];
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { since?: string | null };
				};
				const since = parsed.variables?.since;
				repoReads.push({
					since: since === undefined || since === null ? null : String(since),
				});
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page([], null);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-empty-again-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		let ready: (base: string) => void = () => {};
		const opened = new Promise<string>((resolve) => {
			ready = resolve;
		});
		const started = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch,
				readGhToken: async () => null,
				databasePath,
				stdout: ready,
				waitForStop: stopped,
			}),
		);
		try {
			const base = await opened;
			const first = await settledOverview(base, readOverview);
			expect(first.error).toBeNull();
			expect(first.projects[0]?.tickets).toEqual([]);
			expect(repoReads).toEqual([{ since: null }]);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const deadline = Date.now() + 3_000;
			while (repoReads.length < 2 && Date.now() < deadline) {
				await Bun.sleep(20);
			}
			const second = await settledOverview(base, readOverview);
			expect(second.error).toBeNull();
			expect(second.projects[0]?.tickets).toEqual([]);
			expect(repoReads[1]).toEqual({ since: null });
		} finally {
			stop();
			await started;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a repeated GitHub REST read sends If-None-Match and a 304 keeps the stored data", async () => {
		const repoName = "acme/validator";
		const labelsEtag = '"recorded-labels-etag"';
		const factoryLabels = [
			{ name: "ready", color: "0e8a16" },
			{ name: "factory: running", color: "1d76db" },
			{ name: "factory: in-review", color: "fbca04" },
		];
		const sent: { url: string; headers: Headers }[] = [];
		let labelReads = 0;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			sent.push({ url, headers: new Headers(init?.headers) });
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 4,
							title: "Ticket 4",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/4`,
							updated_at: "2026-10-18T12:00:00.000Z",
							labels: [{ name: "factory: running", color: "1d76db" }],
						},
					],
					null,
				);
			}
			if (url.includes(`/repos/${repoName}/issues/events?`)) {
				return page([], null);
			}
			if (url.includes(`/repos/${repoName}/labels?`)) {
				labelReads += 1;
				if (labelReads > 1) {
					return new Response(null, {
						status: 304,
						headers: { etag: labelsEtag },
					});
				}
				return page(factoryLabels, null, {
					etag: labelsEtag,
				});
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				if (listed?.ok) {
					const payload = (await listed.json()) as {
						data: { repository: { labels: { nodes: unknown[] } } };
					};
					payload.data.repository.labels.nodes = factoryLabels;
					return Response.json(payload);
				}
				if (listed !== null) {
					return listed;
				}
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-validator-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFirst: () => void = () => {};
		const firstStopped = new Promise<void>((resolve) => {
			stopFirst = resolve;
		});
		let firstReady: () => void = () => {};
		const firstListening = new Promise<void>((resolve) => {
			firstReady = resolve;
		});
		const firstRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch,
				readGhToken: async () => null,
				databasePath,
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: firstReady,
				waitForStop: firstStopped,
			}),
		);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const opened = await fetch(new URL("/api/overview", base));
					expect(opened.status).toBe(200);
					const labelDeadline = Date.now() + 3_000;
					while (labelReads < 2 && Date.now() < labelDeadline) {
						await Bun.sleep(20);
					}
					const after = (await opened.json()) as Overview;
					expect(after.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "inProgress",
							blockers: [],
							lane: "factory: running",
							statusType: "inProgress",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					const labelReadsSent = sent.filter((item) =>
						item.url.includes(`/repos/${repoName}/labels?`),
					);
					expect(labelReadsSent.length).toBeGreaterThan(1);
					expect(labelReadsSent[1]?.url).toBe(labelReadsSent[0]?.url);
					expect(labelReadsSent[0]?.headers.get("if-none-match")).toBeNull();
					expect(after.projects[0]?.error).toBeNull();
					const again = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(again.status).toBe(204);
					const kept = await fetch(new URL("/api/overview", base));
					const keptBody = (await kept.json()) as Overview;
					expect(keptBody.projects[0]?.tickets).toEqual(
						after.projects[0]?.tickets,
					);
					const failed = await fetch(new URL("/api/projects/%20", base));
					expect(failed.status).toBe(404);
					resolve();
				})().catch(reject);
			};
		});
		try {
			await firstListening;
			stopFirst();
			const first = await firstRun;
			expect(first.exitCode).toBe(0);
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			stopFirst();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an overview request returns 200 while another connection holds a write", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table snapshots (
				snapshot_key text primary key,
				name text not null,
				tracker text not null,
				payload text not null
			)
		`);
		seeded
			.query(
				"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
			)
			.run(
				"github:acme/widget",
				"acme/widget",
				"github",
				JSON.stringify({
					tickets: [],
					pulls: [],
					branches: [],
					startedKeys: [],
				}),
			);
		seeded.close();
		let releaseTracker: () => void = () => {};
		const trackerHeld = new Promise<void>((resolve) => {
			releaseTracker = resolve;
		});
		const writer = new Database(databasePath);
		let held = false;
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					writer.run("begin exclusive");
					held = true;
					const response = await fetch(new URL("/api/overview", base));
					writer.run("rollback");
					held = false;
					expect(response.status).toBe(200);
					const body = (await response.json()) as {
						projects: { name: string }[];
						error: string | null;
					};
					expect(body.error).toBeNull();
					expect(body.projects.map((project) => project.name)).toEqual([
						"acme/widget",
					]);
					releaseTracker();
					resolve();
				})().catch((error: unknown) => {
					releaseTracker();
					reject(error);
				});
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: async (input, init) => {
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
							await trackerHeld;
							if (url.includes(`/repos/${repo}/issues?`)) {
								return page([ticket(5, "open", null)], null);
							}
							return emptyList(url) ?? unrecorded(input);
						},
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releaseTracker();
			if (held) {
				writer.run("rollback");
			}
			writer.close();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
