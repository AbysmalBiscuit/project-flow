import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import {
	missingToken,
	readGhAuthToken,
	rejectedToken,
	run,
} from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	repoReadIssues,
	repoReadResponse,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const valid = JSON.stringify({
	pinned: [{ tracker: "github", repo: "acme/widget" }],
});

function recordedFetch(userStatus: number): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ message: "recorded" }), {
				status: userStatus,
			});
		}
		if (
			url.includes("/issues?") ||
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?") ||
			url.includes("/check-runs") ||
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			/\/pulls\/\d+$/.test(url)
		) {
			return new Response(
				url.includes("/check-runs") ? '{"check_runs":[]}' : "[]",
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
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
				{ status: 200 },
			);
		}
		if (url === "https://api.linear.app/graphql") {
			return new Response(JSON.stringify({ data: { viewer: { id: "lev" } } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return unrecorded(input);
	};
}

describe("startup", () => {
	test("a Linear-only configuration with a gh token shows a linked open PR in review", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { "acme/widget": ["grok"] },
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-startup-"));
		const authorizations: string[] = [];
		const fetchImpl = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const url = urlOf(input);
				const sent = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					sent.includes("query RepoRead")
				) {
					return new Response(
						JSON.stringify(
							repoReadIssues("acme", "widget", [], {
								pulls: [
									{
										number: 83,
										title: "PR 83",
										url: "https://github.com/acme/widget/pull/83",
										isDraft: false,
										body: "",
										state: "OPEN",
										mergedAt: null,
										headRefName: "83-feat-review",
										headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
										closingIssuesReferences: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										reviews: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										comments: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										reactions: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
									},
								],
							}),
						),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const authorization = new Headers(init?.headers).get("authorization");
				if (authorization !== null) {
					authorizations.push(authorization);
				}
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return new Response(
						JSON.stringify({
							number: 83,
							title: "PR 83",
							state: "open",
							draft: false,
							html_url: "https://github.com/acme/widget/pull/83",
							head: {
								ref: "83-feat-review",
								sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							},
							body: "",
							merged_at: null,
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return new Response(JSON.stringify({ check_runs: [] }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (url.includes("/commits/")) {
					return new Response(
						JSON.stringify({
							commit: { committer: { date: "2026-10-01T00:00:00Z" } },
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (url.includes("/pulls?state=closed")) {
					return new Response("[]", {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return new Response("[]", {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return unrecorded(input);
			},
		});
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
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => "gh-printed-token",
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			const body = await checks;
			expect(body.projects[0]).toMatchObject({
				name: "Widget launch",
				tracker: "linear",
				inReview: 1,
				tickets: [{ key: "WID-8", state: "inReview" }],
			});
			expect(authorizations).toContain("Bearer gh-printed-token");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear-only configuration with a blank gh token starts and leaves the linked PR off the ticket", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-startup-"));
		const fetchImpl = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async () => {
				throw new Error("GitHub must not be called for a blank gh token");
			},
		});
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
					env: { GITHUB_TOKEN: "   ", LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => "   ",
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			const body = await checks;
			expect(body.projects[0]).toMatchObject({
				tracker: "linear",
				error: null,
				inReview: 0,
				tickets: [{ key: "WID-8", state: "backlog" }],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear-only configuration with a rejected gh token exits 1", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: linearFake({
						github: async (input) => {
							const url = urlOf(input);
							if (url === "https://api.github.com/user") {
								return new Response(
									JSON.stringify({ message: "Bad credentials" }),
									{ status: 401 },
								);
							}
							throw new Error(`unexpected GitHub call: ${url}`);
						},
					}),
					readGhToken: async () => "rejected-gh-token",
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(rejectedToken);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("a Linear-only configuration starts without GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{
						tracker: "linear",
						project: "widget-launch-0d42ae5d46d0",
					},
				],
			}),
		);
		const fetchImpl = linearFake({
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				throw new Error("GitHub must not be called without a token");
			},
		});
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("an empty configuration with a rejected GITHUB_TOKEN exits 1", async () => {
		const { path, cleanup } = await tempConfig("{}");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "rejected-token" },
					fetch: async (input) => {
						const url = urlOf(input);
						if (url === "https://api.github.com/user") {
							return new Response(
								JSON.stringify({ message: "Bad credentials" }),
								{ status: 401 },
							);
						}
						throw new Error(`unexpected tracker call: ${url}`);
					},
					readGhToken: async () => {
						throw new Error("gh must not run when GITHUB_TOKEN is set");
					},
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(rejectedToken);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("an empty pinned list starts without GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stderr).toBe("");
		} finally {
			await cleanup();
		}
	});

	test("a missing token serves and names GITHUB_TOKEN on the pinned project", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join("/var/tmp", "project-flow-startup-"));
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
					env: {},
					fetch: recordedFetch(401),
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
			expect(body.projects[0]?.error).toBe(missingToken);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a missing gh executable serves and names GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const bin = await mkdtemp(join("/var/tmp", "project-flow-no-gh-"));
		const root = await mkdtemp(join("/var/tmp", "project-flow-startup-"));
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
					env: { PATH: bin },
					fetch: recordedFetch(200),
					readGhToken: readGhAuthToken,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.listened).toBe(true);
			const body = await checks;
			expect(body.projects[0]?.error).toBe(missingToken);
		} finally {
			await cleanup();
			await rm(bin, { recursive: true, force: true });
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a rejected token exits 1 and names GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "rejected-token" },
					fetch: recordedFetch(401),
					readGhToken: async () => {
						throw new Error("gh must not run when GITHUB_TOKEN is set");
					},
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(rejectedToken);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("without --open the injected opener is not called", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: async (url) => {
						opened.push(url);
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
			expect(opened).toEqual([]);
		} finally {
			await cleanup();
		}
	});

	test("--open opens the printed URL once after the server listens", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: async (url) => {
						opened.push(url);
						const page = await fetch(url);
						expect(page.ok).toBe(true);
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
			expect(opened).toEqual([result.stdout]);
		} finally {
			await cleanup();
		}
	});

	test("a failed opener prints one warning and the API still answers", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: async (url) => {
						opened.push(url);
						const page = await fetch(new URL("/api/overview", url));
						expect(page.ok).toBe(true);
						throw new Error("browser missing");
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stderr).toBe("warning: could not open the browser");
			expect(opened).toEqual([result.stdout]);
		} finally {
			await cleanup();
		}
	});

	test("--open=false does not open the browser", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open=false"],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: async (url) => {
						opened.push(url);
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(opened).toEqual([]);
		} finally {
			await cleanup();
		}
	});

	test("--open with a failing browser command warns and the API still answers", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const bin = await mkdtemp(join("/var/tmp", "project-flow-bad-browser-"));
		for (const name of ["powershell.exe", "wslview", "xdg-open"]) {
			const program = join(bin, name);
			await writeFile(program, "#!/bin/sh\nexit 1\n");
			await chmod(program, 0o755);
		}
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<boolean>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then((page) => resolve(page.ok))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: { PATH: bin },
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stderr).toBe("warning: could not open the browser");
			expect(await checks).toBe(true);
		} finally {
			await cleanup();
			await rm(bin, { recursive: true, force: true });
		}
	});

	test("repeated --open opens the printed URL once", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open", "--open"],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: async (url) => {
						opened.push(url);
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(opened).toEqual([result.stdout]);
		} finally {
			await cleanup();
		}
	});

	test("a non-ok token check logs the status and keeps listening", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join("/var/tmp", "project-flow-startup-"));
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
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(500),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(true);
			expect((await checks).projects[0]?.name).toBe("acme/widget");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank --config exits 1 and does not listen", async () => {
		const result = await run(
			["--config", "   "],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
			}),
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--config");
		expect(result.listened).toBe(false);
	});

	test("an empty --config exits 1 and does not listen", async () => {
		const result = await run(
			["--config"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
			}),
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--config");
		expect(result.listened).toBe(false);
	});

	test("repeated spaces in --config still create the named file", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-config-"));
		const path = join(root, "spaced config.json");
		const store = join(root, "store");
		try {
			const result = await run(
				["--config", `  ${path}  `],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					listCheckouts: async () => [],
					databasePath: join(store, "project-flow.sqlite"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await Bun.file(path).text()).toBe("{}\n");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank GITHUB_TOKEN serves and names the token", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join("/var/tmp", "project-flow-startup-"));
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
					env: { GITHUB_TOKEN: "   " },
					fetch: recordedFetch(200),
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
			expect(body.projects[0]?.error).toBe(missingToken);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty --port exits 1 and does not listen", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(
				["--config", path, "--port"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("--port");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a non-numeric --port exits 1 and does not listen", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(
				["--config", path, "--port", "nope"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("--port");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a blank notification trigger names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget" }],
				notificationTriggers: { needsYou: "" },
			}),
		);
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.listened).toBe(false);
			expect(result.stderr).toContain("notificationTriggers.needsYou");
		} finally {
			await cleanup();
		}
	});

	test("a configuration with noSenior exits 1 and names the field", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget" }],
				noSenior: { "acme/widget": true },
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("noSenior");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("an empty pmBot map starts and serves the overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget" }],
				pmBot: {},
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-startup-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<number>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/overview", base))
					.then((response) => resolve(response.status))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(await checks).toBe(200);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an invalid configuration exits 1 and names the field", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget", extra: true }],
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pinned.0.extra");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a configuration with no Linear pin starts when the Linear viewer query returns HTTP 500", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join("/var/tmp", "project-flow-startup-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<{ status: number; body: Overview }>(
			(resolve, reject) => {
				startChecks = (base: string) => {
					void (async () => {
						const response = await fetch(new URL("/api/overview", base));
						resolve({
							status: response.status,
							body: (await response.json()) as Overview,
						});
					})().catch(reject);
				};
			},
		);
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.linear.app/graphql") {
				return new Response("linear down", { status: 500 });
			}
			return recordedFetch(200)(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			const overview = await checks;
			expect(overview.status).toBe(200);
			expect(overview.body.projects.length).toBeGreaterThan(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a GitHub-only configuration starts without a Linear key", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-data-"));
		const databasePath = join(root, "github-only.sqlite");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					databasePath,
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a missing configuration file is created as {} and serves the overview", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-config-"));
		const path = join(root, "config.json");
		const store = join(root, "store");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<{ status: number; body: unknown }>(
			(resolve, reject) => {
				startChecks = (base: string) => {
					void (async () => {
						const response = await fetch(new URL("/api/overview", base));
						resolve({ status: response.status, body: await response.json() });
					})().catch(reject);
				};
			},
		);
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					listCheckouts: async () => [],
					databasePath: join(store, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe(`created configuration file: ${path}`);
			expect(result.exitCode).toBe(0);
			expect(await Bun.file(path).text()).toBe("{}\n");
			const overview = await checks;
			expect(overview.status).toBe(200);
			expect(overview.body).toMatchObject({ projects: [], error: null });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a directory at the configuration path is not created over", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-config-"));
		const path = join(root, "config-dir");
		await mkdir(path);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					listCheckouts: async () => [],
					databasePath: join(root, "store", "project-flow.sqlite"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(`configuration file cannot be read: ${path}`);
			expect(result.listened).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a start creates the missing parent folder of the configuration file", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-config-"));
		const path = join(root, "missing", "nested", "config.json");
		const store = join(root, "store");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					listCheckouts: async () => [],
					databasePath: join(store, "project-flow.sqlite"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await Bun.file(path).text()).toBe("{}\n");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a missing store directory is created for the run", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-data-"));
		const databasePath = join(root, "missing", "project-flow.sqlite");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					databasePath,
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await Bun.file(databasePath).exists()).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a restart serves the cached overview before a blocked tracker request completes", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join("/var/tmp", "project-flow-cache-open-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFill: () => void = () => {};
		const fillStopped = new Promise<void>((resolve) => {
			stopFill = resolve;
		});
		let filled: () => void = () => {};
		const fill = new Promise<void>((resolve) => {
			filled = resolve;
		});
		const fillRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
				databasePath,
				stdout: filled,
				waitForStop: fillStopped,
			}),
		);
		let releaseTracker: () => void = () => {};
		const trackerHeld = new Promise<void>((resolve) => {
			releaseTracker = resolve;
		});
		let trackerCompleted = 0;
		const blockingFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (
				url.startsWith("http://127.0.0.1") ||
				url.startsWith("http://localhost")
			) {
				return fetch(input, init);
			}
			await trackerHeld;
			trackerCompleted += 1;
			return recordedFetch(200)(input, init);
		};
		let stopRestart: () => void = () => {};
		const restartStopped = new Promise<void>((resolve) => {
			stopRestart = resolve;
		});
		let restartRun: Promise<unknown> = Promise.resolve();
		try {
			await fill;
			stopFill();
			await fillRun;
			const first = await new Promise<Overview>((resolve, reject) => {
				restartRun = run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo(
						{
							env: { GITHUB_TOKEN: "recorded-token" },
							fetch: blockingFetch,
							readGhToken: async () => null,
							databasePath,
							stdout: (line) => {
								void fetch(new URL("/api/overview", line))
									.then(async (response) => {
										expect(response.status).toBe(200);
										resolve((await response.json()) as Overview);
									})
									.catch((error: unknown) => {
										reject(error);
									});
							},
							waitForStop: restartStopped,
						},
						{ first: true },
					),
				);
			});
			expect(trackerCompleted).toBe(0);
			expect(first.projects.map((project) => project.name)).toEqual([
				"acme/widget",
			]);
			expect(first.fetchedAt).not.toBeNull();
		} finally {
			releaseTracker();
			stopFill();
			stopRestart();
			await restartRun;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a thrown token check logs the error and keeps serving", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join("/var/tmp", "project-flow-token-throw-"));
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
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				throw new Error("token check timed out");
			}
			return recordedFetch(200)(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("token check timed out");
			expect(result.listened).toBe(true);
			expect((await checks).projects[0]?.name).toBe("acme/widget");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank token check error still logs and keeps serving", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join("/var/tmp", "project-flow-token-blank-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<number>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then((response) => resolve(response.status))
					.catch(reject);
			};
		});
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				throw "   ";
			}
			return recordedFetch(200)(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "   " },
					fetch: fetchImpl,
					readGhToken: async () => "recorded-token",
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("credential check failed");
			expect(result.listened).toBe(true);
			expect(await checks).toBe(200);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a 503 Linear key check logs the status and keeps serving the cache", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" }],
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-linear-503-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFill: () => void = () => {};
		const fillStopped = new Promise<void>((resolve) => {
			stopFill = resolve;
		});
		let filled: () => void = () => {};
		const fill = new Promise<void>((resolve) => {
			filled = resolve;
		});
		const fillRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { LINEAR_API_KEY: "recorded-linear-key" },
				fetch: linearFake(),
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
		const unavailable: Fetch = async (input, init) => {
			if (urlOf(input) === "https://api.linear.app/graphql") {
				return new Response("unavailable", { status: 503 });
			}
			return linearFake()(input, init);
		};
		let restartRun: Promise<unknown> = Promise.resolve();
		try {
			await fill;
			stopFill();
			await fillRun;
			const overview = await new Promise<Overview>((resolve, reject) => {
				restartRun = run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo(
						{
							env: { LINEAR_API_KEY: "recorded-linear-key" },
							fetch: unavailable,
							readGhToken: async () => null,
							databasePath,
							stdout: (line) => {
								void fetch(new URL("/api/overview", line))
									.then(async (response) => {
										expect(response.status).toBe(200);
										resolve((await response.json()) as Overview);
									})
									.catch(reject);
							},
							waitForStop: restartStopped,
						},
						{ first: true },
					),
				);
			});
			expect(overview.projects.map((project) => project.name)).toEqual([
				"Widget launch",
			]);
			stopRestart();
			const result = await restartRun;
			expect(result).toMatchObject({ exitCode: 0, listened: true });
			if (
				typeof result === "object" &&
				result !== null &&
				"stderr" in result &&
				typeof result.stderr === "string"
			) {
				expect(result.stderr).toContain("HTTP 503");
			}
		} finally {
			stopFill();
			stopRestart();
			await restartRun;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a 503 token check keeps serving the cached overview", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join("/var/tmp", "project-flow-token-503-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFill: () => void = () => {};
		const fillStopped = new Promise<void>((resolve) => {
			stopFill = resolve;
		});
		let filled: () => void = () => {};
		const fill = new Promise<void>((resolve) => {
			filled = resolve;
		});
		const fillRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
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
			await fill;
			stopFill();
			await fillRun;
			const overview = await new Promise<Overview>((resolve, reject) => {
				restartRun = run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo(
						{
							env: { GITHUB_TOKEN: "recorded-token" },
							fetch: recordedFetch(503),
							readGhToken: async () => null,
							databasePath,
							stdout: (line) => {
								void fetch(new URL("/api/overview", line))
									.then(async (response) => {
										expect(response.status).toBe(200);
										resolve((await response.json()) as Overview);
									})
									.catch(reject);
							},
							waitForStop: restartStopped,
						},
						{ first: true },
					),
				).then((result) => {
					reject(
						new Error(
							`app exited ${result.exitCode} before the overview was served: ${result.stderr}`,
						),
					);
					return result;
				}, reject);
			});
			expect(overview.projects.map((project) => project.name)).toEqual([
				"acme/widget",
			]);
			stopRestart();
			const result = await restartRun;
			expect(result).toMatchObject({ exitCode: 0, listened: true });
			if (
				typeof result === "object" &&
				result !== null &&
				"stderr" in result &&
				typeof result.stderr === "string"
			) {
				expect(result.stderr).toContain("HTTP 503");
			}
		} finally {
			stopFill();
			stopRestart();
			await restartRun;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
