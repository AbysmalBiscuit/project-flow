import { z } from "zod";

import type { ProjectReport } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import approvals from "../fixtures/gitlab/approvals.json";
import branches from "../fixtures/gitlab/branches.json";
import jobs from "../fixtures/gitlab/jobs.json";
import opened from "../fixtures/gitlab/merge-requests-opened.json";
import pipelines from "../fixtures/gitlab/pipelines.json";
import scratchProject from "../fixtures/gitlab/project.json";
import workItems from "../fixtures/gitlab/work-items.json";
import { withServer } from "../support/app.ts";
import { json, urlOf } from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";

export const gitlabRepo = "AbysmalBiscuit/project-flow-scratch";
export const linearProject = "widget-launch-0d42ae5d46d0";
export const linearName = "Widget launch";
export const gitlabEnv = {
	LINEAR_API_KEY: "recorded-linear-key",
	GITLAB_TOKEN: "recorded-gitlab-token",
};

type MergeRequest = (typeof opened)[number];

export type GitlabFake = {
	/** The path that the recorded repo answers as, such as a path in a subgroup. */
	repo?: string;
	/** Changes to the recorded open PRs, by iid. */
	open?: Record<number, Partial<MergeRequest>>;
	/** The merged PRs of the repo. The scratch repo has none. */
	merged?: unknown[];
	/** The pipelines of each PR, by iid, ahead of the recorded pipelines. */
	pipelines?: Record<string, unknown[]>;
	/** The jobs of each pipeline, by pipeline id, ahead of the recorded jobs. */
	jobs?: Record<string, unknown[]>;
	/** The HTTP status of `GET /user`. */
	userStatus?: number;
	/**
	 * The link type of a work item to another, by the iid of each end. GitLab
	 * refuses blocker links on the tier of the scratch repo, which links its
	 * tickets as `relates_to`. A test sets the type of a recorded link here.
	 */
	linkTypes?: Record<string, Record<string, string>>;
	/** The pages of the member projects. The recorded scratch project is the one page by default. */
	memberPages?: unknown[][];
	/** The parent of a work item, by iid, ahead of the recorded one. */
	parents?: Record<string, { repo: string; iid: string; title: string }>;
	/** The description of a work item, by iid, ahead of the recorded one. */
	descriptions?: Record<string, string>;
	/** Each GitLab request URL that the app sent. */
	sent?: string[];
};

function byKey<Value>(
	record: Record<string, Value> | undefined,
	key: string | undefined,
): Value | undefined {
	return key === undefined ? undefined : record?.[key];
}

type WorkItemState = keyof typeof workItems;

const workItemsBody = z.object({
	variables: z.object({
		path: z.string(),
		state: z.enum(["opened", "closed"]),
	}),
});

/** A recorded answer as the repo at `repo` would give it. */
function asRepo<Value>(recorded: Value, repo: string): Value {
	return JSON.parse(JSON.stringify(recorded).replaceAll(gitlabRepo, repo));
}

function parentOf({
	repo,
	iid,
	title,
}: NonNullable<GitlabFake["parents"]>[string]) {
	return {
		iid,
		title,
		state: "OPEN",
		webUrl: `https://gitlab.com/${repo}/-/work_items/${iid}`,
		namespace: { fullPath: repo },
	};
}

/** The recorded work items of one state, with the link types and descriptions of the fake. */
function workItemsOf(
	state: WorkItemState,
	{ linkTypes = {}, descriptions = {}, parents = {} }: GitlabFake,
) {
	const recorded = workItems[state];
	return {
		data: {
			project: {
				workItems: {
					...recorded.data.project.workItems,
					nodes: recorded.data.project.workItems.nodes.map((item) => {
						const parent = parents[item.iid];
						return {
							...item,
							description: descriptions[item.iid] ?? item.description,
							widgets: item.widgets.map((widget) =>
								"parent" in widget && parent !== undefined
									? { parent: parentOf(parent) }
									: "linkedItems" in widget && widget.linkedItems !== undefined
										? {
												linkedItems: {
													nodes: widget.linkedItems.nodes.map((link) => ({
														...link,
														linkType:
															linkTypes[item.iid]?.[link.workItem.iid] ??
															link.linkType,
													})),
												},
											}
										: widget,
							),
						};
					}),
				},
			},
		},
	};
}

/**
 * Answers the GitLab API from the responses that `test/fixtures/gitlab/record.ts`
 * recorded. The notes read needs a token to record, so it answers an empty list.
 */
export function gitlabFake(options: GitlabFake = {}): Fetch {
	const repo = options.repo ?? gitlabRepo;
	const openRequests = asRepo(opened, repo).map((request) => ({
		...request,
		...options.open?.[request.iid],
	}));
	const merged = options.merged ?? [];
	const api = `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}`;
	return async (input, init) => {
		const url = new URL(urlOf(input));
		options.sent?.push(url.href);
		if (url.href === "https://gitlab.com/api/v4/user") {
			return json({ id: 2274988, username: "lev" }, options.userStatus ?? 200);
		}
		if (url.href === "https://gitlab.com/api/graphql") {
			const { variables } = workItemsBody.parse(
				JSON.parse(String(init?.body ?? "")),
			);
			return json(
				variables.path === repo
					? asRepo(workItemsOf(variables.state, options), repo)
					: { data: { project: null } },
			);
		}
		if (
			url.pathname === "/api/v4/projects" &&
			url.searchParams.get("membership") === "true"
		) {
			const pages = options.memberPages ?? [[scratchProject]];
			const index = Number(url.searchParams.get("page") ?? "1") - 1;
			const next = index + 1 < pages.length ? String(index + 2) : "";
			return json(pages[index] ?? [], 200, { "x-next-page": next });
		}
		const path = url.pathname.slice(new URL(api).pathname.length);
		if (!url.href.startsWith(api)) {
			return json({ message: "404 Project Not Found" }, 404);
		}
		if (path === "/merge_requests") {
			return json(
				url.searchParams.get("state") === "merged" ? merged : openRequests,
			);
		}
		if (path === "/repository/branches") {
			return json(branches);
		}
		const pipeline = path.match(/^\/pipelines\/(\d+)\/jobs$/)?.[1];
		if (pipeline !== undefined) {
			return json(byKey(options.jobs, pipeline) ?? byKey(jobs, pipeline) ?? []);
		}
		const [, iid, rest] = path.match(/^\/merge_requests\/(\d+)(\/\w+)?$/) ?? [];
		if (rest === "/pipelines") {
			return json(byKey(options.pipelines, iid) ?? byKey(pipelines, iid) ?? []);
		}
		if (rest === "/approvals") {
			return json(byKey(approvals, iid) ?? { approved_by: [] });
		}
		if (rest === "/notes") {
			return json([]);
		}
		const request = openRequests.find((item) => String(item.iid) === iid);
		return request === undefined
			? json({ message: "404 Not found" }, 404)
			: json(request);
	};
}

/** The URL of a recorded PR of the scratch repo. */
export const gitlabPullUrl = (iid: number) =>
	`https://gitlab.com/${gitlabRepo}/-/merge_requests/${iid}`;

/** A Linear ticket whose attachments link these URLs. */
export function linearTicket(number: number, attached: string[]) {
	return {
		id: `issue-${number}`,
		identifier: `WID-${number}`,
		title: `Linear ticket ${number}`,
		updatedAt: "2026-10-01T00:00:00.000Z",
		state: { type: "started" },
		attachments: {
			nodes: attached.map((url) => ({
				url,
				title: `PR at ${url}`,
				sourceType: "gitlab",
			})),
		},
	};
}

/**
 * Linear answers for the Linear project, GitLab answers for each GitLab URL, and
 * `github` for each GitHub URL. The Linear answers read `issues` at each request.
 */
export function linearWithGitlab(
	issues: Record<string, unknown>[],
	gitlab: Fetch,
	github?: Fetch,
): Fetch {
	const linear = linearFake({
		project: { id: "project-1", name: linearName, slugId: linearProject },
		issues,
		...(github === undefined ? {} : { github }),
	});
	return (input, init) =>
		urlOf(input).startsWith("https://gitlab.com/")
			? gitlab(input, init)
			: linear(input, init);
}

export const gitlabPin = {
	tracker: "gitlab" as const,
	repo: gitlabRepo,
};

export const linearPin = {
	tracker: "linear" as const,
	project: linearProject,
};

export const linkedTicket = linearTicket(1, [gitlabPullUrl(1)]);

export async function ticketOf(base: string, key: string) {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(linearName)}?view=all`, base),
	);
	const report = (await response.json()) as ProjectReport;
	return report.tickets.find((ticket) => ticket.key === key);
}

/** Starts the app on a Linear project whose ticket WID-1 links GitLab PR !1, and runs the checks. */
export function withLinkedPull(
	gitlab: GitlabFake,
	checks: (base: string) => Promise<void>,
): Promise<void> {
	return withServer(
		linearWithGitlab([linkedTicket], gitlabFake(gitlab)),
		3600,
		checks,
		[linearPin],
		gitlabEnv,
	);
}
