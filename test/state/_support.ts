import { expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import projectFields from "../fixtures/github-project-fields.json";
import teamStates from "../fixtures/linear-team-states.json";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	page,
	recordedDiscovery,
	repo as githubRepo,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { repoReadFromLists } from "../support/repo-read.ts";

export const fixtureDir = join(import.meta.dir, "..", "fixtures");

export const linearSlug = "widget-launch";

export const boardId = "PVT_widget";

export function recordedStatusOptions(body: typeof projectFields) {
	for (const field of body.data.node.fields.nodes) {
		if (!("name" in field) || field.name !== "Status") {
			continue;
		}
		return field.options;
	}
	throw new Error("recorded project Status field is missing");
}

export const githubStatusOptions = recordedStatusOptions(projectFields);

export function boardOptionId(name: string): string | undefined {
	const collapsed = name.trim().replace(/\s+/g, " ");
	return githubStatusOptions.find(
		(option) => option.name.trim().replace(/\s+/g, " ") === collapsed,
	)?.id;
}

export const todoState = {
	id: "364b3510-9325-4af6-9df1-8f2ff56f7a3d",
	name: "Todo",
	type: "unstarted",
	color: "#e2e2e2",
};

export const progressState = {
	id: "cce36b04-d482-4233-b1d8-33eda76ca025",
	name: "In Progress",
	type: "started",
	color: "#f2c94c",
};

export const linearTeam = {
	id: "team-widget",
	key: "WID",
	name: "Widget",
};

export const linearProject = {
	id: "project-widget",
	name: "Widget launch",
	slugId: linearSlug,
	teams: { nodes: [linearTeam] },
};

export type FlightItem = {
	key: string | null;
	title: string;
	state: string;
	lane: string;
	statusType: string;
	blocked?: boolean;
	staleStatus?: string;
	chips?: string[];
	enteredStateAt?: string;
	run?: { status: string; stage: string };
};

export type NeedsYouItem = {
	key: string;
	reason: string;
};

export type ProjectBody = {
	lanes: { name: string; statusType: string }[];
	tickets?: FlightItem[];
	sections: {
		id: string;
		items?: FlightItem[];
		needsYou?: NeedsYouItem[];
	}[];
};

export type RecordedPull = {
	number: number;
	title: string;
	html_url: string;
	draft?: boolean;
	body: string | null;
	head: { ref: string; sha: string };
	state: string;
	merged_at?: string | null;
	auto_merge?: unknown;
};

export async function recordedJson(name: string): Promise<unknown> {
	return JSON.parse(await readFile(join(fixtureDir, name), "utf8"));
}

export function linearIssue(
	identifier: string,
	title: string,
	state: { id: string; name: string; type: string; color: string },
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		identifier,
		title,
		description: "",
		updatedAt: "2026-08-18T12:00:00.000Z",
		state,
		parent: null,
		projectMilestone: null,
		labels: { nodes: [] },
		...fields,
	};
}

export function progress(lines: string): string {
	return `**Workcell progress**\n\n${lines}`;
}

export function pullAs(
	recorded: RecordedPull,
	fields: { number?: number; body?: string; state?: string } = {},
): Record<string, unknown> {
	const number = fields.number ?? recorded.number;
	return {
		...recorded,
		number,
		html_url: `https://github.com/${githubRepo}/pull/${number}`,
		...(fields.body === undefined ? {} : { body: fields.body }),
		...(fields.state === undefined ? {} : { state: fields.state }),
	};
}

export function githubIssue(
	number: number,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${githubRepo}/issues/${number}`,
		labels: [],
		comments: 0,
		...fields,
	};
}

export function recordedLinear(
	issues: Record<string, unknown>[],
	github?: Fetch,
	branches: { name: string }[] = [],
): Fetch {
	return linearFake({
		project: linearProject,
		states: teamStates.data.team.states.nodes,
		issues,
		...(github === undefined
			? branches.length === 0
				? {}
				: {
						github: async (input: string | URL | Request) => {
							const url = urlOf(input);
							if (url.includes("/branches?")) {
								return page(branches);
							}
							return unrecorded(input);
						},
					}
			: { github }),
	});
}

export function boardItem(
	number: number,
	title: string,
	status: { name: string; color: string },
	field: { updatedAt?: string; optionId?: string } = {},
	contentFields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		fieldValueByName: {
			name: status.name,
			optionId:
				field.optionId ?? boardOptionId(status.name) ?? `opt-${status.name}`,
			color: status.color,
			...(field.updatedAt === undefined ? {} : { updatedAt: field.updatedAt }),
		},
		content: {
			__typename: "Issue",
			id: `I_${number}`,
			number,
			title,
			state: "OPEN",
			stateReason: null,
			updatedAt: "2026-08-18T12:00:00Z",
			...contentFields,
			body: "",
			comments: { totalCount: 0 },
			repository: { nameWithOwner: githubRepo },
			milestone: null,
			labels: { nodes: [] },
			parent: null,
			closedByPullRequestsReferences: {
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
			blockedBy: {
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	};
}

export function boardFetch(
	items: Record<string, unknown>[],
	closed: Record<string, unknown>[] = [],
	requests: string[] = [],
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		requests.push(body === "" ? url : `${url} ${body}`);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url === `https://api.github.com/repos/${githubRepo}`) {
			return Response.json({ allow_auto_merge: false });
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectByNumber")
		) {
			return Response.json({
				data: {
					repositoryOwner: {
						projectV2: {
							id: boardId,
							number: 4,
							title: "Widget board",
							closed: false,
							updatedAt: "2026-08-18T12:00:00Z",
						},
					},
				},
			});
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectFields")
		) {
			return Response.json(projectFields);
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectItems")
		) {
			return Response.json({
				data: {
					node: {
						items: {
							nodes: items,
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		const pullMatch = url.match(
			new RegExp(
				`^https://api\\.github\\.com/repos/${githubRepo}/pulls/(\\d+)$`,
			),
		);
		if (pullMatch !== null) {
			const number = Number(pullMatch[1]);
			const pull = closed.find((item) => item.number === number);
			return pull === undefined ? unrecorded(input) : Response.json(pull);
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=closed&per_page=10&page=1`
		) {
			return page(closed);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/labels?") ||
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
		return unrecorded(input);
	};
}

export function recordedRepo(
	issues: Record<string, unknown>[],
	pulls: Record<string, unknown>[] = [],
	closed: Record<string, unknown>[] = [],
	repoBody: Record<string, unknown> = { allow_auto_merge: false },
	branches: { name: string }[] = [],
	requests: string[] = [],
	events: Record<string, unknown>[] = [],
	labels: Record<string, unknown>[] = [],
	comments: Record<string, unknown>[] = [],
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		requests.push(url);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url === `https://api.github.com/repos/${githubRepo}`) {
			return Response.json(repoBody);
		}
		const pullMatch = url.match(
			new RegExp(
				`^https://api\\.github\\.com/repos/${githubRepo}/pulls/(\\d+)$`,
			),
		);
		if (pullMatch !== null) {
			const number = Number(pullMatch[1]);
			const pull = [...pulls, ...closed].find((item) => item.number === number);
			return pull === undefined ? unrecorded(input) : Response.json(pull);
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/issues?`)) {
			return page(issues);
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/labels?`)) {
			return page(labels);
		}
		if (
			url.startsWith(
				`https://api.github.com/repos/${githubRepo}/issues/events?`,
			)
		) {
			return page(events);
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=open&per_page=100&page=1`
		) {
			return page(pulls);
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=closed&per_page=10&page=1`
		) {
			return page(closed);
		}
		if (url.includes("/branches?")) {
			return page(branches);
		}
		if (url.includes("/issues/") && url.includes("/comments")) {
			return page(comments);
		}
		if (url.includes("/reviews") || url.includes("/reactions")) {
			return page([]);
		}
		if (url.includes("/check-runs")) {
			return Response.json({ check_runs: [] });
		}
		if (url.includes("/commits/")) {
			return Response.json({
				commit: { committer: { date: "2026-08-18T11:00:00.000Z" } },
			});
		}
		if (url === "https://api.github.com/graphql") {
			const issuesWithComments = issues.map((issue) => ({
				...issue,
				commentRows: comments.filter(
					(comment) =>
						comment.id === issue.number ||
						comment.issue_url ===
							`https://api.github.com/repos/${githubRepo}/issues/${issue.number}`,
				),
			}));
			const read = repoReadFromLists(
				input,
				init,
				{ [githubRepo]: issuesWithComments },
				{ [githubRepo]: [...pulls, ...closed] },
			);
			if (read !== null) {
				requests.push(
					`https://api.github.com/repos/${githubRepo}/issues?state=all`,
				);
				const payload = (await read.json()) as {
					data: {
						repository: {
							autoMergeAllowed?: boolean;
							labels: {
								nodes: { name: string; color: string }[];
							};
						};
					};
				};
				payload.data.repository.autoMergeAllowed =
					repoBody.allow_auto_merge === true;
				const labelNodes = labels.flatMap((label) =>
					typeof label.name === "string"
						? [
								{
									name: label.name,
									color:
										typeof label.color === "string" ? label.color : "ededed",
								},
							]
						: [],
				);
				if (labelNodes.length > 0) {
					payload.data.repository.labels.nodes = labelNodes;
				}
				return Response.json(payload);
			}
			const body = typeof init?.body === "string" ? init.body : "";
			const number = body.match(/"number":\s*(\d+)/)?.[1];
			const nodes =
				number === undefined
					? []
					: issues
							.filter((issue) => String(issue.number) === number)
							.map((issue) => ({ number: issue.number }));
			return Response.json({
				data: {
					repository: {
						issue: { closedByPullRequestsReferences: { nodes: [] } },
						pullRequest: { closingIssuesReferences: { nodes } },
					},
				},
			});
		}
		return unrecorded(input);
	};
}

export async function withApp(
	config: string,
	fetchImpl: Fetch,
	env: Record<string, string | undefined>,
	check: (base: string) => Promise<void>,
	checkoutRoot?: string,
	now = new Date("2026-10-21T00:00:00.000Z"),
	todos?: string,
): Promise<void> {
	const written =
		checkoutRoot === undefined ? config : withCheckout(config, checkoutRoot);
	const { path, cleanup } = await tempConfig(written);
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
				stdout: (line) => startChecks(line),
				waitForStop: checks,
				now: () => now,
				...(todos === undefined ? {} : { listTodos: async () => todos }),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

export function withCheckout(config: string, checkoutRoot: string): string {
	const parsed = JSON.parse(config) as Record<string, unknown>;
	return JSON.stringify({ ...parsed, checkoutRoots: [checkoutRoot] });
}

export async function projectOf(
	base: string,
	name: string,
): Promise<ProjectBody> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectBody;
}

export function ticketOf(report: ProjectBody, key: string): FlightItem {
	const found = [
		...(report.tickets ?? []),
		...report.sections.flatMap((section) => section.items ?? []),
	].find((item) => item.key === key);
	if (found === undefined) {
		throw new Error(`ticket ${key} is missing from the project`);
	}
	return found;
}

export function needsYouOf(report: ProjectBody): NeedsYouItem[] {
	return (
		report.sections.find((section) => section.id === "needsYou")?.needsYou ?? []
	);
}

export { devkitWorktree, git } from "../support/checkouts.ts";
