import { z } from "zod";

import type { Fetch } from "./fetch.ts";
import { loadLinkedPulls } from "./github-linked-pulls.ts";
import { githubHeaders } from "./github-pages.ts";
import { keepMergedEvidence, type ReviewEvidence } from "./github-pulls.ts";
import type { GithubReads } from "./github-reads.ts";
import { readAutoMerge } from "./github-repo-query.ts";
import {
	type Forge,
	type PullSize,
	type PullTarget,
	RateLimited,
	TrackerError,
} from "./ports.ts";

const pullSize = z
	.object({
		additions: z.number(),
		deletions: z.number(),
		changed_files: z.number(),
		created_at: z.string(),
		merged_at: z.string().nullable(),
	})
	.transform((pull): PullSize => ({
		additions: pull.additions,
		deletions: pull.deletions,
		changedFiles: pull.changed_files,
		openedAt: pull.created_at,
		mergedAt: pull.merged_at,
	}));

const refusal = z.object({
	message: z.string(),
	errors: z.array(z.unknown()).optional(),
});

/** The reason that GitHub gives for a refused write: its listed errors, else its message. */
async function refusalReason(
	response: Response,
	action: string,
): Promise<TrackerError> {
	const refused = refusal.safeParse(await response.json().catch(() => null));
	const listed = refused.success
		? (refused.data.errors ?? []).filter(
				(item): item is string => typeof item === "string",
			)
		: [];
	const reason =
		listed.length > 0
			? listed.join("; ")
			: refused.success
				? refused.data.message
				: `GitHub ${action} failed (HTTP ${response.status})`;
	return new TrackerError(reason, response.status);
}

/** The time GitHub takes reads again, when a refused response reports a rate limit. */
function rateLimitRetry(response: Response): Date | null {
	if (response.status !== 403 && response.status !== 429) {
		return null;
	}
	const retryAfter = response.headers.get("retry-after");
	if (retryAfter !== null && Number.isFinite(Number(retryAfter))) {
		return new Date(Date.now() + Number(retryAfter) * 1000);
	}
	const reset = response.headers.get("x-ratelimit-reset");
	if (response.headers.get("x-ratelimit-remaining") === "0" && reset !== null) {
		return new Date(Number(reset) * 1000);
	}
	return null;
}

export function githubForge(
	token: string,
	fetchImpl: Fetch,
	reads: GithubReads,
): Forge {
	const seenReviews = new Map<string, ReviewEvidence>();
	const autoMergeByRepo = new Map<string, Promise<boolean>>();
	const readOf = async (repo: string) => {
		const batched = await reads.repo(repo, null);
		if (batched === null) {
			throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
		}
		return batched;
	};
	return {
		beginPoll() {
			reads.clear();
			autoMergeByRepo.clear();
		},
		forgetRepo(repo) {
			reads.forget(repo);
			autoMergeByRepo.delete(repo);
		},
		async listPulls(repo) {
			const { pulls } = await readOf(repo);
			for (const pull of pulls) {
				if (pull.merged) {
					keepMergedEvidence(seenReviews, repo, pull.number, {
						checks: pull.checks,
						comments: pull.comments,
						reviews: pull.reviews,
						reactions: pull.reactions,
					});
				}
			}
			return pulls;
		},
		listLinkedPulls(links, repos) {
			return loadLinkedPulls(token, fetchImpl, links, repos, seenReviews);
		},
		async listBranches(repo) {
			const { branches } = await readOf(repo);
			return branches;
		},
		async repoAutoMerge(repo) {
			const cached = autoMergeByRepo.get(repo);
			if (cached !== undefined) {
				return cached;
			}
			const started = reads.startedRepo(repo);
			const read =
				started === undefined
					? readAutoMerge(token, fetchImpl, repo)
					: started.then((opened) => opened?.autoMerge ?? false);
			autoMergeByRepo.set(repo, read);
			return read;
		},
		pullOfUrl: githubPullOfUrl,
		async pullSize({ repo, number }) {
			const response = await fetchImpl(
				`https://api.github.com/repos/${repo}/pulls/${number}`,
				{
					headers: githubHeaders(token),
				},
			);
			if (!response.ok) {
				const retryAt = rateLimitRetry(response);
				if (retryAt !== null) {
					throw new RateLimited(
						`GitHub read pull rate limited: ${repo}#${number}`,
						response.status,
						retryAt,
					);
				}
				throw new TrackerError(
					`GitHub read pull failed: ${repo}#${number}`,
					response.status,
				);
			}
			return pullSize.parse(await response.json());
		},
		async merge({ repo, number, headSha }) {
			const response = await fetchImpl(
				`https://api.github.com/repos/${repo}/pulls/${number}/merge`,
				{
					method: "PUT",
					headers: {
						...githubHeaders(token),
						"content-type": "application/json",
					},
					body: JSON.stringify({ merge_method: "squash", sha: headSha }),
				},
			);
			if (!response.ok) {
				throw await refusalReason(response, "merge");
			}
		},
		async requestChanges({ repo, number, headSha }, body) {
			const response = await fetchImpl(
				`https://api.github.com/repos/${repo}/pulls/${number}/reviews`,
				{
					method: "POST",
					headers: {
						...githubHeaders(token),
						"content-type": "application/json",
					},
					body: JSON.stringify({
						body,
						event: "REQUEST_CHANGES",
						commit_id: headSha,
					}),
				},
			);
			if (!response.ok) {
				throw await refusalReason(response, "review");
			}
		},
	};
}

export function githubPullOfUrl({
	protocol,
	pathname,
	search,
	hash,
}: URL): PullTarget | null {
	const match = pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)$/);
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
