import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo } from "./support/app.ts";
import { urlOf } from "./support/fetch.ts";
import {
	emptyProjectFields,
	page,
	recordedDiscovery,
	unrecorded,
} from "./support/github.ts";
import { trackFound } from "./support/reads.ts";
import {
	githubIssueNode,
	repoReadIssues,
	repoReadResponse,
} from "./support/repo-read.ts";

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
			if (repo === strangerOrigin || repo === "stranger/stranger-repo") {
				return page([issue(9, repo)]);
			}
			return page([]);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?")
		) {
			return page([]);
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("query RepoRead")
		) {
			const parsed = JSON.parse(body) as {
				variables?: { owner?: string; name?: string };
			};
			const owner = parsed.variables?.owner ?? "";
			const name = parsed.variables?.name ?? "";
			const repo = `${owner}/${name}`;
			requests.push(`https://api.github.com/repos/${repo}/issues?state=all`);
			const issues =
				repo === named ||
				repo === strangerOrigin ||
				repo === "stranger/stranger-repo"
					? [githubIssueNode(issue(9, repo))]
					: [];
			return new Response(JSON.stringify(repoReadIssues(owner, name, issues)), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url === "https://api.github.com/graphql") {
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
		return emptyProjectFields(input, init) ?? unrecorded(input);
	};
}

async function overview(input: {
	files?: Record<string, string>;
	todos?: string;
	requests?: string[];
	linear?: boolean;
	roots?: string;
	fetch?: Fetch;
	tracked?: { tracker: "github"; repo: string }[];
}): Promise<{ body: unknown; requests: string[] }> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const scan = await mkdtemp(join(tmpdir(), "project-flow-scan-"));
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			tracked: input.tracked ?? [],
			checkoutRoots: [input.roots ?? scan],
		}),
	);
	const requests = input.requests ?? [];
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
	inReview: 0,
	awaitingMerge: 0,
	tags: [],
	unlinkedPrs: [],
	fetchedAt: "2026-10-18T12:00:00.000Z",
	error: null,
	statusTypes: {
		backlog: 1,
		inProgress: 0,
		inReview: 0,
		awaitingMerge: 0,
		done: 0,
		dropped: 0,
	},
	tickets: [
		{
			key: `${named}#9`,
			title: "Ticket 9",
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
	ref: { tracker: "github" as const, repo: named },
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
		).toHaveLength(2);
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
		const todo = [
			"## local  only.main.claude-aaaaaaaa",
			"- [ ] Blank ( , pending)",
			"## local-only.9-feat-ship.claude-aaaaaaaa",
			"- [ ] Ship the widget (9-feat-ship, pending)",
			"",
		].join("\n");
		const strangerCard = {
			...card,
			name: strangerOrigin,
			ref: { tracker: "github" as const, repo: strangerOrigin },
			tickets: [
				{
					key: `${strangerOrigin}#9`,
					title: "Ticket 9",
					state: "backlog",
					blockers: [],
					lane: "Backlog",
					statusType: "backlog",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
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
			tracked: false,
		});
		expect(
			withoutTodo.requests.some((request) =>
				request.includes(`/repos/${strangerOrigin}/`),
			),
		).toBe(false);
	});

	test("a started todo under a heading makes its ticket in progress", async () => {
		const { body } = await overview({
			files: {
				"lev/local-only/.git/config": originConfig,
				"lev/local-only/devkit.toml": "",
			},
			todos: [
				"## local-only.main.claude-b71a152a-3479-40ac-85b1-d96e12fc5771",
				"- [ ] Ticket 9 (#9, in progress: human)",
				"## local-only.9-feat-ship.claude-cccccccc",
				"- [ ] Also nine (#9, pending)",
				"",
			].join("\n"),
		});
		expect(body).toEqual({
			projects: [
				{
					...card,
					backlog: 0,
					inProgress: 1,
					tickets: [
						{
							...card.tickets[0],
							state: "inProgress",
							lane: "In progress",
							statusType: "inProgress",
						},
					],
					statusTypes: {
						...card.statusTypes,
						backlog: 0,
						inProgress: 1,
					},
				},
			],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
	});

	test("two session headings for one project name one project", async () => {
		const { body, requests } = await overview({
			files: {
				"stranger/stranger-repo/.git/config": [
					'[remote "origin"]',
					"url = https://github.com/stranger/stranger-repo.git",
					"",
				].join("\n"),
			},
			todos: [
				"## stranger-repo.main.claude-b71a152a-3479-40ac-85b1-d96e12fc5771",
				"- [ ] First (9-feat, pending)",
				"## stranger-repo.main.claude-cccccccccccccccccccccccccccccccccccc",
				"- [ ] Second (9-again, pending)",
				"## stranger-repo",
				"- [ ] Synced (9-synced, pending)",
				"",
			].join("\n"),
		});
		const projects = (body as { projects: { name: string }[] }).projects;
		expect(
			projects.filter((project) => project.name === "stranger/stranger-repo"),
		).toHaveLength(1);
		expect(
			requests.filter((request) =>
				request.includes("/repos/stranger/stranger-repo/issues?"),
			),
		).toHaveLength(1);
	});

	test("a TOML devkit.toml names the project and a JSON file does not", async () => {
		const toml = await overview({
			linear: true,
			files: {
				"other/docs/.git/config":
					'[remote "origin"]\nurl = git@github.com:other/docs.git\n',
				"other/docs/devkit.toml": '[tracker]\nkind = "linear"\n',
			},
			todos: [
				"## docs.WID-4-write-the-docs.claude-aaaaaaaa",
				"- [ ] Write the docs (WID-4, pending)",
				"",
			].join("\n"),
		});
		expect(toml.body).toEqual({
			projects: [
				{
					name: linearName,
					tracker: "linear",
					ref: { tracker: "linear", project: linearPin },
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
							key: "WID-4",
							title: "Write the docs",
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
					fetchedAt: "2026-10-18T12:00:00.000Z",
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
			todos: [
				'[{"project":"docs.WID-4-write-the-docs","status":"pending"}]',
			].join("\n"),
		});
		expect(json.body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
			tracked: false,
		});
	});

	test("a devkit session suffix does not become a Linear lookup", async () => {
		const requests: string[] = [];
		const { body } = await overview({
			linear: true,
			requests,
			files: {
				"other/docs/.git/config":
					'[remote "origin"]\nurl = git@github.com:other/docs.git\n',
				"other/docs/devkit.toml": '[tracker]\nkind = "linear"\n',
			},
			todos: [
				"## docs.main.D2C128F2-575",
				"- [ ] Session (D2C128F2-575, pending)",
				"## docs.main.CLAUDE-69",
				"- [ ] Session (CLAUDE-69, pending)",
				"## docs.feat.agent-12",
				"- [ ] Agent (agent-12, pending)",
				"## docs.WID-4extra.claude-aaaaaaaa",
				"- [ ] Extra (WID-4extra, pending)",
				"##    ",
				"- [ ] Blank ( , pending)",
			].join("\n"),
		});
		expect(body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
			tracked: false,
		});
		expect(requests.some((request) => request.includes("TicketProject"))).toBe(
			false,
		);
		expect(requests.some((request) => request.includes("D2C128F2"))).toBe(
			false,
		);
		expect(requests.some((request) => request.includes("CLAUDE-69"))).toBe(
			false,
		);
		expect(requests.some((request) => request.includes("WID-4"))).toBe(false);
	});

	test("a Linear todo names its open Linear project", async () => {
		const { body } = await overview({
			linear: true,
			files: {
				"other/docs/.git/config":
					'[remote "origin"]\nurl = git@github.com:other/docs.git\n',
				"other/docs/devkit.toml": '[tracker]\nkind = "linear"\n',
			},
			todos: [
				"## docs.WID-4-write-the-docs.claude-aaaaaaaa",
				"- [ ] Write the docs (WID-4, pending)",
				"",
			].join("\n"),
		});
		expect(body).toEqual({
			projects: [
				{
					name: linearName,
					tracker: "linear",
					ref: { tracker: "linear", project: linearPin },
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
							key: "WID-4",
							title: "Write the docs",
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
					fetchedAt: "2026-10-18T12:00:00.000Z",
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
			todos: [
				"##    ",
				"- [ ] Blank ( , pending)",
				"## local  only.9-feat.claude-aaaaaaaa",
				"- [ ] Spaces (9-feat, pending)",
			].join("\n"),
		});
		expect(body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
			tracked: false,
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
			tracked: false,
		});
	});

	test("a Linear worktree branch names its open Linear project without the real home", async () => {
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
						ref: { tracker: "linear", project: linearPin },
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
								key: "WID-4",
								title: "Write the docs",
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
						fetchedAt: "2026-10-18T12:00:00.000Z",
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
			tracked: [{ tracker: "github", repo: named }],
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
			error:
				"GitHub find projects failed (stale since 2026-10-18T12:00:00.000Z)",
		});
	});

	test("a failed GitHub discovery keeps the configured checkout and records the error", async () => {
		const requests: string[] = [];
		const base = localFetch(requests);
		const { body } = await overview({
			requests,
			tracked: [{ tracker: "github", repo: named }],
			fetch: async (input, init) => {
				const bodyText = typeof init?.body === "string" ? init.body : "";
				if (
					urlOf(input) === "https://api.github.com/graphql" &&
					bodyText.includes("ViewerProjects")
				) {
					requests.push(bodyText);
					return new Response(
						JSON.stringify({ errors: [{ message: "viewer unavailable" }] }),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return base(input, init);
			},
			files: {
				"stranger/configured/.git/config":
					'[remote "origin"]\nurl = https://github.com/stranger/configured.git\n',
				"stranger/configured/devkit.toml": `[tracker]\nkind = "github"\n\n[github]\nissues_repo = "${named}"\n`,
			},
		});
		expect(body).toEqual({
			projects: [
				{
					...card,
					fetchedAt: "2026-10-18T12:00:00.000Z",
					error: null,
				},
			],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error:
				"GitHub find projects failed: viewer unavailable (stale since 2026-10-18T12:00:00.000Z)",
		});
		expect(
			requests.some((request) => request.includes(`/repos/${named}/`)),
		).toBe(true);
	});

	test("a blank checkout root and the old env var name no project", async () => {
		const blank = await overview({
			roots: "   ",
			files: {
				"lev/local-only/.git/config": originConfig,
				"lev/local-only/devkit.toml": "",
			},
		});
		expect(blank.body).toEqual({
			projects: [],
			fetchedAt: null,
			error: null,
			tracked: false,
		});
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [], checkoutRoots: [] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const scan = await mkdtemp(join(tmpdir(), "project-flow-scan-"));
		try {
			await mkdir(join(scan, "lev", "local-only", ".git"), { recursive: true });
			await writeFile(
				join(scan, "lev", "local-only", ".git", "config"),
				originConfig,
			);
			await writeFile(join(scan, "lev", "local-only", "devkit.toml"), "");
			let startChecks: (base: string) => void = () => {};
			const checks = new Promise<unknown>((resolve, reject) => {
				startChecks = (base: string) => {
					fetch(new URL("/api/overview", base))
						.then(async (response) => resolve(await response.json()))
						.catch(reject);
				};
			});
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						PROJECT_FLOW_CHECKOUT_ROOTS: scan,
					},
					fetch: localFetch([]),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(await checks).toEqual({
				projects: [],
				fetchedAt: null,
				error: null,
				tracked: false,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
			await rm(scan, { recursive: true, force: true });
		}
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
			tracked: false,
		});
		expect(
			requests.some((request) => request.includes("stranger/upstream")),
		).toBe(false);
	});
});
