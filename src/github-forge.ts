import type { Fetch } from "./fetch.ts";
import { loadLinkedPulls, type ReviewEvidence } from "./github-pulls.ts";
import type { GithubReads } from "./github-reads.ts";
import { readAutoMerge } from "./github-repo-query.ts";
import { type Forge, TrackerError } from "./ports.ts";
import { githubKey } from "./ticket-key.ts";

export const githubHost = "github.com";

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
					seenReviews.set(githubKey(repo, pull.number), {
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
		pullOfUrl({ protocol, pathname, search, hash }) {
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
		},
	};
}
