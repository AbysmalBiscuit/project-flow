import { z } from "zod";

import type { PullRequest } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { mergedPullHistory, type ReviewEvidence } from "./github-pulls.ts";
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

type Target = {
	repo: string;
	owner: string;
	name: string;
	number: number;
	closingKeys: string[];
};

function pullsByNumberQuery(count: number, size: number): string {
	const variables = Array.from(
		{ length: count },
		(_, at) => `$owner${at}: String!, $name${at}: String!, $number${at}: Int!`,
	);
	const fields = Array.from(
		{ length: count },
		(_, at) => `p${at}: repository(owner: $owner${at}, name: $name${at}) {
		pullRequest(number: $number${at}) {
			${pullNodeFields}
			reviews(first: ${size}) { ${reviewSelection} }
			comments(first: ${size}) { ${pullCommentSelection} }
			reactions(first: ${size}) { ${reactionSelection} }
			statusCheckRollup { contexts(first: ${size}) { ${checkSelection} } }
		}
	}`,
	);
	return `query PullsByNumber(${variables.join(", ")}) {
	${fields.join("\n\t")}
}`;
}

const linkedPullNode = graphqlPullNode.extend({
	reviews: fullPullLists.shape.reviews,
	comments: fullPullLists.shape.comments,
	reactions: livePullLists.shape.reactions,
	statusCheckRollup: livePullLists.shape.statusCheckRollup.default(null),
});

type LinkedPullNode = z.infer<typeof linkedPullNode>;

const linkedPullAlias = z
	.object({ pullRequest: linkedPullNode.nullable() })
	.nullable();

/** The later pages of the lists that an open PR shows. A merged PR shows none. */
function laterPages(node: LinkedPullNode) {
	if (node.mergedAt != null || node.isDraft) {
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
 * lists. A PR that GitHub cannot find or read, or whose page fails, is left
 * out; the other PRs of the chunk stay.
 */
async function readChunk(
	token: string,
	fetchImpl: Fetch,
	chunk: Target[],
): Promise<PullRequest[]> {
	const subject = [...new Set(chunk.map((target) => target.repo))].join(", ");
	const body = await postPollQuery(token, fetchImpl, subject, (size) => ({
		query: pullsByNumberQuery(chunk.length, size),
		variables: Object.fromEntries(
			chunk.flatMap((target, at) => [
				[`owner${at}`, target.owner],
				[`name${at}`, target.name],
				[`number${at}`, target.number],
			]),
		),
	}));
	if (body === null) {
		throw new TrackerError(`GitHub read linked PRs failed: ${subject}`, 404);
	}
	const { data, broken } = pollData(body, subject, ([alias]) =>
		typeof alias === "string" && /^p\d+$/.test(alias) ? alias : null,
	);
	const read = chunk.flatMap((target, at) => {
		const node = broken.has(`p${at}`)
			? null
			: linkedPullAlias.safeParse(data[`p${at}`]).data?.pullRequest;
		return node === null || node === undefined ? [] : [{ node, target }];
	});
	const brokenPages = new Set<string>();
	await readPages(
		token,
		fetchImpl,
		subject,
		read.flatMap(({ node }) => laterPages(node)),
		brokenPages,
	);
	return read.flatMap(({ node, target }) => {
		const pull = brokenPages.has(node.id) ? null : linkedPull(node, target);
		return pull === null ? [] : [pull];
	});
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
		pulls.push(...(await readChunk(token, fetchImpl, chunk)));
	}
	const repos = new Set([...pulls.map((pull) => pull.repo), ...historyRepos]);
	const histories = await Promise.all(
		[...repos].map((repo) => mergedPullHistory(repo, token, fetchImpl, seen)),
	);
	return [...pulls, ...histories.flat()];
}
