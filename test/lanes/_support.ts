import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import factoryLabels from "../fixtures/github-factory-labels.json";
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
import { repoReadFromHandler } from "../support/repo-read.ts";

export const linearSlug = "widget-launch";
export const plainRepo = "acme/plain";
const projectId = "PVT_widget";

type Lane = {
	id: string;
	name: string;
	colour: string;
	statusType: string;
	added?: boolean;
	evidence?: string;
};

export type FlightItem = {
	key: string | null;
	title: string;
	state: string;
	blockers: string[];
	lane: string;
	status?: string;
	statusType: string;
	blocked?: boolean;
	enteredStateAt?: string;
	updatedAt?: string;
	needsYou?: boolean;
	url?: string;
	outsideBlockers?: unknown;
	blocks?: unknown;
	pull?: string;
	chips?: string[];
	staleStatus?: string;
};

export type ProjectBody = {
	name: string;
	tracker: string;
	lanes: Lane[];
	statuses: Lane[];
	sections: {
		id: string;
		items?: FlightItem[];
	}[];
};

export type OverviewBody = {
	projects: {
		name: string;
		blocked?: number;
		inProgress?: number;
		error?: string | null;
		statusTypes?: Record<string, number>;
		tickets: {
			key: string | null;
			lane?: string;
			status?: string;
			statusType?: string;
			state: string;
		}[];
	}[];
};

export const linearTeam = {
	id: "team-widget",
	key: "WID",
	name: "Widget",
};

export const linearStates = teamStates.data.team.states.nodes;

function recordedStatusOptions(body: typeof projectFields) {
	for (const field of body.data.node.fields.nodes) {
		if (!("name" in field) || field.name !== "Status") {
			continue;
		}
		return field.options;
	}
	throw new Error("recorded project Status field is missing");
}

const githubStatusOptions = recordedStatusOptions(projectFields);

function collapsedStatusName(name: string): string {
	return name.trim().replace(/\s+/g, " ");
}

function recordedOptionId(name: string): string | undefined {
	const collapsed = collapsedStatusName(name);
	return githubStatusOptions.find(
		(option) => collapsedStatusName(option.name) === collapsed,
	)?.id;
}

export function linearIssue(
	identifier: string,
	title: string,
	state: { id: string; name: string; type: string; color: string },
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
	};
}

export function githubIssue(
	number: number,
	title: string,
	repo: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		labels: [],
		...fields,
	};
}

export function recordedFactoryLabelPage(): Response {
	return new Response(JSON.stringify(factoryLabels), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

export function repoFetch(
	repos: Record<string, Record<string, unknown>[]>,
	labels: Record<string, { name: string; color: string }[]> = {},
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		const listed = await repoReadFromHandler(
			input,
			init,
			async (restInput, _restInit) => {
				const restUrl = urlOf(restInput);
				for (const [repo, issues] of Object.entries(repos)) {
					if (
						restUrl.startsWith(`https://api.github.com/repos/${repo}/labels?`)
					) {
						return page(labels[repo] ?? []);
					}
					if (
						restUrl.startsWith(`https://api.github.com/repos/${repo}/issues?`)
					) {
						return page(issues);
					}
					if (
						restUrl.includes(`/repos/${repo}/issues/`) &&
						restUrl.includes("/comments")
					) {
						return page([]);
					}
				}
				if (restUrl.includes("/labels?")) {
					const named = restUrl.match(/\/repos\/([^/]+\/[^/]+)\/labels/)?.[1];
					return page(named === undefined ? [] : (labels[named] ?? []));
				}
				if (restUrl.includes("/pulls?") || restUrl.includes("/branches?")) {
					return page([]);
				}
				return page([]);
			},
		);
		if (listed !== null) {
			return listed;
		}
		for (const [repo, issues] of Object.entries(repos)) {
			if (url.startsWith(`https://api.github.com/repos/${repo}/labels?`)) {
				return page(labels[repo] ?? []);
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page(issues);
			}
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.endsWith("/comments")
		) {
			return page([]);
		}
		return unrecorded(input);
	};
}

export function projectItem(
	number: number,
	title: string,
	status: { name: string; color: string } | null,
	content: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		fieldValueByName:
			status === null
				? null
				: {
						name: status.name,
						optionId: recordedOptionId(status.name) ?? `opt-${status.name}`,
						color: status.color,
					},
		content: {
			__typename: "Issue",
			id: `I_${number}`,
			number,
			title,
			state: "OPEN",
			stateReason: null,
			updatedAt: "2026-08-18T12:00:00Z",
			body: "",
			repository: { nameWithOwner: githubRepo },
			milestone: null,
			labels: { nodes: [] },
			parent: null,
			blockedBy: { nodes: [] },
			...content,
		},
	};
}

export function projectFetch(
	items: Record<string, unknown>[],
	options = githubStatusOptions,
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectByNumber")
		) {
			return Response.json({
				data: {
					repositoryOwner: {
						projectV2: {
							id: projectId,
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
			if (options === githubStatusOptions) {
				return Response.json(projectFields);
			}
			return Response.json({
				data: {
					node: {
						fields: {
							nodes: [
								{},
								{
									id: "PVTSSF_status",
									name: "Status",
									options,
								},
								{},
							],
						},
					},
				},
			});
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
		if (url.includes("/pulls?") || url.includes("/labels?")) {
			return page([]);
		}
		return unrecorded(input);
	};
}

export async function withApp(
	config: string,
	fetchImpl: Fetch,
	env: Record<string, string | undefined>,
	check: (base: string) => Promise<void>,
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

function laneNames(report: ProjectBody): Set<string> {
	return new Set(report.statuses.map((lane) => lane.name));
}

export function expectLanesHoldTickets(
	report: ProjectBody,
	overview: OverviewBody,
	project: string,
): void {
	const names = laneNames(report);
	const tickets =
		overview.projects.find((item) => item.name === project)?.tickets ?? [];
	for (const item of tickets) {
		expect(
			(item.status ?? item.lane) === undefined ||
				names.has(item.status ?? item.lane ?? ""),
		).toBe(true);
	}
	for (const item of report.sections.flatMap(
		(section) => section.items ?? [],
	)) {
		expect(
			(item.status ?? item.lane) === undefined ||
				names.has(item.status ?? item.lane ?? ""),
		).toBe(true);
	}
}

export function flight(report: ProjectBody): FlightItem[] {
	const lanes = new Map(
		report.statuses.map((lane) => [lane.name, lane.statusType]),
	);
	return report.sections
		.filter((section) => section.id === "inFlight" || section.id === "backlog")
		.flatMap((section) =>
			(section.items ?? []).flatMap((item) => {
				const lane =
					(item.status ?? item.lane) === "" && section.id === "backlog"
						? (report.statuses.find(
								(candidate) => candidate.statusType === "backlog",
							)?.name ?? "")
						: (item.status ?? item.lane);
				const statusType = lanes.get(lane);
				if (lane === "" || statusType === undefined) {
					return [];
				}
				const {
					enteredStateAt: _enteredStateAt,
					updatedAt: _updatedAt,
					needsYou: _needsYou,
					url: _url,
					outsideBlockers: _outsideBlockers,
					blocks: _blocks,
					pull: _pull,
					chips: _chips,
					staleStatus: _staleStatus,
					status: _status,
					...rest
				} = item;
				return [{ ...rest, lane, statusType }];
			}),
		);
}

export function placed(
	key: string,
	title: string,
	lane: string,
	statusType: string,
): FlightItem {
	return {
		key,
		title,
		state: statusType,
		blockers: [],
		lane,
		statusType,
	};
}
