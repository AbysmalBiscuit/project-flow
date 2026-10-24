import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const userToken = "recorded-user-token";
const acmeToken = "ghs_acme_project";
const otherToken = "ghs_other_project";
const acmeBearer = `Bearer ${acmeToken}`;
const otherBearer = `Bearer ${otherToken}`;
const userBearer = `Bearer ${userToken}`;

const acmeProject = "PVT_acme";
const otherProject = "PVT_other";

type Recorded = {
	url: string;
	authorization: string | null;
	body: string;
};

function hostsText(token: string, expiresAt: string): string {
	return [
		"github.com:",
		`    oauth_token: ${token}`,
		"    user: x-access-token",
		`    expires_at: ${expiresAt}`,
		"",
	].join("\n");
}

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function emptyItems(): unknown {
	return {
		data: {
			node: {
				items: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		},
	};
}

function emptyFields(): unknown {
	return { data: { node: { fields: { nodes: [{}] } } } };
}

function projectByNumber(id: string, number: number, title: string): unknown {
	return {
		data: {
			repositoryOwner: {
				projectV2: {
					id,
					number,
					title,
					closed: false,
					updatedAt: "2026-08-18T12:00:00Z",
				},
			},
		},
	};
}

function projectOwnerOf(body: string): string | null {
	const parsed = JSON.parse(body) as { variables?: { projectOwner?: unknown } };
	const owner = parsed.variables?.projectOwner;
	return typeof owner === "string" ? owner : null;
}

function recordingFetch(recorded: Recorded[]): Fetch {
	return async (input, init) => {
		const url = urlOf(input);
		const headers = new Headers(init?.headers);
		const body = typeof init?.body === "string" ? init.body : "";
		if (url.startsWith("https://api.github.com/")) {
			recorded.push({
				url,
				authorization: headers.get("authorization"),
				body,
			});
		}
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectByNumber")
		) {
			if (body.includes('"owner":"acme"')) {
				return json(projectByNumber(acmeProject, 4, "Acme board"));
			}
			if (body.includes('"owner":"other"')) {
				return json(projectByNumber(otherProject, 9, "Other board"));
			}
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectItems")
		) {
			const owner = projectOwnerOf(body);
			if (owner === "acme" && body.includes(`"id":"${acmeProject}"`)) {
				return json(emptyItems());
			}
			if (owner === "other" && body.includes(`"id":"${otherProject}"`)) {
				return json(emptyItems());
			}
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectFields")
		) {
			const owner = projectOwnerOf(body);
			if (
				(owner === "acme" && body.includes(`"id":"${acmeProject}"`)) ||
				(owner === "other" && body.includes(`"id":"${otherProject}"`))
			) {
				return json(emptyFields());
			}
		}
		if (url === "https://api.linear.app/graphql") {
			return json({
				data: {
					viewer: { id: "lev" },
					projects: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			});
		}
		return unrecorded(input);
	};
}

describe("factory tokens on pinned GitHub projects", () => {
	test("project item pages and status reads send the configured owner token", async () => {
		const home = await mkdtemp(
			join("/var/tmp", "project-flow-factory-project-"),
		);
		const folder = join(home, "tokens");
		await mkdir(join(folder, "acme"), { recursive: true });
		await mkdir(join(folder, "other"), { recursive: true });
		await writeFile(
			join(folder, "acme", "hosts.yml"),
			hostsText(acmeToken, "2026-08-18T13:00:00.000Z"),
		);
		await writeFile(
			join(folder, "other", "hosts.yml"),
			hostsText(otherToken, "2026-08-18T13:00:00.000Z"),
		);
		const recorded: Recorded[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				tracked: [
					{ tracker: "github", owner: "acme", project: 4 },
					{ tracker: "github", owner: "other", project: 9 },
				],
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		await writeFile(join(root, "notes.txt"), "untracked harness file\n");
		let startChecks: (base: string) => void = () => {};
		const ready = new Promise<string>((resolve) => {
			startChecks = resolve;
		});
		let stop: () => Promise<void> = async () => {};
		const stopped = new Promise<void>((resolve) => {
			void ready.then(() => {
				stop = async () => {
					resolve();
					await cleanup();
					await rm(root, { recursive: true, force: true });
				};
			});
		});
		const running = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: userToken, HOME: home },
				fetch: recordingFetch(recorded),
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				stderr: (line) => {
					throw new Error(line);
				},
				waitForStop: stopped,
			}),
		);
		const base = await ready;
		try {
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(overview.error).toBeNull();
			expect(overview.projects.map((project) => project.name).sort()).toEqual([
				"Acme board",
				"Other board",
			]);

			const projectCalls = recorded.filter(
				(item) =>
					item.body.includes("ProjectItems") ||
					item.body.includes("ProjectFields") ||
					item.body.includes("BlockedBy") ||
					item.body.includes("ClosingPulls"),
			);
			const acmeCalls = projectCalls.filter(
				(item) => projectOwnerOf(item.body) === "acme",
			);
			const otherCalls = projectCalls.filter(
				(item) => projectOwnerOf(item.body) === "other",
			);
			expect(acmeCalls.some((item) => item.body.includes("ProjectItems"))).toBe(
				true,
			);
			expect(
				acmeCalls.some((item) => item.body.includes("ProjectFields")),
			).toBe(true);
			expect(
				otherCalls.some((item) => item.body.includes("ProjectItems")),
			).toBe(true);
			expect(
				otherCalls.some((item) => item.body.includes("ProjectFields")),
			).toBe(true);
			expect(acmeCalls.every((item) => item.authorization === acmeBearer)).toBe(
				true,
			);
			expect(
				otherCalls.every((item) => item.authorization === otherBearer),
			).toBe(true);
			expect(
				projectCalls.every((item) => item.authorization !== userBearer),
			).toBe(true);

			const lookup = recorded.filter((item) =>
				item.body.includes("ProjectByNumber"),
			);
			expect(
				lookup
					.filter((item) => item.body.includes('"owner":"acme"'))
					.every((item) => item.authorization === acmeBearer),
			).toBe(true);
			expect(
				lookup
					.filter((item) => item.body.includes('"owner":"other"'))
					.every((item) => item.authorization === otherBearer),
			).toBe(true);
		} finally {
			await stop();
			const result = await running;
			expect(result.exitCode).toBe(0);
			await rm(home, { recursive: true, force: true });
		}
	});
});
