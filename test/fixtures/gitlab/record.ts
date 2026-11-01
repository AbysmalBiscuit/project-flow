/**
 * Writes the GitLab fixtures of this folder from public repos. Run it with
 * `bun test/fixtures/gitlab/record.ts`. The scratch repo reads need no token.
 * The notes read needs `GITLAB_TOKEN`, so the run skips it with no token.
 * The rows of the third-party repo keep only the fields that the forge reads.
 * The membership list of projects needs a token, so the run records the
 * scratch project itself, and the fake lists it as the one member project.
 */
import { join } from "node:path";

import { workItemsQuery } from "../../../src/gitlab-tracker.ts";

const api = "https://gitlab.com/api/v4/projects";
const scratch = `${api}/${encodeURIComponent("AbysmalBiscuit/project-flow-scratch")}`;
const publicRepo = `${api}/${encodeURIComponent("gitlab-org/cli")}`;
/** An open PR of the public repo whose newest pipeline runs on a merged-results commit. */
const mergedResultsPull = 4260;
/** A merged PR of the public repo. */
const mergedPull = 3702;

const token = process.env.GITLAB_TOKEN?.trim() ?? "";
const headers: Record<string, string> =
	token === "" ? {} : { authorization: `Bearer ${token}` };

type Row = Record<string, unknown>;

async function read<Body>(url: string): Promise<Body> {
	const response = await fetch(url, { headers });
	if (!response.ok) {
		throw new Error(`${url}: HTTP ${response.status}`);
	}
	return (await response.json()) as Body;
}

const write = (name: string, body: unknown) =>
	Bun.write(
		join(import.meta.dir, name),
		`${JSON.stringify(body, null, "\t")}\n`,
	);

function picked(row: Row, fields: readonly string[]): Row {
	return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

const jobFields = ["id", "name", "stage", "status", "allow_failure"] as const;
const mergeRequestFields = [
	"iid",
	"title",
	"description",
	"state",
	"draft",
	"source_branch",
	"sha",
	"web_url",
	"merged_at",
	"merge_when_pipeline_succeeds",
] as const;

const opened = await read<(Row & { iid: number })[]>(
	`${scratch}/merge_requests?state=opened&per_page=100`,
);
const pipelines: Record<string, (Row & { id: number })[]> = {};
const jobs: Record<string, Row[]> = {};
const approvals: Record<string, Row> = {};
const notes: Record<string, Row[]> = {};
for (const { iid } of opened) {
	const base = `${scratch}/merge_requests/${iid}`;
	const listed = await read<(Row & { id: number })[]>(`${base}/pipelines`);
	pipelines[iid] = listed;
	for (const { id } of listed) {
		jobs[id] = await read(`${scratch}/pipelines/${id}/jobs?per_page=100`);
	}
	approvals[iid] = await read(`${base}/approvals`);
	if (token !== "") {
		notes[iid] = await read(`${base}/notes?sort=asc&per_page=100`);
	}
}
await write("merge-requests-opened.json", opened);
await write("pipelines.json", pipelines);
await write("jobs.json", jobs);
await write("approvals.json", approvals);
if (token !== "") {
	await write("notes.json", notes);
}
await write(
	"branches.json",
	await read(`${scratch}/repository/branches?per_page=100`),
);

const [resultsPipeline] = await read<(Row & { id: number })[]>(
	`${publicRepo}/merge_requests/${mergedResultsPull}/pipelines`,
);
if (resultsPipeline === undefined) {
	throw new Error("the merged-results PR has no pipeline");
}
await write("merged-results-pipeline.json", resultsPipeline);
await write(
	"merged-results-pull.json",
	picked(
		await read(`${publicRepo}/merge_requests/${mergedResultsPull}`),
		mergeRequestFields,
	),
);
const resultsJobs = await read<Row[]>(
	`${publicRepo}/pipelines/${resultsPipeline.id}/jobs?per_page=100`,
);
await write(
	"merged-results-jobs.json",
	resultsJobs.map((job) => picked(job, jobFields)),
);
await write(
	"merge-request-merged.json",
	picked(
		await read(`${publicRepo}/merge_requests/${mergedPull}`),
		mergeRequestFields,
	),
);

const workItems: Record<string, unknown> = {};
for (const [state, sort] of [
	["opened", "CREATED_DESC"],
	["closed", "UPDATED_DESC"],
] as const) {
	const response = await fetch("https://gitlab.com/api/graphql", {
		method: "POST",
		headers: { ...headers, "content-type": "application/json" },
		body: JSON.stringify({
			query: workItemsQuery,
			variables: {
				path: "AbysmalBiscuit/project-flow-scratch",
				state,
				sort,
				after: null,
			},
		}),
	});
	if (!response.ok) {
		throw new Error(`work items ${state}: HTTP ${response.status}`);
	}
	workItems[state] = await response.json();
}
await write("work-items.json", workItems);
await write(
	"project.json",
	picked(await read(scratch), [
		"id",
		"path_with_namespace",
		"name_with_namespace",
		"web_url",
		"last_activity_at",
		"archived",
	]),
);
