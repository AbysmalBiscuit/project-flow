import { z } from "zod";

import type {
	FetchedThread,
	PostedReply,
	ReplyRequest,
	ThreadComment,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubGraphql } from "./github-graphql.ts";
import { fetchWithSignal, githubHeaders, pages } from "./github-pages.ts";
import { TrackerBodyError } from "./graphql.ts";
import { TrackerError } from "./ports.ts";
import { repoParts } from "./project-ref.ts";
import { numberedKeyParts } from "./ticket-key.ts";

const githubThreadComment = z.object({
	id: z.number(),
	body: z.string().nullable().optional(),
	html_url: z.string().optional(),
	created_at: z.string().optional(),
	user: z.object({ login: z.string() }).nullable().optional(),
	in_reply_to_id: z.number().nullable().optional(),
});

const githubReview = z.object({
	id: z.number(),
	body: z.string().nullable().optional(),
	html_url: z.string().optional(),
	submitted_at: z.string().nullable().optional(),
	user: z.object({ login: z.string() }).nullable().optional(),
});

/** A review with a body, as a top-level comment: a reply to it goes to the ticket. */
function reviewComment(
	review: z.infer<typeof githubReview>,
): Omit<ThreadComment, "html"> {
	return {
		id: `review-${review.id}`,
		body: review.body ?? "",
		author: review.user?.login ?? "",
		createdAt: review.submitted_at ?? "",
		url: review.html_url ?? "",
		parentId: null,
		kind: "comment",
		children: [],
	};
}

const postedComment = z.object({
	id: z.number(),
	body: z.string().nullable().optional(),
	html_url: z.string(),
	created_at: z.string(),
});

function toThreadComment(
	comment: z.infer<typeof githubThreadComment>,
	kind: ThreadComment["kind"],
): Omit<ThreadComment, "html"> {
	return {
		id: String(comment.id),
		body: comment.body ?? "",
		author: comment.user?.login ?? "",
		createdAt: comment.created_at ?? "",
		url: comment.html_url ?? "",
		parentId:
			comment.in_reply_to_id === undefined || comment.in_reply_to_id === null
				? null
				: String(comment.in_reply_to_id),
		kind,
		children: [],
	};
}

const linkedPullsQuery = `query LinkedPulls($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		issue(number: $number) {
			closedByPullRequestsReferences(first: 10) {
				nodes { number repository { nameWithOwner } }
			}
		}
	}
}`;

const linkedPull = z.object({
	number: z.number(),
	repository: z.object({ nameWithOwner: z.string() }).optional(),
});

const linkedPulls = z.object({
	repository: z.object({
		issue: z
			.object({
				closedByPullRequestsReferences: z.object({
					nodes: z.array(linkedPull),
				}),
			})
			.nullable(),
	}),
});

export async function fetchGithubThread(
	token: string,
	fetchImpl: Fetch,
	project: string,
	key: string,
	signal?: AbortSignal,
): Promise<FetchedThread | null> {
	const parsed = numberedKeyParts(key);
	if (parsed === null) {
		return null;
	}
	const { repo, number } = parsed;
	const issueUrl = `https://api.github.com/repos/${repo}/issues/${number}`;
	const commentPages = pages(
		`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100&page=1`,
		token,
		fetchImpl,
		repo,
		"fetch thread",
		signal,
	);
	void commentPages.catch(() => undefined);
	const issueResponse = await fetchWithSignal(
		fetchImpl,
		issueUrl,
		{
			headers: githubHeaders(token),
		},
		signal,
	);
	if (issueResponse.status === 404) {
		return null;
	}
	if (!issueResponse.ok) {
		throw new TrackerError(
			`GitHub fetch thread failed (HTTP ${issueResponse.status})`,
			issueResponse.status,
		);
	}
	const issue = z
		.object({
			title: z.string(),
			html_url: z.string(),
			pull_request: z.unknown().optional(),
		})
		.parse(await issueResponse.json());
	const linked =
		issue.pull_request === undefined
			? linkedReviewTargets(token, fetchImpl, repo, number, signal)
			: Promise.resolve([{ repo, number }]);
	const [listedComments, reviewTargets] = await Promise.all([
		commentPages,
		linked,
	]);
	const comments = listedComments.flatMap((item) =>
		z
			.array(githubThreadComment)
			.parse(item)
			.map((comment) => toThreadComment(comment, "comment")),
	);
	const targetPages = (path: string, label: string) =>
		Promise.all(
			reviewTargets.map((target) =>
				pages(
					`https://api.github.com/repos/${target.repo}/pulls/${target.number}/${path}?per_page=100&page=1`,
					token,
					fetchImpl,
					target.repo,
					label,
					signal,
				),
			),
		);
	const [reviewCommentPages, reviewPages] = await Promise.all([
		targetPages("comments", "fetch review thread"),
		targetPages("reviews", "fetch reviews"),
	]);
	const review = reviewCommentPages.flatMap((listed) =>
		listed.flatMap((item) =>
			z
				.array(githubThreadComment)
				.parse(item)
				.map((comment) => toThreadComment(comment, "review")),
		),
	);
	const reviews = reviewPages.flatMap((listed) =>
		listed.flatMap((item) =>
			z
				.array(githubReview)
				.parse(item)
				.filter((entry) => (entry.body ?? "").trim() !== "")
				.map(reviewComment),
		),
	);
	return {
		tracker: "github",
		threaded: false,
		project,
		key,
		title: issue.title,
		url: issue.html_url,
		comments: [...comments, ...reviews, ...review],
	};
}

async function linkedReviewTargets(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	number: number,
	signal?: AbortSignal,
): Promise<{ repo: string; number: number }[]> {
	const parts = repoParts(repo);
	if (parts === null) {
		return [];
	}
	const { owner, name } = parts;
	const linked = await githubGraphql(
		{ token, fetchImpl, ...(signal === undefined ? {} : { signal }) },
		{
			query: linkedPullsQuery,
			variables: { owner, name, number },
			data: linkedPulls,
			label: "fetch thread",
			subject: repo,
		},
	).catch((error: unknown) => {
		if (error instanceof TrackerError && !(error instanceof TrackerBodyError)) {
			return null;
		}
		throw error;
	});
	if (linked === null) {
		return [];
	}
	const targets: { repo: string; number: number }[] = [];
	for (const node of linked.repository.issue?.closedByPullRequestsReferences
		.nodes ?? []) {
		const pullRepo = node.repository?.nameWithOwner ?? repo;
		if (
			targets.some(
				(target) => target.repo === pullRepo && target.number === node.number,
			)
		) {
			continue;
		}
		targets.push({ repo: pullRepo, number: node.number });
	}
	return targets;
}

export async function postGithubReply(
	token: string,
	fetchImpl: Fetch,
	reply: ReplyRequest,
): Promise<PostedReply> {
	const parsed = numberedKeyParts(reply.key);
	if (parsed === null) {
		throw new TrackerError(
			"GitHub reply failed: ticket key has no number",
			400,
		);
	}
	const { repo, number } = parsed;
	const review = reply.kind === "review";
	const parent = reply.parentId === undefined ? null : Number(reply.parentId);
	if (review && (parent === null || !Number.isInteger(parent))) {
		throw new TrackerError(
			"GitHub reply failed: review thread has no parent",
			400,
		);
	}
	const url = review
		? `https://api.github.com/repos/${repo}/pulls/${number}/comments`
		: `https://api.github.com/repos/${repo}/issues/${number}/comments`;
	const payload =
		review && parent !== null
			? { body: reply.body, in_reply_to: parent }
			: { body: reply.body };
	const response = await fetchImpl(url, {
		method: "POST",
		headers: {
			...githubHeaders(token),
			"content-type": "application/json",
		},
		body: JSON.stringify(payload),
	});
	if (response.status === 404) {
		throw new TrackerError(
			"GitHub reply failed (HTTP 404): ticket not found",
			404,
		);
	}
	if (!response.ok) {
		throw new TrackerError(
			`GitHub reply failed (HTTP ${response.status})`,
			response.status,
		);
	}
	const created = postedComment.parse(await response.json());
	return {
		id: String(created.id),
		body: created.body ?? reply.body,
		url: created.html_url,
		createdAt: created.created_at,
	};
}

export async function addGithubLabel(
	token: string,
	fetchImpl: Fetch,
	key: string,
	label: string,
): Promise<void> {
	const parsed = numberedKeyParts(key);
	if (parsed === null) {
		throw new TrackerError(
			"GitHub label failed: ticket key has no number",
			400,
		);
	}
	const response = await fetchImpl(
		`https://api.github.com/repos/${parsed.repo}/issues/${parsed.number}/labels`,
		{
			method: "POST",
			headers: {
				...githubHeaders(token),
				"content-type": "application/json",
			},
			body: JSON.stringify({ labels: [label] }),
		},
	);
	if (!response.ok) {
		throw new TrackerError(
			`GitHub label failed (HTTP ${response.status})`,
			response.status,
		);
	}
}
