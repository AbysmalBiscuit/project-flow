import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { localProjects, run } from "../src/main.ts";
import type { CheckoutSource } from "../src/ports.ts";
import { recordedDiscovery, tempConfig, testIo, urlOf } from "./support.ts";

const named = "other/local-only";

function issue(number: number): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${named}/issues/${number}`,
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
			return discovered;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		requests.push(body === "" ? url : `${url} ${body}`);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (url.includes(`/repos/${named}/issues?`)) {
			return page([issue(9)]);
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
		return new Response("not recorded", { status: 404 });
	};
}

async function overview(input: {
	checkouts: CheckoutSource;
	todos?: string;
	requests?: string[];
}): Promise<unknown> {
	const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
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
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: localFetch(requests),
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checks.then(() => undefined),
				listCheckouts: input.checkouts,
				...(input.todos === undefined
					? {}
					: { listTodos: async () => input.todos ?? "" }),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		return await checks;
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

const card = {
	name: named,
	tracker: "github",
	done: 0,
	dropped: 0,
	backlog: 1,
	inProgress: 0,
	unlinkedPrs: [],
};

describe("local projects", () => {
	test("a project named only by a local checkout appears", async () => {
		const body = await overview({
			checkouts: async () => [{ repo: named, tracker: "github" }],
		});
		expect(body).toEqual({ projects: [card] });
	});

	test("a project named only by a devkit todo appears", async () => {
		const checkouts = await localProjects(
			async () => [
				{ repo: "   ", tracker: "github", path: "/tmp/blank" },
				{ repo: named, tracker: "github", path: "/tmp/local-only" },
			],
			async () =>
				JSON.stringify([
					{ project: "   ", status: "pending" },
					{ project: "local  only.9-feat", status: "pending" },
					{
						project: `local-only.9-feat-ship.${"a".repeat(8)}`,
						status: "pending",
						started: false,
					},
				]),
		);
		const body = await overview({
			checkouts: async () =>
				checkouts.filter((checkout) => checkout.repo === named),
		});
		expect(body).toEqual({ projects: [card] });
	});

	test("a blank checkout and a repeated-space todo name no project", async () => {
		const body = await overview({
			checkouts: async () => [
				{ repo: "", tracker: "github" },
				{ repo: "   ", tracker: "github" },
			],
			todos: JSON.stringify([
				{ project: "   ", status: "pending" },
				{ project: "local  only.9-feat", status: "pending" },
			]),
		});
		expect(body).toEqual({ projects: [] });
	});

	test("a failing checkout read shows no project", async () => {
		const checkouts = await localProjects(
			async () => {
				throw new Error("devkit config show failed");
			},
			async () => "not json",
		);
		const body = await overview({ checkouts: async () => checkouts });
		expect(body).toEqual({ projects: [] });
	});

	test("an untracked file in a checkout does not name a project", async () => {
		const checkout = await mkdtemp(join(tmpdir(), "project-flow-checkout-"));
		const stray = join(checkout, "notes.txt");
		await writeFile(stray, `${named}\n`);
		try {
			const body = await overview({
				checkouts: async () => [
					{ repo: "", tracker: "github", path: checkout },
				],
			});
			expect(body).toEqual({ projects: [] });
		} finally {
			await rm(checkout, { recursive: true, force: true });
		}
	});
});
