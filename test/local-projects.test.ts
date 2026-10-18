import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedDiscovery, tempConfig, testIo, urlOf } from "./support.ts";

const named = "lev/local-only";
const strangerOrigin = "stranger/local-only";
const linearName = "Docs cleanup";
const linearPin = "docs-cleanup-0d42ae5d46d0";

function issue(number: number, repo = named): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-10-18T12:00:00.000Z",
	};
}

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function localFetch(requests: string[]): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			const body = typeof init?.body === "string" ? init.body : "";
			if (body.includes("ViewerProjects")) {
				requests.push(`${urlOf(input)} ${body}`);
			}
			return discovered;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		requests.push(body === "" ? url : `${url} ${body}`);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (url.includes("/repos/") && url.includes("/issues?")) {
			const repo = url.split("/repos/")[1]?.split("/issues?")[0];
			if (repo === named) {
				return page([issue(9)]);
			}
			if (repo === strangerOrigin) {
				return page([issue(9, strangerOrigin)]);
			}
			return page([]);
		}
		if (url.includes("/pulls?") || url.includes("/branches?")) {
			return page([]);
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
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (url === "https://api.linear.app/graphql") {
			if (body.includes("MemberProjects") || body.includes("viewer")) {
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
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (body.includes("ProjectIssues")) {
				return new Response(
					JSON.stringify({
						data: {
							issues: {
								nodes: [
									{
										identifier: "WID-4",
										title: "Write the docs",
										state: { type: "backlog" },
										updatedAt: "2026-10-18T12:00:00.000Z",
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (body.includes("TicketProject")) {
				return new Response(
					JSON.stringify({
						data: {
							issue: {
								identifier: "WID-4",
								project: {
									id: "project-docs",
									name: linearName,
									slugId: linearPin,
									state: "started",
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (body.includes("ProjectByPin")) {
				return new Response(
					JSON.stringify({
						data: {
							projects: {
								nodes: [
									{
										id: "project-docs",
										name: linearName,
										slugId: linearPin,
									},
								],
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({ data: { projects: { nodes: [] } } }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return new Response("not recorded", { status: 404 });
	};
}

async function overview(input: {
	files?: Record<string, string>;
	todos?: string;
	requests?: string[];
	linear?: boolean;
	roots?: string;
	fetch?: Fetch;
}): Promise<{ body: unknown; requests: string[] }> {
	const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const scan = await mkdtemp(join(tmpdir(), "project-flow-scan-"));
	const requests = input.requests ?? [];
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
		for (const [relative, body] of Object.entries(input.files ?? {})) {
			const file = join(scan, relative);
			await mkdir(join(file, ".."), { recursive: true });
			await writeFile(file, body);
		}
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					...(input.linear === true
						? { LINEAR_API_KEY: "recorded-linear-key" }
						: {}),
					PROJECT_FLOW_CHECKOUT_ROOTS: input.roots ?? scan,
				},
				fetch: input.fetch ?? localFetch(requests),
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checks.then(() => undefined),
				...(input.todos === undefined
					? {}
					: { listTodos: async () => input.todos ?? "" }),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		return { body: await checks, requests };
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
		await rm(scan, { recursive: true, force: true });
	}
}

const card = {
	name: named,
	tracker: "github",
	done: 0,
	dropped: 0,
	blocked: 0,
	backlog: 1,
	inProgress: 0,
	unlinkedPrs: [],
	tickets: [
		{
			key: `${named}#9`,
			title: "Ticket 9",
			state: "backlog",
			blockers: [],
		},
	],
	crossProjectBlockers: [],
};

const originConfig = [
	'[remote "origin"]',
	`url = https://github.com/${named}.git`,
	"fetch = +refs/heads/*:refs/remotes/origin/*",
	"",
].join("\n");

describe("local projects", () => {
	test("a project named only by a local checkout appears", async () => {
		const { body, requests } = await overview({
			files: {
				"lev/local-only/.git/config": originConfig,
				"lev/local-only/devkit.toml": "",
			},
		});
		expect(body).toEqual({
			projects: [card],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
		expect(
			requests.some((request) => request.includes(`/repos/${named}/`)),
		).toBe(true);
		expect(
			requests.filter((request) => request.includes("ViewerProjects")),
		).toHaveLength(1);
	});

	test("a project named only by a devkit todo appears", async () => {
		const files = {
			"stranger/local-only/.git/config": [
				'[remote "origin"]',
				`url = https://github.com/${strangerOrigin}.git`,
				"fetch = +refs/heads/*:refs/remotes/origin/*",
				"",
			].join("\n"),
		};
		const todo = JSON.stringify([
			{ project: "   ", status: "pending" },
			{ project: "local  only.9-feat", status: "pending" },
			{
				project: `local-only.9-feat-ship.${"a".repeat(8)}`,
				status: "pending",
				started: false,
			},
			null,
		]);
		const strangerCard = {
			...card,
			name: strangerOrigin,
			tickets: [
				{
					key: `${strangerOrigin}#9`,
					title: "Ticket 9",
					state: "backlog",
					blockers: [],
				},
			],
		};
		const withTodo = await overview({ files, todos: todo });
		expect(withTodo.body).toEqual({
			projects: [strangerCard],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
		expect(
			withTodo.requests.some((request) =>
				request.includes(`/repos/${strangerOrigin}/`),
			),
		).toBe(true);
		expect(JSON.stringify(withTodo.body)).not.toContain(named);
		const withoutTodo = await overview({ files, todos: "[]" });
		expect(withoutTodo.body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
		});
		expect(
			withoutTodo.requests.some((request) =>
				request.includes(`/repos/${strangerOrigin}/`),
			),
		).toBe(false);
	});

	test("a TOML devkit.toml names the project and a JSON file does not", async () => {
		const toml = await overview({
			linear: true,
			files: {
				"other/docs/.git/config":
					'[remote "origin"]\nurl = git@github.com:other/docs.git\n',
				"other/docs/devkit.toml": '[tracker]\nkind = "linear"\n',
			},
			todos: JSON.stringify([
				{ project: "docs.WID-4-write-the-docs", status: "pending" },
			]),
		});
		expect(toml.body).toEqual({
			projects: [
				{
					name: linearName,
					tracker: "linear",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 1,
					inProgress: 0,
					unlinkedPrs: [],
					tickets: [
						{
							key: "WID-4",
							title: "Write the docs",
							state: "backlog",
							blockers: [],
						},
					],
					crossProjectBlockers: [],
				},
			],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
		const githubToml = await overview({
			files: {
				"stranger/configured/.git/config":
					'[remote "origin"]\nurl = https://github.com/stranger/configured.git\n',
				"stranger/configured/devkit.toml": `[tracker]\nkind = "github"\n\n[github]\nissues_repo = "${named}"\n`,
			},
		});
		expect(githubToml.body).toEqual({
			projects: [card],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
		const json = await overview({
			linear: true,
			files: {
				"other/docs/.git/config":
					'[remote "origin"]\nurl = git@github.com:other/docs.git\n',
				"other/docs/devkit.toml": '{"tracker":{"kind":"linear"}}\n',
			},
			todos: JSON.stringify([
				{ project: "docs.WID-4-write-the-docs", status: "pending" },
			]),
		});
		expect(json.body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
		});
	});

	test("a Linear todo names its open Linear project", async () => {
		const { body } = await overview({
			linear: true,
			files: {
				"other/docs/.git/config":
					'[remote "origin"]\nurl = git@github.com:other/docs.git\n',
				"other/docs/devkit.toml": '[tracker]\nkind = "linear"\n',
			},
			todos: JSON.stringify([
				{ project: "docs.WID-4-write-the-docs", status: "pending" },
				null,
			]),
		});
		expect(body).toEqual({
			projects: [
				{
					name: linearName,
					tracker: "linear",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 1,
					inProgress: 0,
					unlinkedPrs: [],
					tickets: [
						{
							key: "WID-4",
							title: "Write the docs",
							state: "backlog",
							blockers: [],
						},
					],
					crossProjectBlockers: [],
				},
			],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
	});

	test("a blank checkout and a repeated-space todo name no project", async () => {
		const { body } = await overview({
			files: {
				"lev/blank/devkit.toml":
					'[tracker]\nkind = "github"\n\n[github]\nissues_repo = "   "\n',
				"lev/blank/.git/config":
					'[remote "origin"]\nurl = https://github.com/not a repo\n',
			},
			todos: JSON.stringify([
				{ project: "   ", status: "pending" },
				{ project: "local  only.9-feat", status: "pending" },
			]),
		});
		expect(body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
		});
	});

	test("a failing checkout read keeps the other projects", async () => {
		const { body } = await overview({
			files: {
				"lev/broken/.git/config": "not a git config [[[",
				"lev/local-only/.git/config": originConfig,
				"lev/local-only/devkit.toml": "",
			},
			todos: "not json",
		});
		expect(body).toEqual({
			projects: [card],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
	});

	test("an untracked file in a checkout does not name a project", async () => {
		const { body } = await overview({
			files: {
				"other/stray/notes.txt": `${named}\n`,
				"other/stray/.git/config":
					'[remote "origin"]\nurl = https://github.com/stranger/upstream.git\n',
			},
		});
		expect(body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
		});
	});

	test("a Linear worktree branch names its open Linear project", async () => {
		const scan = await mkdtemp(join(tmpdir(), "project-flow-worktree-"));
		const checkout = join(scan, "other", "docs");
		try {
			await mkdir(checkout, { recursive: true });
			await writeFile(
				join(checkout, "devkit.toml"),
				'[tracker]\nkind = "linear"\n',
			);
			const init = Bun.spawn(
				[
					"git",
					"-C",
					checkout,
					"init",
					"-q",
					"--separate-git-dir",
					join(scan, "docs.git"),
				],
				{
					env: {
						PATH: process.env.PATH ?? "",
						HOME: process.env.HOME ?? "",
					},
				},
			);
			expect(await init.exited).toBe(0);
			await writeFile(
				join(scan, "docs.git", "HEAD"),
				"ref: refs/heads/wid-7-write\n",
			);
			await writeFile(
				join(scan, "docs.git", "config"),
				`${await Bun.file(join(scan, "docs.git", "config")).text()}[remote "origin"]\nurl = git@github.com:other/docs.git\n`,
			);
			const { body } = await overview({
				linear: true,
				files: {},
				todos: "[]",
				roots: scan,
			});
			expect(body).toEqual({
				projects: [
					{
						name: linearName,
						tracker: "linear",
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 1,
						inProgress: 0,
						unlinkedPrs: [],
						tickets: [
							{
								key: "WID-4",
								title: "Write the docs",
								state: "backlog",
								blockers: [],
							},
						],
						crossProjectBlockers: [],
					},
				],
				fetchedAt: "2026-10-18T12:00:00.000Z",
				error: null,
			});
		} finally {
			await rm(scan, { recursive: true, force: true });
		}
	});

	test("a missing viewer list keeps a configured checkout", async () => {
		const requests: string[] = [];
		const base = localFetch(requests);
		const { body } = await overview({
			requests,
			fetch: async (input, init) => {
				const bodyText = typeof init?.body === "string" ? init.body : "";
				if (
					urlOf(input) === "https://api.github.com/graphql" &&
					bodyText.includes("ViewerProjects")
				) {
					requests.push(bodyText);
					return new Response(JSON.stringify({ data: {} }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return base(input, init);
			},
			files: {
				"stranger/configured/.git/config":
					'[remote "origin"]\nurl = https://github.com/stranger/configured.git\n',
				"stranger/configured/devkit.toml": `[tracker]\nkind = "github"\n\n[github]\nissues_repo = "${named}"\n`,
				"stranger/upstream/.git/config":
					'[remote "origin"]\nurl = https://github.com/stranger/upstream.git\n',
			},
		});
		expect(body).toEqual({
			projects: [card],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
	});

	test("a third-party clone stays hidden", async () => {
		const { body, requests } = await overview({
			files: {
				"stranger/upstream/.git/config":
					'[remote "origin"]\nurl = https://github.com/stranger/upstream.git\n',
				"stranger/upstream/README.md": "third-party\n",
			},
		});
		expect(body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
		});
		expect(
			requests.some((request) => request.includes("stranger/upstream")),
		).toBe(false);
	});
});
