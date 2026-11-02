import { z } from "zod";

import type { PullRequest } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	keepMergedEvidence,
	mergedPullHistory,
	type ReviewEvidence,
} from "./github-pulls.ts";
import {
	checkSelection,
	chunked,
	fullPullLists,
	graphqlCheck,
	graphqlPullComment,
	graphqlPullNode,
	graphqlReaction,
	graphqlReview,
	livePullLists,
	pendingPage,
	pollData,
	postPollQuery,
	pullCommentSelection,
	pullNodeFields,
	reactionSelection,
	readPages,
	reviewSelection,
} from "./github-repo-query.ts";
import {
	noEvidence,
	pullFromGraphql,
	reviewFromGraphql,
} from "./github-repo.ts";
import { type PullLink, TrackerError } from "./ports.ts";
import { repoParts } from "./project-ref.ts";
import { numberedKey } from "./ticket-key.ts";

/**
 * Linked PRs in one `PullsByNumber` request. Each PR asks for four lists of at
 * most one page, which keeps a request far inside the GitHub node limit.
 */
const pullsPerBatch = 40;

const linkedLabel = "read linked PRs";

type Target = {
	repo: string;
	owner: string;
	name: string;
	number: number;
	closingKeys: string[];
};

/** The fields of one linked PR. A merged PR with kept evidence reads no lists. */
function pullFields(lists: boolean, size: number): string {
	return lists
		? `${pullNodeFields}
			reviews(first: ${size}) { ${reviewSelection} }
			comments(first: ${size}) { ${pullCommentSelection} }
			reactions(first: ${size}) { ${reactionSelection} }
			statusCheckRollup { contexts(first: ${size}) { ${checkSelection} } }`
		: pullNodeFields;
}

function pullsByNumberQuery(lists: boolean[], size: number): string {
	const variables = lists.map(
		(_, at) => `$owner${at}: String!, $name${at}: String!, $number${at}: Int!`,
	);
	const fields = lists.map(
		(
			withLists,
			at,
		) => `p${at}: repository(owner: $owner${at}, name: $name${at}) {
		pullRequest(number: $number${at}) {
			${pullFields(withLists, size)}
		}
	}`,
	);
	return `query PullsByNumber(${variables.join(", ")}) {
	${fields.join("\n\t")}
}`;
}

const linkedPullNode = graphqlPullNode.extend({
	reviews: fullPullLists.shape.reviews.optional(),
	comments: fullPullLists.shape.comments.optional(),
	reactions: livePullLists.shape.reactions.optional(),
	statusCheckRollup: livePullLists.shape.statusCheckRollup.default(null),
});

type LinkedPullNode = z.infer<typeof linkedPullNode>;

const linkedPullAlias = z
	.object({ pullRequest: linkedPullNode.nullable() })
	.nullable();

/** The later pages of the lists that the node read. An open draft shows none. */
function laterPages(node: LinkedPullNode) {
	if (node.isDraft && node.mergedAt == null) {
		return [];
	}
	return [
		pendingPage(
			node.id,
			{ type: "PullRequest", field: "reviews" },
			reviewSelection,
			graphqlReview,
			node.reviews,
		),
		pendingPage(
			node.id,
			{ type: "PullRequest", field: "comments" },
			pullCommentSelection,
			graphqlPullComment,
			node.comments,
		),
		pendingPage(
			node.id,
			{ type: "PullRequest", field: "reactions" },
			reactionSelection,
			graphqlReaction,
			node.reactions,
		),
		pendingPage(
			node.id,
			{ type: "PullRequest", field: "contexts", wrap: "statusCheckRollup" },
			checkSelection,
			graphqlCheck,
			node.statusCheckRollup?.contexts,
		),
	];
}

function linkedPull(node: LinkedPullNode, target: Target): PullRequest | null {
	const merged = node.mergedAt != null;
	const pull = pullFromGraphql(
		node,
		target.repo,
		merged ? noEvidence : reviewFromGraphql(node),
	);
	if (pull === null) {
		return null;
	}
	return {
		...pull,
		closingKeys: target.closingKeys,
		...(merged ? { headSha: "" } : {}),
	};
}

/**
 * Reads one chunk of linked PRs in one request, then the later pages of their
 * lists. A PR that GitHub cannot find or read is left out, and so is an open
 * PR whose own page has a GraphQL error. A malformed answer fails the read. The
 * complete lists of a merged PR go in `seen`.
 */
async function readChunk(
	token: string,
	fetchImpl: Fetch,
	chunk: Target[],
	seen: Map<string, ReviewEvidence>,
): Promise<PullRequest[]> {
	const subject = [...new Set(chunk.map((target) => target.repo))].join(", ");
	const lists = chunk.map(
		(target) => !seen.has(numberedKey(target.repo, target.number)),
	);
	const body = await postPollQuery(
		token,
		fetchImpl,
		subject,
		(size) => ({
			query: pullsByNumberQuery(lists, size),
			variables: Object.fromEntries(
				chunk.flatMap((target, at) => [
					[`owner${at}`, target.owner],
					[`name${at}`, target.name],
					[`number${at}`, target.number],
				]),
			),
		}),
		linkedLabel,
	);
	if (body === null) {
		throw new TrackerError(`GitHub ${linkedLabel} failed: ${subject}`, 404);
	}
	const { data, broken } = pollData(
		body,
		subject,
		([alias]) =>
			typeof alias === "string" && /^p\d+$/.test(alias) ? alias : null,
		linkedLabel,
	);
	const read = chunk.flatMap((target, at) => {
		const node = broken.has(`p${at}`)
			? null
			: linkedPullAlias.safeParse(data[`p${at}`]).data?.pullRequest;
		return node === null || node === undefined
			? []
			: [{ node, target, lists: lists[at] === true }];
	});
	const brokenPages = new Set<string>();
	await readPages(
		token,
		fetchImpl,
		subject,
		read.flatMap(({ node }) => laterPages(node)),
		brokenPages,
		linkedLabel,
	);
	const pulls: PullRequest[] = [];
	for (const { node, target, lists: withLists } of read) {
		const complete = !brokenPages.has(node.id);
		if (node.mergedAt == null) {
			const pull = complete ? linkedPull(node, target) : null;
			pulls.push(...(pull === null ? [] : [pull]));
			continue;
		}
		if (withLists && complete) {
			keepMergedEvidence(
				seen,
				target.repo,
				node.number,
				reviewFromGraphql(node),
			);
		}
		const pull = linkedPull(node, target);
		pulls.push(...(pull === null ? [] : [pull]));
	}
	return pulls;
}

function linkTargets(links: PullLink[]): Target[] {
	const targets = new Map<string, Target>();
	for (const link of links) {
		const key = numberedKey(link.repo, link.number);
		const target = targets.get(key);
		const parts = repoParts(link.repo);
		if (target !== undefined) {
			if (!target.closingKeys.includes(link.ticketKey)) {
				target.closingKeys.push(link.ticketKey);
			}
		} else if (parts !== null) {
			targets.set(key, {
				repo: link.repo,
				...parts,
				number: link.number,
				closingKeys: [link.ticketKey],
			});
		}
	}
	return [...targets.values()];
}

/**
 * Loads each linked PR once, with the keys of every ticket that links it,
 * then the merged history of each repo. A failed chunk fails the read, so the
 * poll keeps the PRs of the last good poll.
 */
export async function loadLinkedPulls(
	token: string,
	fetchImpl: Fetch,
	links: PullLink[],
	historyRepos: string[],
	seen: Map<string, ReviewEvidence>,
): Promise<PullRequest[]> {
	const pulls: PullRequest[] = [];
	for (const chunk of chunked(linkTargets(links), pullsPerBatch)) {
		pulls.push(...(await readChunk(token, fetchImpl, chunk, seen)));
	}
	const repos = new Set([...pulls.map((pull) => pull.repo), ...historyRepos]);
	const histories = await Promise.all(
		[...repos].map((repo) => mergedPullHistory(repo, token, fetchImpl, seen)),
	);
	return [...pulls, ...histories.flat()];
}
