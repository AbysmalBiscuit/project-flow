import { z } from "zod";

import type {
	BotCheck,
	BotComment,
	BotReaction,
	BotReview,
	PullRequest,
} from "./domain.ts";
import { reviewStateValue } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubHeaders, pages } from "./github-pages.ts";
import { type PullLink, TrackerError } from "./ports.ts";
import { githubKey } from "./ticket-key.ts";

export const githubPull = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	draft: z.boolean().optional(),
	body: z.string().nullable(),
	head: z.object({ ref: z.string(), sha: z.string().optional() }),
	state: z.string(),
	merged_at: z.string().nullable().optional(),
	auto_merge: z.unknown().nullable().optional(),
});

/**
 * Loads each PR in order. A PR that fails to load is skipped, so one broken PR
 * never fails the project; the next poll reads it again.
 */
async function loadEachPull<T>(
	sources: Iterable<T>,
	load: (source: T) => Promise<PullRequest | null>,
): Promise<PullRequest[]> {
	const pulls: PullRequest[] = [];
	for (const source of sources) {
		const pull = await load(source).catch(() => null);
		if (pull !== null) {
			pulls.push(pull);
		}
	}
	return pulls;
}

/**
 * Loads each linked open PR once, with the keys of every ticket that links it,
 * then the merged history of each repo.
 */
export async function loadLinkedPulls(
	token: string,
	fetchImpl: Fetch,
	links: PullLink[],
	historyRepos: string[],
	seen: Map<string, ReviewEvidence>,
): Promise<PullRequest[]> {
	const targets = new Map<
		string,
		{ repo: string; number: number; closingKeys: string[] }
	>();
	for (const link of links) {
		const key = githubKey(link.repo, link.number);
		const target = targets.get(key);
		if (target === undefined) {
			targets.set(key, {
				repo: link.repo,
				number: link.number,
				closingKeys: [link.ticketKey],
			});
		} else if (!target.closingKeys.includes(link.ticketKey)) {
			target.closingKeys.push(link.ticketKey);
		}
	}
	const pulls = await loadEachPull(
		targets.values(),
		({ repo, number, closingKeys }) =>
			loadOpenPull(token, fetchImpl, repo, number, closingKeys),
	);
	const repos = new Set([...pulls.map((pull) => pull.repo), ...historyRepos]);
	for (const repo of repos) {
		pulls.push(...(await mergedPullHistory(repo, token, fetchImpl, seen)));
	}
	return pulls;
}

async function loadOpenPull(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	number: number,
	closingKeys: string[],
): Promise<PullRequest | null> {
	const response = await fetchImpl(
		`https://api.github.com/repos/${repo}/pulls/${number}`,
		{ headers: githubHeaders(token) },
	);
	if (!response.ok) {
		throw new TrackerError(
			`GitHub list pulls failed (HTTP ${response.status}): ${repo}`,
			response.status,
		);
	}
	const pull = githubPull.parse(await response.json());
	const body = pull.body ?? "";
	const merged = (pull.merged_at ?? null) !== null;
	if (pull.state !== "open" && !merged) {
		return null;
	}
	const head = merged ? "" : (pull.head.sha ?? "");
	const review =
		head === ""
			? { checks: [], comments: [], reviews: [], reactions: [] }
			: await pullReview(
					repo,
					pull.number,
					head,
					pull.draft === true,
					token,
					fetchImpl,
				);
	const headCommittedAt =
		merged || pull.draft === true || head === ""
			? null
			: await fetchHeadCommittedAt(repo, head, token, fetchImpl);
	return {
		repo,
		number: pull.number,
		url: pull.html_url,
		title: pull.title,
		draft: pull.draft === true,
		branch: pull.head.ref,
		body,
		closingKeys,
		headSha: head,
		headCommittedAt,
		merged,
		autoMerge: pull.auto_merge != null,
		...review,
	};
}

async function fetchJson(
	url: string,
	token: string,
	fetchImpl: Fetch,
	label: string,
): Promise<unknown> {
	const response = await fetchImpl(url, { headers: githubHeaders(token) });
	if (!response.ok) {
		throw new TrackerError(
			`GitHub ${label} failed (HTTP ${response.status}): ${url}`,
			response.status,
		);
	}
	return response.json();
}

async function fetchRows<Row, Mapped>(
	start: string,
	repo: string,
	token: string,
	fetchImpl: Fetch,
	label: string,
	row: z.ZodType<Row>,
	map: (item: Row) => Mapped | null,
): Promise<Mapped[]> {
	const mapped: Mapped[] = [];
	const bodies = await pages(start, token, fetchImpl, repo, label);
	for (const body of bodies) {
		for (const item of z.array(row).parse(body)) {
			const value = map(item);
			if (value !== null) {
				mapped.push(value);
			}
		}
	}
	return mapped;
}

const loginRow = z.object({
	user: z.object({ login: z.string() }).nullable(),
});

async function fetchChecks(
	repo: string,
	sha: string,
	token: string,
	fetchImpl: Fetch,
): Promise<BotCheck[]> {
	const body = await fetchJson(
		`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
		token,
		fetchImpl,
		"list checks",
	);
	return z
		.object({
			check_runs: z.array(
				z.object({
					name: z.string(),
					status: z.string(),
					conclusion: z.string().nullable(),
				}),
			),
		})
		.parse(body).check_runs;
}

function fetchComments(
	repo: string,
	number: number,
	token: string,
	fetchImpl: Fetch,
): Promise<BotComment[]> {
	return fetchRows(
		`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100&page=1`,
		repo,
		token,
		fetchImpl,
		"list comments",
		loginRow.extend({
			body: z.string().nullable(),
			created_at: z.string().optional(),
			reactions: z.object({ total_count: z.number().optional() }).optional(),
		}),
		(comment) =>
			comment.user === null
				? null
				: {
						login: comment.user.login,
						body: comment.body ?? "",
						createdAt: comment.created_at ?? null,
						reactions: comment.reactions?.total_count ?? 0,
					},
	);
}

function fetchReviews(
	repo: string,
	number: number,
	token: string,
	fetchImpl: Fetch,
): Promise<BotReview[]> {
	return fetchRows(
		`https://api.github.com/repos/${repo}/pulls/${number}/reviews?per_page=100&page=1`,
		repo,
		token,
		fetchImpl,
		"list reviews",
		loginRow.extend({
			commit_id: z.string(),
			state: reviewStateValue.optional(),
		}),
		(review) =>
			review.user === null
				? null
				: {
						login: review.user.login,
						commitId: review.commit_id,
						...(review.state === undefined ? {} : { state: review.state }),
					},
	);
}

function fetchReactions(
	repo: string,
	number: number,
	token: string,
	fetchImpl: Fetch,
): Promise<BotReaction[]> {
	return fetchRows(
		`https://api.github.com/repos/${repo}/issues/${number}/reactions?per_page=100&page=1`,
		repo,
		token,
		fetchImpl,
		"list reactions",
		loginRow.extend({ content: z.string(), created_at: z.string().optional() }),
		(reaction) =>
			reaction.user === null
				? null
				: {
						login: reaction.user.login,
						content: reaction.content,
						createdAt: reaction.created_at ?? null,
					},
	);
}

export type ReviewEvidence = Pick<
	PullRequest,
	"checks" | "comments" | "reviews" | "reactions"
>;

async function mergedPullHistory(
	repo: string,
	token: string,
	fetchImpl: Fetch,
	seen: Map<string, ReviewEvidence>,
): Promise<PullRequest[]> {
	const response = await fetchImpl(
		`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`,
		{ headers: githubHeaders(token) },
	);
	if (!response.ok) {
		return [];
	}
	const page = z.array(githubPull).parse(await response.json());
	const merged = page.filter((pull) => (pull.merged_at ?? null) !== null);
	return loadEachPull(merged, async (pull) => {
		const head = pull.head.sha ?? "";
		const key = githubKey(repo, pull.number);
		const review =
			seen.get(key) ??
			(await pullReview(repo, pull.number, head, false, token, fetchImpl));
		seen.set(key, review);
		return {
			repo,
			number: pull.number,
			url: pull.html_url,
			title: pull.title,
			draft: pull.draft === true,
			branch: pull.head.ref,
			body: pull.body ?? "",
			closingKeys: [],
			headSha: head,
			headCommittedAt: null,
			merged: true,
			...review,
		};
	});
}

const githubCommit = z.object({
	commit: z.object({
		committer: z.object({ date: z.string() }).nullable(),
	}),
});

export async function fetchHeadCommittedAt(
	repo: string,
	sha: string,
	token: string,
	fetchImpl: Fetch,
): Promise<string | null> {
	const response = await fetchImpl(
		`https://api.github.com/repos/${repo}/commits/${sha}`,
		{ headers: githubHeaders(token) },
	);
	if (!response.ok) {
		return null;
	}
	const parsed = githubCommit.safeParse(await response.json());
	if (!parsed.success) {
		return null;
	}
	return parsed.data.commit.committer?.date ?? null;
}

export async function pullReview(
	repo: string,
	number: number,
	sha: string,
	draft: boolean,
	token: string,
	fetchImpl: Fetch,
): Promise<ReviewEvidence> {
	if (draft) {
		return { checks: [], comments: [], reviews: [], reactions: [] };
	}
	const [checks, comments, reviews, reactions] = await Promise.all([
		fetchChecks(repo, sha, token, fetchImpl),
		fetchComments(repo, number, token, fetchImpl),
		fetchReviews(repo, number, token, fetchImpl),
		fetchReactions(repo, number, token, fetchImpl),
	]);
	return { checks, comments, reviews, reactions };
}
