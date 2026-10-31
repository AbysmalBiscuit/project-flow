import { z } from "zod";

import type { BotCheck, PullRequest } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { type Forge, type PullTarget, TrackerError } from "./ports.ts";
import { pullKey } from "./ticket-key.ts";

export const gitlabHost = "gitlab.com";

export const missingGitlabToken =
	"GITLAB_TOKEN is missing: set GITLAB_TOKEN to read GitLab PRs.";

export const rejectedGitlabToken =
	"GITLAB_TOKEN was rejected by GitLab (HTTP 401): set a valid token.";

/** The merged PRs of a repo that the expected bots come from. */
const mergedHistorySize = 10;

const mergeRequest = z.object({
	iid: z.number(),
	title: z.string(),
	description: z.string().nullable(),
	state: z.string(),
	draft: z.boolean(),
	source_branch: z.string(),
	sha: z.string().nullable(),
	web_url: z.string(),
	merged_at: z.string().nullable(),
	merge_when_pipeline_succeeds: z.boolean(),
});

type MergeRequest = z.infer<typeof mergeRequest>;

const pipeline = z.object({ id: z.number(), sha: z.string() });

const job = z.object({
	name: z.string(),
	status: z.string(),
	allow_failure: z.boolean(),
});

const approvals = z.object({
	approved_by: z.array(z.object({ user: z.object({ username: z.string() }) })),
});

const note = z.object({
	body: z.string(),
	system: z.boolean(),
	created_at: z.string(),
	author: z.object({ username: z.string() }),
});

const branch = z.object({ name: z.string() });

type Evidence = Pick<PullRequest, "checks" | "comments" | "reviews">;

/** The check of a pipeline job, in the status and conclusion words of the review rules. */
function jobCheck({
	name,
	status,
	allow_failure,
}: z.infer<typeof job>): BotCheck {
	const completed = (conclusion: string): BotCheck => ({
		name,
		status: "completed",
		conclusion,
	});
	switch (status) {
		case "success":
			return completed("success");
		case "failed":
			return completed(allow_failure ? "neutral" : "failure");
		case "canceled":
			return completed("cancelled");
		case "skipped":
		case "manual":
			return completed("skipped");
		case "running":
			return { name, status: "in_progress", conclusion: null };
		default:
			return { name, status: "queued", conclusion: null };
	}
}

export function gitlabPullOfUrl({
	protocol,
	pathname,
	search,
	hash,
}: URL): PullTarget | null {
	const match = pathname.match(/^\/(.+?)\/-\/merge_requests\/(\d+)$/);
	const repo = match?.[1];
	const number = match?.[2];
	if (
		protocol !== "https:" ||
		search !== "" ||
		hash !== "" ||
		repo === undefined ||
		number === undefined
	) {
		return null;
	}
	return { repo, number: Number(number) };
}

/** Answers the HTTP status of the token check against the user endpoint of `host`. */
export async function checkGitlabToken(
	host: string,
	token: string,
	fetchImpl: Fetch,
): Promise<number> {
	const response = await fetchImpl(`https://${host}/api/v4/user`, {
		headers: { authorization: `Bearer ${token}` },
	});
	return response.status;
}

/** The forge of the merge requests of one GitLab host. Project Flow calls each merge request a PR. */
export function gitlabForge(
	host: string,
	token: string,
	fetchImpl: Fetch,
): Forge {
	const headers = { authorization: `Bearer ${token}` };
	const mergedEvidence = new Map<string, Evidence>();

	const apiUrl = (
		repo: string,
		path: string,
		query: Record<string, string> = {},
	): URL => {
		const url = new URL(
			`https://${host}/api/v4/projects/${encodeURIComponent(repo)}${path}`,
		);
		for (const [name, value] of Object.entries(query)) {
			url.searchParams.set(name, value);
		}
		return url;
	};

	const read = async <Schema extends z.ZodType>(
		url: URL,
		schema: Schema,
		repo: string,
	): Promise<{ body: z.infer<Schema>; next: string | null }> => {
		const response = await fetchImpl(url, { headers });
		if (!response.ok) {
			throw new TrackerError(
				`GitLab read failed (HTTP ${response.status}): ${repo}`,
				response.status,
			);
		}
		const next = response.headers.get("x-next-page") ?? "";
		return {
			body: schema.parse(await response.json()),
			next: next === "" ? null : next,
		};
	};

	/** Each item of a list, read 100 at a time. */
	const readAll = async <Item extends z.ZodType>(
		url: URL,
		item: Item,
		repo: string,
	): Promise<z.infer<Item>[]> => {
		const items: z.infer<Item>[] = [];
		let page: string | null = "1";
		while (page !== null) {
			const paged = new URL(url);
			paged.searchParams.set("per_page", "100");
			paged.searchParams.set("page", page);
			const { body, next } = await read(paged, z.array(item), repo);
			items.push(...body);
			page = next;
		}
		return items;
	};

	const evidenceOf = async (
		repo: string,
		request: MergeRequest,
	): Promise<Evidence> => {
		const base = `/merge_requests/${request.iid}`;
		const pipelines = await read(
			apiUrl(repo, `${base}/pipelines`),
			z.array(pipeline),
			repo,
		);
		const head = pipelines.body.find((item) => item.sha === request.sha);
		const jobs =
			head === undefined
				? []
				: await readAll(apiUrl(repo, `/pipelines/${head.id}/jobs`), job, repo);
		const approved = await read(
			apiUrl(repo, `${base}/approvals`),
			approvals,
			repo,
		);
		const notes = await readAll(
			apiUrl(repo, `${base}/notes`, { sort: "asc" }),
			note,
			repo,
		);
		return {
			checks: jobs.map(jobCheck),
			reviews: approved.body.approved_by.map(({ user }) => ({
				login: user.username,
				commitId: request.sha ?? "",
				state: "APPROVED" as const,
			})),
			comments: notes
				.filter((item) => !item.system)
				.map((item) => ({
					login: item.author.username,
					body: item.body,
					createdAt: item.created_at,
				})),
		};
	};

	const pullOf = async (
		repo: string,
		request: MergeRequest,
	): Promise<PullRequest> => {
		const merged = request.merged_at !== null;
		const key = pullKey({ repo, number: request.iid });
		const evidence =
			(merged ? mergedEvidence.get(key) : undefined) ??
			(await evidenceOf(repo, request));
		if (merged) {
			mergedEvidence.set(key, evidence);
		}
		return {
			repo,
			number: request.iid,
			url: request.web_url,
			title: request.title,
			draft: request.draft,
			branch: request.source_branch,
			body: request.description ?? "",
			closingKeys: [],
			headSha: request.sha ?? "",
			headCommittedAt: null,
			merged,
			autoMerge: request.merge_when_pipeline_succeeds,
			reactions: [],
			...evidence,
		};
	};

	const listPulls = async (repo: string): Promise<PullRequest[]> => {
		const open = await readAll(
			apiUrl(repo, "/merge_requests", { state: "opened" }),
			mergeRequest,
			repo,
		);
		const merged = await read(
			apiUrl(repo, "/merge_requests", {
				state: "merged",
				order_by: "updated_at",
				per_page: String(mergedHistorySize),
			}),
			z.array(mergeRequest),
			repo,
		);
		const pulls: PullRequest[] = [];
		for (const request of [...open, ...merged.body]) {
			pulls.push(await pullOf(repo, request));
		}
		return pulls;
	};

	return {
		listPulls,
		async listLinkedPulls(links, repos) {
			const pulls: PullRequest[] = [];
			for (const repo of new Set([
				...links.map((link) => link.repo),
				...repos,
			])) {
				pulls.push(...(await listPulls(repo)));
			}
			const listed = new Map(pulls.map((pull) => [pullKey(pull), pull]));
			for (const link of links) {
				const key = pullKey(link);
				let pull = listed.get(key);
				if (pull === undefined) {
					const { body } = await read(
						apiUrl(link.repo, `/merge_requests/${link.number}`),
						mergeRequest,
						link.repo,
					);
					if (body.state !== "opened" && body.merged_at === null) {
						continue;
					}
					pull = await pullOf(link.repo, body);
					listed.set(key, pull);
					pulls.push(pull);
				}
				if (!pull.closingKeys.includes(link.ticketKey)) {
					pull.closingKeys.push(link.ticketKey);
				}
			}
			return pulls;
		},
		async listBranches(repo) {
			const branches = await readAll(
				apiUrl(repo, "/repository/branches"),
				branch,
				repo,
			);
			return branches.map((item) => item.name);
		},
		repoAutoMerge: () => Promise.resolve(false),
		pullOfUrl: gitlabPullOfUrl,
	};
}
