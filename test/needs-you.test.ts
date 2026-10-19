import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NeedsYouItem } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

const linearProject = {
	id: "project-flow",
	name: "Project Flow",
	slugId: "project-flow",
};

function linearIssue(
	identifier: string,
	title: string,
	description: string,
	comments: { body: string; user?: { id: string; name: string } }[] = [],
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title,
		description,
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		labels: { nodes: [] },
		comments: { nodes: comments },
		assignee: null,
		...fields,
	};
}

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("needs you", () => {
	test("lists each spec ask fixture as included or excluded", async () => {
		const included = "Which bot should review this?";
		const named = "This waits on Lev for the signing key.";
		const issues = [
			linearIssue("PF-1", "Open ask", included, [
				{ body: `${included}\n\n${ask("pf-1")}` },
			]),
			linearIssue("PF-2", "Answered ask", "Already settled", [
				{ body: `${ask("pf-2")}\nWhich name?` },
				{ body: "Use the short name.\n\npf-2" },
			]),
			linearIssue("PF-3", "Senior ask", "For the senior", [
				{ body: `Senior, which label stays?\n\n${ask("pf-3")}` },
			]),
			linearIssue("PF-4", "Named escalation", "Escalation", [
				{ body: `Senior, ${named}\n\n${ask("pf-4")}` },
			]),
			linearIssue("PF-5", "Decision record", "Settled", [
				{
					body: `Decision: Lev picked the short name.\n\n${ask("pf-5")}`,
				},
			]),
			linearIssue("PF-6", "Prefix answer", "Answered by prefix", [
				{ body: `${ask("pf-6")}\nKeep the label?` },
				{ body: "Answer: keep it." },
			]),
			linearIssue("PF-7", "Progress picks", "Picked in progress", [
				{ body: `${ask("pf-7")}\nWhich row?` },
				{
					body: "**Workcell progress**\n- ask-pf-7: 2026-08-18T12:00:00Z human picks: 1",
				},
			]),
			linearIssue("PF-8", "Older ask", "Older marker", [
				{ body: `${ask("pf-8")}\nOld question?` },
				{ body: `${ask("pf-8")}\n${included}` },
			]),
		];
		const recorded = linearFake({ project: linearProject, issues });
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "project-flow" }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key).sort()).toEqual([
				"PF-1",
				"PF-4",
				"PF-6",
				"PF-8",
			]);
			expect(items.find((item) => item.key === "PF-1")).toMatchObject({
				headline: included,
				reason: "ask",
				tags: [],
			});
			expect(items.find((item) => item.key === "PF-8")).toMatchObject({
				headline: included,
				reason: "ask",
			});
			expect(items.find((item) => item.key === "PF-4")).toMatchObject({
				headline: named,
				reason: "ask",
				tags: ["matched by name"],
			});
			expect(items.find((item) => item.key === "PF-6")).toMatchObject({
				reason: "ask",
				answered: true,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("lists a named ask in a senior project and omits an unnamed ask", async () => {
		const repo = "acme/widget";
		const named = "This waits on Lev for the signing key.";
		const recorded: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (url === "https://api.github.com/graphql") {
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([
					{
						number: 4,
						title: "Named escalation",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						comments: 2,
						assignee: null,
						labels: [],
					},
					{
						number: 6,
						title: "Answered ask",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						comments: 2,
						assignee: null,
						labels: [],
					},
					{
						number: 5,
						title: "Unnamed ask",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						comments: 1,
						assignee: null,
						labels: [],
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/4/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: `Senior, ${named}\n\n${ask("gh-4")}`,
						created_at: "2026-10-01T00:00:00Z",
						user: { login: "agent" },
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/6/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: `Senior, ${named}\n\n${ask("gh-6")}`,
						created_at: "2026-10-01T00:00:00Z",
						user: { login: "agent" },
					},
					{
						body: "Reply: noted, no change.",
						created_at: "2026-10-01T01:00:00Z",
						user: { login: "lev" },
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/5/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: `Which bot should review this?\n\n${ask("gh-5")}`,
						created_at: "2026-10-01T00:00:00Z",
						user: { login: "agent" },
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions")
			) {
				return page([]);
			}
			return new Response("not recorded", { status: 404 });
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
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
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key)).toEqual([`${repo}#4`, `${repo}#6`]);
			expect(items[0]).toMatchObject({
				headline: named,
				reason: "ask",
				tags: ["matched by name"],
				answered: false,
			});
			expect(items[1]).toMatchObject({
				headline: named,
				reason: "ask",
				answered: true,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a later workcell progress comment leaves the ask unanswered", async () => {
		const question = "Which bot should review this?";
		const issues = [
			linearIssue("PF-20", "Progress after the ask", question, [
				{
					body: `${question}\n\n${ask("pf-20")}`,
					user: { id: "agent", name: "AbysmalBiscuit" },
				},
				{
					body: "**Workcell progress**\n- stage: review\n- ask-pf-20: still open",
					user: { id: "agent", name: "AbysmalBiscuit" },
				},
			]),
			linearIssue("PF-21", "Same author, no answer", "Still open", [
				{
					body: `${ask("pf-21")}\nWhich row?`,
					user: { id: "agent", name: "AbysmalBiscuit" },
				},
				{
					body: "Still waiting on the row.",
					user: { id: "agent", name: "AbysmalBiscuit" },
				},
			]),
			linearIssue("PF-22", "Quoted answer", "Quoted", [
				{ body: `${ask("pf-22")}\nKeep the label?` },
				{ body: "> Keep the label?\n\nYes." },
			]),
			linearIssue("PF-23", "Reply prefix", "Reply prefix", [
				{ body: `${ask("pf-23")}\nWhich name?` },
				{ body: "Reply: the short name." },
			]),
		];
		const recorded = linearFake({ project: linearProject, issues });
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "project-flow" }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key).sort()).toEqual([
				"PF-20",
				"PF-21",
				"PF-22",
				"PF-23",
			]);
			expect(items.find((item) => item.key === "PF-20")).toMatchObject({
				headline: question,
				reason: "ask",
				answered: false,
			});
			expect(items.find((item) => item.key === "PF-21")).toMatchObject({
				reason: "ask",
				answered: false,
			});
			expect(items.find((item) => item.key === "PF-22")).toMatchObject({
				reason: "ask",
				answered: true,
			});
			expect(items.find((item) => item.key === "PF-23")).toMatchObject({
				reason: "ask",
				answered: true,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear project set false omits an unnamed ask", async () => {
		const unnamed = "Which bot should review this?";
		const issues = [
			linearIssue("PF-1", "Unnamed ask", unnamed, [
				{ body: `${unnamed}\n\n${ask("pf-1")}` },
			]),
		];
		const recorded = linearFake({ project: linearProject, issues });
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "project-flow" }],
				noSenior: { "project-flow": false },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(await checks).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("lists an awaiting-merge ticket and a labelled assignee", async () => {
		const repo = "acme/widget";
		const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const recorded: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (url === "https://api.github.com/graphql") {
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([
					{
						number: 8,
						title: "Ready to merge",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: { login: "someone" },
						labels: [],
					},
					{
						number: 9,
						title: "Needs an engineer",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: { login: "lev" },
						labels: [{ name: "needs-engineer" }],
					},
					{
						number: 10,
						title: "Labelled for someone else",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: { login: "someone" },
						assignees: [{ login: "someone" }],
						labels: [{ name: "needs-human" }],
					},
					{
						number: 11,
						title: "Second assignee",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: { login: "someone" },
						assignees: [{ login: "someone" }, { login: "lev" }],
						labels: [{ name: "needs-human" }],
					},
					{
						number: 12,
						title: "Empty assignees",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: null,
						assignees: [],
						labels: [{ name: "needs-human" }],
					},
					{
						number: 13,
						title: "Blank login",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: { login: " " },
						assignees: [{ login: " " }, { login: "" }],
						labels: [{ name: "needs-engineer" }],
					},
				]);
			}
			if (url.includes("/pulls?state=open")) {
				return page([
					{
						number: 40,
						title: "Ship it",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/40`,
						head: { ref: "8-ready-to-merge", sha: head },
						body: "Closes #8",
						merged_at: null,
					},
				]);
			}
			if (
				url.includes("/pulls?state=closed") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions")
			) {
				return page([]);
			}
			if (url.includes("/check-runs")) {
				return Response.json({ check_runs: [] });
			}
			if (url.includes("/commits/")) {
				return Response.json({
					commit: { committer: { date: "2026-10-01T00:00:00Z" } },
				});
			}
			return new Response("not recorded", { status: 404 });
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				needsYouLabels: ["needs-human", "needs-engineer"],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
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
					databasePath: join(root, "store.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key).sort()).toEqual([
				`${repo}#11`,
				`${repo}#8`,
				`${repo}#9`,
			]);
			expect(items.find((item) => item.key === `${repo}#8`)).toMatchObject({
				headline: "Ready to merge",
				reason: "awaitingMerge",
			});
			expect(items.find((item) => item.key === `${repo}#9`)).toMatchObject({
				headline: "Needs an engineer",
				reason: "label",
			});
			expect(items.find((item) => item.key === `${repo}#11`)).toMatchObject({
				headline: "Second assignee",
				reason: "label",
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("matches a labelled GitHub assignee from the viewer login", async () => {
		const repo = "acme/widget";
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url.startsWith("https://api.github.com/user/repos")) {
				return page([]);
			}
			if (
				url === "https://api.github.com/graphql" &&
				(body.includes("ViewerProjects") || body.includes("OrgProjects"))
			) {
				return Response.json({
					data: {
						viewer: {
							login: "ada",
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
				});
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "ada" });
			}
			if (url === "https://api.github.com/graphql") {
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([
					{
						number: 3,
						title: "Assigned to the viewer",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: { login: "ada" },
						labels: [{ name: "needs-human" }],
					},
					{
						number: 4,
						title: "Assigned to a personal handle",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: { login: "lev" },
						labels: [{ name: "needs-human" }],
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions")
			) {
				return page([]);
			}
			return new Response("not recorded", { status: 404 });
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				needsYouLabels: ["needs-human"],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
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
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key)).toEqual([`${repo}#3`]);
			expect(items[0]).toMatchObject({
				headline: "Assigned to the viewer",
				reason: "label",
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("matches a labelled Linear assignee by viewer id", async () => {
		const issues = [
			linearIssue("PF-30", "Assigned to the viewer", "Viewer", [], {
				labels: { nodes: [{ name: "needs-human" }] },
				assignee: { id: "viewer-ada", name: "Ada Lovelace" },
			}),
			linearIssue("PF-31", "Display name looks like a login", "Name", [], {
				labels: { nodes: [{ name: "needs-human" }] },
				assignee: { id: "other", name: "lev" },
			}),
		];
		const recorded = linearFake({ project: linearProject, issues });
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "project-flow" }],
				needsYouLabels: ["needs-human"],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key)).toEqual(["PF-30"]);
			expect(items[0]).toMatchObject({
				headline: "Assigned to the viewer",
				reason: "label",
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an override list matches a labelled assignee the viewer is not", async () => {
		const repo = "acme/widget";
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url.startsWith("https://api.github.com/user/repos")) {
				return page([]);
			}
			if (
				url === "https://api.github.com/graphql" &&
				(body.includes("ViewerProjects") || body.includes("OrgProjects"))
			) {
				return Response.json({
					data: {
						viewer: {
							login: "ada",
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
				});
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "ada" });
			}
			if (url === "https://api.github.com/graphql") {
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([
					{
						number: 5,
						title: "Covered by the override",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						assignee: { login: "guest" },
						labels: [{ name: "needs-engineer" }],
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions")
			) {
				return page([]);
			}
			return new Response("not recorded", { status: 404 });
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				viewerLogins: ["guest"],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
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
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key)).toEqual([`${repo}#5`]);
			expect(items[0]).toMatchObject({
				headline: "Covered by the override",
				reason: "label",
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank override and a marker-only quote leave the ask open", async () => {
		const question = "Which bot should review this?";
		const issues = [
			linearIssue("PF-40", "Blank assignee", "Blank", [], {
				labels: { nodes: [{ name: "needs-human" }] },
				assignee: { id: "   ", name: "   " },
			}),
			linearIssue("PF-41", "Marker only", question, [
				{ body: ask("pf-41") },
				{ body: "> \n\nStill open." },
			]),
			linearIssue("PF-42", "Spaced prefix", "Spaced", [
				{ body: `${ask("pf-42")}\n${question}` },
				{ body: "  Reply: the short name." },
			]),
		];
		const recorded = linearFake({ project: linearProject, issues });
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "project-flow" }],
				viewerLogins: ["   "],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		await Bun.write(join(root, "notes.txt"), "untracked harness file\n");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key).sort()).toEqual(["PF-41", "PF-42"]);
			expect(items.find((item) => item.key === "PF-41")).toMatchObject({
				headline: "",
				reason: "ask",
				answered: false,
			});
			expect(items.find((item) => item.key === "PF-42")).toMatchObject({
				reason: "ask",
				answered: true,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
