import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	emptyProjectFields,
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

export const githubRepo = "acme/widget";
export const otherRepo = "acme/platform";
export const linearSlug = "widget-launch";

export function issue(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
	repo = githubRepo,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		...fields,
	};
}

export function linearIssue(
	identifier: string,
	description: string,
	stateType: string,
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title: identifier,
		description,
		updatedAt: "2026-08-18T12:00:00.000Z",
		state: { type: stateType },
		inverseRelations: { nodes: [] },
	};
}

export function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

export const githubIssues = [
	issue(1, "Ship the map", {
		labels: [{ name: "epic" }],
		milestone: { title: "October" },
	}),
	issue(2, "feat(ux): draw the nodes", {
		parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/1`,
		milestone: { title: "October" },
		body: `Blocked by: ${otherRepo}#9`,
	}),
	issue(3, "Write the copy", {
		milestone: { title: "October" },
	}),
	issue(4, "Draft the page", {
		body: "A draft exists.",
	}),
];

const otherIssues = [
	issue(9, "Platform gate", { labels: [{ name: "epic" }] }, otherRepo),
];

const githubPulls = [
	{
		number: 40,
		title: "Fix the legend",
		state: "open",
		draft: true,
		html_url: `https://github.com/${githubRepo}/pull/40`,
		head: { ref: "legend" },
		body: "",
	},
];

export function githubFetch(
	issues = githubIssues,
	others = otherIssues,
	calls?: string[],
	pulls: Record<string, unknown>[] = githubPulls,
): Fetch {
	return async (input, init) => {
		calls?.push(urlOf(input));
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url === "https://api.github.com/graphql") {
			const body = typeof init?.body === "string" ? init.body : "";
			if (body.includes("query RepoRead")) {
				return new Response("{}", {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/issues?`)) {
			return page(issues);
		}
		if (url.startsWith(`https://api.github.com/repos/${otherRepo}/issues?`)) {
			return page(others);
		}
		if (url.includes("/labels?")) {
			return page([]);
		}
		if (url.includes("/pulls?")) {
			if (url.includes(githubRepo)) {
				return page(pulls);
			}
			return page([]);
		}
		if (url.includes("/branches?")) {
			if (url.includes(githubRepo)) {
				return page([{ name: "4-draft-the-page" }]);
			}
			return page([]);
		}
		if (url.endsWith("/comments")) {
			return page([]);
		}
		return emptyProjectFields(input, init) ?? unrecorded(input);
	};
}

export const linearIssues = [
	{
		id: "parent",
		identifier: "WID-1",
		title: "Launch epic",
		description: "",
		state: { type: "started" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		projectMilestone: { name: "Beta" },
		labels: { nodes: [{ name: "epic" }] },
		parent: null,
	},
	{
		id: "story",
		identifier: "WID-4",
		title: "Ship the list",
		description: "",
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		parent: { identifier: "WID-1" },
		projectMilestone: null,
		labels: { nodes: [] },
	},
	{
		id: "child",
		identifier: "WID-2",
		title: "feat(api): list projects",
		description: `Blocked by: ${otherRepo}#9`,
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		parent: { identifier: "WID-4" },
		projectMilestone: { name: "Later" },
		labels: { nodes: [] },
	},
	{
		id: "backlog",
		identifier: "WID-3",
		title: "Write the notes",
		description: "",
		state: { type: "backlog" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		parent: null,
		projectMilestone: { name: "Beta" },
		labels: { nodes: [] },
	},
];

export async function withApp(
	config: string,
	fetchImpl: Fetch,
	env: Record<string, string | undefined>,
	check: (base: string) => Promise<void>,
	now?: () => Date,
): Promise<void> {
	const { path, cleanup } = await tempConfig(config);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			check(base).then(resolve).catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env,
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				...(now === undefined ? {} : { now }),
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
}
