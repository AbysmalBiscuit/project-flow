import type { Fetch } from "../../src/fetch.ts";
import approvals from "../fixtures/gitlab/approvals.json";
import branches from "../fixtures/gitlab/branches.json";
import jobs from "../fixtures/gitlab/jobs.json";
import merged from "../fixtures/gitlab/merge-requests-merged.json";
import opened from "../fixtures/gitlab/merge-requests-opened.json";
import notes from "../fixtures/gitlab/notes.json";
import pipelines from "../fixtures/gitlab/pipelines.json";
import { json, urlOf } from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";

export const gitlabRepo = "acme/widget";
export const linearProject = "widget-launch-0d42ae5d46d0";
export const linearName = "Widget launch";
export const gitlabEnv = {
	LINEAR_API_KEY: "recorded-linear-key",
	GITLAB_TOKEN: "recorded-gitlab-token",
};

const api = `https://gitlab.com/api/v4/projects/${encodeURIComponent(gitlabRepo)}`;

type MergeRequest = (typeof opened)[number];

export type GitlabFake = {
	/** Changes to the recorded open merge requests, by iid. */
	open?: Record<number, Partial<MergeRequest>>;
	/** The jobs of each pipeline, by pipeline id, in place of the recorded jobs. */
	jobs?: Record<string, unknown[]>;
	/** The HTTP status of `GET /user`. */
	userStatus?: number;
	/** Each GitLab request URL that the app sent. */
	sent?: string[];
};

function byKey<Value>(
	record: Record<string, Value>,
	key: string | undefined,
): Value | undefined {
	return key === undefined ? undefined : record[key];
}

/** Answers the GitLab API from the recorded responses of the `acme/widget` scratch repo. */
export function gitlabFake(options: GitlabFake = {}): Fetch {
	const openRequests = opened.map((request) => ({
		...request,
		...options.open?.[request.iid],
	}));
	return async (input) => {
		const url = new URL(urlOf(input));
		options.sent?.push(url.href);
		if (url.href === "https://gitlab.com/api/v4/user") {
			return json({ id: 9120441, username: "lev" }, options.userStatus ?? 200);
		}
		const path = url.pathname.slice(new URL(api).pathname.length);
		if (!url.href.startsWith(api)) {
			return json({ message: "404 Not found" }, 404);
		}
		if (path === "/merge_requests") {
			const state = url.searchParams.get("state");
			return json(state === "merged" ? merged : openRequests);
		}
		if (path === "/repository/branches") {
			return json(branches);
		}
		const pipeline = path.match(/^\/pipelines\/(\d+)\/jobs$/)?.[1];
		if (pipeline !== undefined) {
			return json(byKey(options.jobs ?? jobs, pipeline) ?? []);
		}
		const [, iid, rest] = path.match(/^\/merge_requests\/(\d+)(\/\w+)?$/) ?? [];
		if (rest === "/pipelines") {
			return json(byKey(pipelines, iid) ?? []);
		}
		if (rest === "/approvals") {
			return json(byKey(approvals, iid) ?? { approved_by: [] });
		}
		if (rest === "/notes") {
			return json(byKey(notes, iid) ?? []);
		}
		const request = [...openRequests, ...merged].find(
			(item) => String(item.iid) === iid,
		);
		return request === undefined
			? json({ message: "404 Not found" }, 404)
			: json(request);
	};
}

/** A Linear ticket whose attachments link the merge requests of `acme/widget`. */
export function linearTicket(number: number, attached: number[]) {
	return {
		id: `issue-${number}`,
		identifier: `WID-${number}`,
		title: `Linear ticket ${number}`,
		updatedAt: "2026-10-01T00:00:00.000Z",
		state: { type: "started" },
		attachments: {
			nodes: attached.map((iid) => ({
				url: `https://gitlab.com/${gitlabRepo}/-/merge_requests/${iid}`,
				title: `MR ${iid}`,
				sourceType: "gitlab",
			})),
		},
	};
}

/** Linear answers for the Linear project, and GitLab answers for each GitLab URL. */
export function linearWithGitlab(
	issues: Record<string, unknown>[],
	gitlab: Fetch,
): Fetch {
	const linear = linearFake({
		project: { id: "project-1", name: linearName, slugId: linearProject },
		issues,
	});
	return (input, init) =>
		urlOf(input).startsWith("https://gitlab.com/")
			? gitlab(input, init)
			: linear(input, init);
}
