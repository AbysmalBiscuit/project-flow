import { z } from "zod";

import { heldBlockerIds, refreshedBlockers } from "./blockers.ts";
import type {
	BotCheck,
	BotComment,
	BotReaction,
	BotReview,
	PullRequest,
	Ticket,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { commentFromGithub, graphqlComment } from "./github-comment.ts";
import {
	githubGraphql,
	graphqlConnection,
	graphqlDependency,
} from "./github-graphql.ts";
import {
	connectionPage,
	dependencyRefs,
	ticketFromGithubIssue,
} from "./github-issue.ts";
import type { ReviewEvidence } from "./github-pulls.ts";
import {
	checkSelection,
	chunked,
	closingSelection,
	collectConnection,
	dependencySelection,
	emptyCursors,
	firstIncludes,
	fullIssueLists,
	fullPullLists,
	graphqlCheck,
	graphqlIssueNode,
	graphqlPullComment,
	type graphqlPullNode,
	graphqlReaction,
	graphqlReview,
	issueCommentSelection,
	issueNodeFields,
	labelSelection,
	livePullLists,
	onlyInclude,
	pendingPage,
	pollData,
	postPollQuery,
	pullCommentSelection,
	type PullLists,
	reactionSelection,
	readLists,
	readPages,
	readRepoPage,
	reviewSelection,
} from "./github-repo-query.ts";
import { TrackerError } from "./ports.ts";
import { repoParts } from "./project-ref.ts";
import { numberedKey, sameTicketKey } from "./ticket-key.ts";
import { statusColours } from "./token-palette.ts";

function labelColour(color: string): string {
	const hex = color.replace(/^#/, "");
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
		return statusColours.backlog;
	}
	return `#${hex.toUpperCase()}`;
}

function ticketFromGraphql(
	issue: z.infer<typeof graphqlIssueNode>,
	repo: string,
	listed: IssueComments["nodes"],
): Ticket {
	const state = issue.state.toLowerCase();
	const comments = listed.flatMap((comment) => {
		if (comment === undefined || state !== "open") {
			return [];
		}
		const mapped = commentFromGithub({
			...(comment.databaseId === undefined ? {} : { id: comment.databaseId }),
			body: comment.body,
			created_at: comment.createdAt,
			updated_at: comment.updatedAt,
			user: comment.author ?? null,
			reactions:
				comment.reactions === undefined
					? undefined
					: { total_count: comment.reactions.totalCount },
		});
		return mapped === null ? [] : [mapped];
	});
	return ticketFromGithubIssue(issue, repo, comments);
}

function reviewFromGraphql(pull: PullLists): ReviewEvidence {
	const checks: BotCheck[] = [];
	for (const node of pull.statusCheckRollup?.contexts.nodes ?? []) {
		if (
			node === undefined ||
			node.name === undefined ||
			node.status === undefined
		) {
			continue;
		}
		checks.push({
			name: node.name,
			status: node.status.toLowerCase(),
			conclusion:
				node.conclusion === undefined || node.conclusion === null
					? null
					: node.conclusion.toLowerCase(),
		});
	}
	const comments: BotComment[] = [];
	for (const comment of pull.comments?.nodes ?? []) {
		if (comment === undefined) {
			continue;
		}
		const login = comment.author?.login;
		if (login === undefined) {
			continue;
		}
		comments.push({
			login,
			body: comment.body ?? "",
			createdAt: comment.createdAt ?? null,
			reactions: comment.reactions?.totalCount ?? 0,
		});
	}
	const reviews: BotReview[] = [];
	for (const review of pull.reviews?.nodes ?? []) {
		if (review === undefined) {
			continue;
		}
		const login = review.author?.login;
		const commitId = review.commit?.oid;
		if (login === undefined || commitId === undefined) {
			continue;
		}
		reviews.push({ login, commitId, state: review.state });
	}
	const reactions: BotReaction[] = [];
	for (const reaction of pull.reactions?.nodes ?? []) {
		if (reaction === undefined) {
			continue;
		}
		const login = reaction.user?.login;
		if (login === undefined) {
			continue;
		}
		reactions.push({
			login,
			content: reaction.content.toLowerCase(),
			createdAt: reaction.createdAt ?? null,
		});
	}
	return { checks, comments, reviews, reactions };
}

const noEvidence: ReviewEvidence = {
	checks: [],
	comments: [],
	reviews: [],
	reactions: [],
};

function pullFromGraphql(
	pull: z.infer<typeof graphqlPullNode>,
	repo: string,
	evidence: ReviewEvidence,
): PullRequest | null {
	const merged = pull.mergedAt != null;
	if (pull.state !== "OPEN" && pull.state !== "MERGED" && !merged) {
		return null;
	}
	const keys: string[] = [];
	if (!merged) {
		for (const node of pull.closingIssuesReferences?.nodes ?? []) {
			if (node === undefined) {
				continue;
			}
			const key = numberedKey(repo, node.number);
			if (!keys.includes(key)) {
				keys.push(key);
			}
		}
	}
	const committed = pull.commits?.nodes.at(-1)?.commit.committedDate ?? null;
	return {
		repo,
		number: pull.number,
		url: pull.url,
		title: pull.title,
		draft: pull.isDraft,
		branch: pull.headRefName,
		body: pull.body ?? "",
		closingKeys: keys,
		headSha: pull.headRefOid,
		headCommittedAt: merged || pull.isDraft ? null : committed,
		merged,
		autoMerge: pull.autoMergeRequest != null,
		...(pull.isDraft ? noEvidence : evidence),
	};
}

type IssueComments = z.infer<typeof fullIssueLists>["comments"];

/** The lists of each item as the poll last read them, keyed by ticket key. */
export type StoredLists = {
	issues: Map<string, { updatedAt: string; comments: IssueComments["nodes"] }>;
	pulls: Map<string, { updatedAt: string; evidence: ReviewEvidence }>;
};

const blockerPage = graphqlConnection(graphqlDependency);

const blockerStates = z.object({
	repository: z
		.record(z.string(), z.object({ blockedBy: blockerPage }).nullable())
		.nullable(),
});

async function readBlockerStates(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	numbers: number[],
): Promise<Map<number, z.infer<typeof blockerPage>>> {
	const parts = repoParts(repo);
	const states = new Map<number, z.infer<typeof blockerPage>>();
	if (parts === null || numbers.length === 0) {
		return states;
	}
	const page = 40;
	for (let start = 0; start < numbers.length; start += page) {
		const slice = numbers.slice(start, start + page);
		const collected = slice.map(
			() => [] as z.infer<typeof graphqlDependency>[],
		);
		let cursors: (string | null)[] = slice.map(() => null);
		let pending = true;
		while (pending) {
			const afterNames = slice.map((_, index) => `$after${index}: String`);
			const variableNames = `$owner: String!, $name: String!, ${afterNames.join(", ")}`;
			const fields = slice
				.map(
					(number, index) =>
						`i${index}: issue(number: ${number}) { blockedBy(first: 20, after: $after${index}) { nodes { number title state repository { nameWithOwner } } ${connectionPage} } }`,
				)
				.join("\n");
			const variables: Record<string, string | null> = {
				owner: parts.owner,
				name: parts.name,
			};
			for (const [index, cursor] of cursors.entries()) {
				variables[`after${index}`] = cursor;
			}
			const read = await githubGraphql(
				{ token, fetchImpl },
				{
					query: `query BlockerStates(${variableNames}) { repository(owner: $owner, name: $name) { ${fields} } }`,
					variables,
					data: blockerStates,
					label: "read repo",
					subject: repo,
				},
			);
			const repository = read.repository;
			if (repository === null) {
				throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
			}
			const next: (string | null)[] = [];
			slice.forEach((number, index) => {
				const node = repository[`i${index}`];
				if (node === undefined || node === null) {
					next.push(null);
					return;
				}
				collected[index]?.push(
					...node.blockedBy.nodes.flatMap((item) =>
						item === undefined ? [] : [item],
					),
				);
				const cursor = node.blockedBy.pageInfo?.endCursor ?? null;
				next.push(
					node.blockedBy.pageInfo?.hasNextPage === true && cursor !== null
						? cursor
						: null,
				);
				states.set(number, {
					nodes: collected[index] ?? [],
					pageInfo: { hasNextPage: false, endCursor: null },
				});
			});
			cursors = next;
			pending = cursors.some((cursor) => cursor !== null);
		}
	}
	return states;
}

/** A closed blocker does not change the blocked ticket, so a since read omits it. */
export async function currentBlockers(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	listed: Ticket[],
	held: Ticket[],
): Promise<Ticket[]> {
	const ids = heldBlockerIds(held);
	if (ids.length === 0) {
		return listed;
	}
	const states = await readBlockerStates(token, fetchImpl, repo, ids);
	const refsById = new Map(
		[...states].map(([id, page]) => [
			id,
			dependencyRefs(
				page.nodes.flatMap((node) => (node === undefined ? [] : [node])),
				repo,
			),
		]),
	);
	return refreshedBlockers(listed, held, refsById);
}

/**
 * A repo read starts this long before the last poll, because GitHub can list
 * an issue open for a while after the `updatedAt` and `closedAt` of its close.
 */
const sinceOverlapMs = 5 * 60 * 1000;

const heldIssuePage = 50;

const heldIssueAlias = /^i(\d+)$/;

/**
 * The held open issues that the since read left out and that GitHub now shows
 * closed or changed. A since read never lists again a change that a poll missed.
 */
async function changedHeldIssues(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	held: Ticket[],
	listed: ReadonlySet<number>,
): Promise<z.infer<typeof graphqlIssueNode>[]> {
	const parts = repoParts(repo);
	const keptUpdate = new Map(
		held.flatMap((ticket) => {
			const number = Number(ticket.id);
			return ticket.state === "open" &&
				Number.isInteger(number) &&
				ticket.key !== null &&
				sameTicketKey(ticket.key, numberedKey(repo, number)) &&
				!listed.has(number)
				? [[number, ticket.updatedAt] as const]
				: [];
		}),
	);
	if (parts === null || keptUpdate.size === 0) {
		return [];
	}
	const changed: z.infer<typeof graphqlIssueNode>[] = [];
	for (const slice of chunked([...keptUpdate.keys()], heldIssuePage)) {
		const fields = slice
			.map(
				(number) =>
					`i${number}: issue(number: ${number}) { ${issueNodeFields} }`,
			)
			.join("\n");
		const body = await postPollQuery(token, fetchImpl, repo, () => ({
			query: `query HeldIssues($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
			variables: { owner: parts.owner, name: parts.name },
		}));
		if (body === null) {
			return [];
		}
		const { data } = pollData(body, repo, (path) =>
			path[0] === "repository" && typeof path[1] === "string" ? path[1] : null,
		);
		const repository = z
			.record(z.string(), graphqlIssueNode.nullable().catch(null))
			.nullable()
			.catch(null)
			.parse(data.repository);
		for (const [alias, node] of Object.entries(repository ?? {})) {
			const number = Number(alias.match(heldIssueAlias)?.[1]);
			if (
				node !== null &&
				node.number === number &&
				(node.state.toLowerCase() !== "open" ||
					node.updatedAt !== keptUpdate.get(number))
			) {
				changed.push(node);
			}
		}
	}
	return changed;
}

export async function readRepo(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	lastPoll: Date | null,
	stored: StoredLists,
	held: Ticket[],
): Promise<{
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	labels: { name: string; colour: string }[];
	autoMerge: boolean;
} | null> {
	const since =
		lastPoll === null ? null : new Date(lastPoll.getTime() - sinceOverlapMs);
	const include = firstIncludes(since);
	const opened = await readRepoPage(
		token,
		fetchImpl,
		repo,
		since,
		emptyCursors,
		include,
	);
	if (opened === null) {
		return null;
	}
	const first = opened.repository;
	if (first === null) {
		return null;
	}
	const issues = await collectConnection(
		token,
		fetchImpl,
		repo,
		since,
		first.issues,
		"issues",
		onlyInclude("issues"),
		(page) => page.repository?.issues,
	);
	const edited =
		since === null
			? []
			: (
					await collectConnection(
						token,
						fetchImpl,
						repo,
						since,
						opened.editedIssues,
						"edited",
						onlyInclude("edited"),
						(page) => page.editedIssues,
					)
				).flatMap((issue) =>
					issue === null || issue === undefined ? [] : [issue],
				);
	const seenIssues = new Set(
		issues.flatMap((issue) => (issue === undefined ? [] : [issue.number])),
	);
	for (const issue of edited) {
		if (!seenIssues.has(issue.number)) {
			seenIssues.add(issue.number);
			issues.push(issue);
		}
	}
	if (since !== null) {
		issues.push(
			...(await changedHeldIssues(token, fetchImpl, repo, held, seenIssues)),
		);
	}
	const pullNodes = await collectConnection(
		token,
		fetchImpl,
		repo,
		since,
		first.openPullRequests,
		"pulls",
		onlyInclude("openPulls"),
		(page) => page.repository?.openPullRequests,
	);
	const refNodes = await collectConnection(
		token,
		fetchImpl,
		repo,
		since,
		first.refs,
		"refs",
		onlyInclude("refs"),
		(page) => page.repository?.refs,
	);
	const labelNodes = await collectConnection(
		token,
		fetchImpl,
		repo,
		since,
		first.labels,
		"labels",
		onlyInclude("labels"),
		(page) => page.repository?.labels,
	);
	const issueNodes = issues.flatMap((issue) =>
		issue === undefined ? [] : [issue],
	);
	const openIssues = issueNodes.filter(
		(issue) => issue.state.toLowerCase() === "open",
	);
	const openPullNodes = pullNodes.flatMap((pull) =>
		pull === undefined ? [] : [pull],
	);
	const mergedPullNodes = (first.mergedPullRequests?.nodes ?? []).flatMap(
		(pull) => (pull === undefined || pull === null ? [] : [pull]),
	);
	const allPulls = [...openPullNodes, ...mergedPullNodes];
	// An incremental read lists only the issues GitHub saw change, which
	// includes an edited comment that leaves the issue's updatedAt as it was.
	const changedIssues = openIssues.filter(
		(issue) =>
			since !== null ||
			stored.issues.get(numberedKey(repo, issue.number))?.updatedAt !==
				issue.updatedAt,
	);
	const readable = allPulls.filter((pull) => !pull.isDraft);
	const changedPulls = readable.filter((pull) => {
		const kept = stored.pulls.get(numberedKey(repo, pull.number));
		return kept === undefined || kept.updatedAt !== pull.updatedAt;
	});
	const livePulls = readable.filter(
		(pull) => pull.mergedAt == null || changedPulls.includes(pull),
	);
	const broken = new Set<string>();
	const lists = await readLists(
		token,
		fetchImpl,
		repo,
		{
			full: [...changedIssues, ...changedPulls].map((item) => item.id),
			live: livePulls.map((pull) => pull.id),
		},
		new Set(allPulls.map((pull) => pull.id)),
		broken,
	);
	const commentsById = new Map<string, IssueComments>();
	for (const issue of changedIssues) {
		const parsed = fullIssueLists.safeParse(lists.full.get(issue.id));
		if (!parsed.success) {
			throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
		}
		commentsById.set(issue.id, parsed.data.comments);
	}
	const listsById = new Map<string, PullLists>();
	for (const pull of changedPulls.filter((item) => !broken.has(item.id))) {
		const parsed = fullPullLists.safeParse(lists.full.get(pull.id));
		if (!parsed.success) {
			throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
		}
		listsById.set(pull.id, parsed.data);
	}
	for (const pull of livePulls.filter((item) => !broken.has(item.id))) {
		const parsed = livePullLists.safeParse(lists.live.get(pull.id));
		if (!parsed.success) {
			throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
		}
		listsById.set(pull.id, { ...listsById.get(pull.id), ...parsed.data });
	}
	await readPages(
		token,
		fetchImpl,
		repo,
		[
			...issueNodes.flatMap((issue) => [
				pendingPage(
					issue.id,
					{ type: "Issue", field: "labels" },
					labelSelection,
					z.object({ name: z.string() }),
					issue.labels,
				),
				pendingPage(
					issue.id,
					{ type: "Issue", field: "blockedBy" },
					dependencySelection,
					graphqlDependency,
					issue.blockedBy,
				),
				pendingPage(
					issue.id,
					{ type: "Issue", field: "blocking" },
					dependencySelection,
					graphqlDependency,
					issue.blocking,
				),
				pendingPage(
					issue.id,
					{ type: "Issue", field: "comments" },
					issueCommentSelection,
					graphqlComment,
					commentsById.get(issue.id),
				),
			]),
			...allPulls.flatMap((pull) => {
				const read = listsById.get(pull.id);
				return [
					pendingPage(
						pull.id,
						{
							type: "PullRequest",
							field: "closingIssuesReferences",
							args: ", userLinkedOnly: true",
						},
						closingSelection,
						z.object({ number: z.number() }),
						pull.closingIssuesReferences,
					),
					pendingPage(
						pull.id,
						{ type: "PullRequest", field: "reviews" },
						reviewSelection,
						graphqlReview,
						read?.reviews,
					),
					pendingPage(
						pull.id,
						{ type: "PullRequest", field: "comments" },
						pullCommentSelection,
						graphqlPullComment,
						read?.comments,
					),
					pendingPage(
						pull.id,
						{ type: "PullRequest", field: "reactions" },
						reactionSelection,
						graphqlReaction,
						read?.reactions,
					),
					pendingPage(
						pull.id,
						{
							type: "PullRequest",
							field: "contexts",
							wrap: "statusCheckRollup",
						},
						checkSelection,
						graphqlCheck,
						read?.statusCheckRollup?.contexts,
					),
				];
			}),
		],
		broken,
	);
	const pullOf = (pull: z.infer<typeof graphqlPullNode>) => {
		const key = numberedKey(repo, pull.number);
		if (broken.has(pull.id)) {
			stored.pulls.delete(key);
			return null;
		}
		const kept = stored.pulls.get(key)?.evidence ?? noEvidence;
		const read = listsById.get(pull.id) ?? {};
		const fresh = reviewFromGraphql(read);
		const full = read.reviews !== undefined;
		const live = read.reactions !== undefined;
		const evidence: ReviewEvidence = {
			comments: full ? fresh.comments : kept.comments,
			reviews: full ? fresh.reviews : kept.reviews,
			reactions: live ? fresh.reactions : kept.reactions,
			checks: live ? fresh.checks : kept.checks,
		};
		if (!pull.isDraft && pull.updatedAt !== undefined) {
			stored.pulls.set(key, { updatedAt: pull.updatedAt, evidence });
		}
		return pullFromGraphql(pull, repo, evidence);
	};
	const openPulls = openPullNodes.flatMap((pull) => {
		const mapped = pullOf(pull);
		return mapped?.merged === false ? [mapped] : [];
	});
	const mergedKept = mergedPullNodes.flatMap((pull) => {
		const mapped = pullOf(pull);
		return mapped?.merged === true ? [mapped] : [];
	});
	for (const issue of openIssues) {
		const key = numberedKey(repo, issue.number);
		const comments =
			commentsById.get(issue.id)?.nodes ??
			stored.issues.get(key)?.comments ??
			[];
		stored.issues.set(key, { updatedAt: issue.updatedAt, comments });
		commentsById.set(issue.id, { nodes: comments });
	}
	const tickets = issueNodes
		.filter((issue) => {
			const state = issue.state.toLowerCase();
			return state === "open" || state === "closed";
		})
		.map((issue) =>
			ticketFromGraphql(issue, repo, commentsById.get(issue.id)?.nodes ?? []),
		);
	return {
		tickets,
		pulls: [...openPulls, ...mergedKept],
		branches: refNodes.flatMap((node) =>
			node === null || node === undefined ? [] : [node.name],
		),
		labels: labelNodes.flatMap((label) =>
			label === undefined
				? []
				: [{ name: label.name, colour: labelColour(label.color) }],
		),
		autoMerge: first.autoMergeAllowed === true,
	};
}
