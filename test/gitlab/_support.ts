import type { ProjectReport } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import approvals from "../fixtures/gitlab/approvals.json";
import branches from "../fixtures/gitlab/branches.json";
import jobs from "../fixtures/gitlab/jobs.json";
import opened from "../fixtures/gitlab/merge-requests-opened.json";
import pipelines from "../fixtures/gitlab/pipelines.json";
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

const api = `https://gitlab.com/api/v4/projects/${encodeURIComponent(gitlabRepo)}`;

type MergeRequest = (typeof opened)[number];

export type GitlabFake = {
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
	/** Each GitLab request URL that the app sent. */
	sent?: string[];
};

function byKey<Value>(
	record: Record<string, Value> | undefined,
	key: string | undefined,
): Value | undefined {
	return key === undefined ? undefined : record?.[key];
}

/**
 * Answers the GitLab API from the responses that `test/fixtures/gitlab/record.ts`
 * recorded. The notes read needs a token to record, so it answers an empty list.
 */
export function gitlabFake(options: GitlabFake = {}): Fetch {
	const openRequests = opened.map((request) => ({
		...request,
		...options.open?.[request.iid],
	}));
	const merged = options.merged ?? [];
	return async (input) => {
		const url = new URL(urlOf(input));
		options.sent?.push(url.href);
		if (url.href === "https://gitlab.com/api/v4/user") {
			return json({ id: 2274988, username: "lev" }, options.userStatus ?? 200);
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
