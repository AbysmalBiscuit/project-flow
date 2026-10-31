import { z } from "zod";

import type { Fetch } from "./fetch.ts";
import { graphqlActor, graphqlComment } from "./github-comment.ts";
import {
	githubGraphql,
	graphqlConnection,
	postGithubGraphql,
} from "./github-graphql.ts";
import {
	type Connection,
	connectionPage,
	githubIssue,
	issueTicketFields,
	nestedPageSize,
	nextCursor,
	pageSize,
} from "./github-issue.ts";
import { graphqlData, type GraphqlQuery } from "./graphql.ts";
import { TrackerError } from "./ports.ts";
import { repoParts } from "./project-ref.ts";
import { sameRepo } from "./repo-key.ts";

const mergedPageBound = 10;

type RepoIncludes = {
	issues: boolean;
	openPulls: boolean;
	mergedPulls: boolean;
	refs: boolean;
	labels: boolean;
	edited: boolean;
};

export const closingSelection = `nodes { number } ${connectionPage}`;

const pullNodeFields = `id number title url isDraft body state mergedAt updatedAt headRefName baseRefName headRefOid
				autoMergeRequest { enabledAt }
				commits(last: 1) { nodes { commit { committedDate } } }
				closingIssuesReferences(first: 10, userLinkedOnly: true) { ${closingSelection} }`;

export const issueNodeFields = `id ${issueTicketFields(nestedPageSize)}`;

function repoReadQuery(include: RepoIncludes, size: number): string {
	const variables = [
		"$owner: String!",
		"$name: String!",
		...(include.issues ? ["$afterIssues: String", "$since: DateTime"] : []),
		...(include.openPulls ? ["$afterPulls: String"] : []),
		...(include.refs ? ["$afterRefs: String"] : []),
		...(include.labels ? ["$afterLabels: String"] : []),
		...(include.edited
			? ["$afterEdited: String", "$editedQuery: String!"]
			: []),
	];
	const editedFilter = include.edited
		? `editedIssues: search(first: ${size}, after: $afterEdited, type: ISSUE, query: $editedQuery) {
			nodes { ... on Issue { ${issueNodeFields} } }
			${connectionPage}
		}`
		: "";
	return `query RepoRead(${variables.join(", ")}) {
	repository(owner: $owner, name: $name) {
		nameWithOwner
		autoMergeAllowed
		${
			include.refs
				? `refs(refPrefix: "refs/heads/", first: ${size}, after: $afterRefs) {
			nodes { name }
			${connectionPage}
		}`
				: ""
		}
		${
			include.labels
				? `labels(first: ${size}, after: $afterLabels) {
			nodes { name color }
			${connectionPage}
		}`
				: ""
		}
		${
			include.issues
				? `issues(first: ${size}, after: $afterIssues, states: [OPEN, CLOSED], filterBy: { since: $since }, orderBy: { field: UPDATED_AT, direction: DESC }) {
			nodes { ${issueNodeFields} }
			${connectionPage}
		}`
				: ""
		}
		${
			include.openPulls
				? `openPullRequests: pullRequests(first: ${size}, after: $afterPulls, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
			nodes { ${pullNodeFields} }
			${connectionPage}
		}`
				: ""
		}
		${
			include.mergedPulls
				? `mergedPullRequests: pullRequests(first: ${mergedPageBound}, states: [MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
			nodes { ${pullNodeFields} }
			${connectionPage}
		}`
				: ""
		}
	}
	${editedFilter}
}`;
}

export const issueCommentSelection = `nodes { databaseId body createdAt updatedAt author { login } reactions { totalCount } } ${connectionPage}`;

export const pullCommentSelection = `nodes { author { login } body createdAt reactions { totalCount } } ${connectionPage}`;

export const reviewSelection = `nodes { author { login } commit { oid } state } ${connectionPage}`;

export const reactionSelection = `nodes { user { login } content createdAt } ${connectionPage}`;

export const checkSelection = `nodes { ... on CheckRun { name status conclusion } } ${connectionPage}`;

export const labelSelection = `nodes { name } ${connectionPage}`;

export const dependencySelection = `nodes { number title state repository { nameWithOwner } } ${connectionPage}`;

/**
 * Reads lists by node id. `full` takes the comments, and a PR's reviews, of
 * each changed item. `live` takes a PR's reactions and checks, which change
 * with no change to the PR's `updatedAt`.
 */
function repoListsQuery(size: number): string {
	return `query RepoLists($full: [ID!]!, $live: [ID!]!) {
	full: nodes(ids: $full) {
		... on Issue { id comments(first: ${size}) { ${issueCommentSelection} } }
		... on PullRequest {
			id
			reviews(first: ${size}) { ${reviewSelection} }
			comments(first: ${size}) { ${pullCommentSelection} }
		}
	}
	live: nodes(ids: $live) {
		... on PullRequest {
			id
			reactions(first: ${size}) { ${reactionSelection} }
			statusCheckRollup { contexts(first: ${size}) { ${checkSelection} } }
		}
	}
}`;
}

/** Ids with comment lists in one `RepoLists` request. */
const fullPerBatch = 40;

/** Ids with reaction and check lists in one `RepoLists` request. */
const livePerBatch = 50;

/** Continuation pages in one `RepoPages` request. */
const pagesPerBatch = 20;

export const graphqlIssueNode = githubIssue.extend({ id: z.string() });

const checkConclusion = z.enum([
	"ACTION_REQUIRED",
	"CANCELLED",
	"FAILURE",
	"NEUTRAL",
	"SKIPPED",
	"STALE",
	"STARTUP_FAILURE",
	"SUCCESS",
	"TIMED_OUT",
]);

const checkStatus = z.enum([
	"COMPLETED",
	"IN_PROGRESS",
	"PENDING",
	"QUEUED",
	"REQUESTED",
	"WAITING",
]);

const reviewStateGraphql = z.enum([
	"APPROVED",
	"CHANGES_REQUESTED",
	"COMMENTED",
	"DISMISSED",
	"PENDING",
]);

const reactionContent = z.enum([
	"CONFUSED",
	"EYES",
	"HEART",
	"HOORAY",
	"LAUGH",
	"ROCKET",
	"THUMBS_DOWN",
	"THUMBS_UP",
]);

export const graphqlPullNode = z.object({
	id: z.string(),
	number: z.number(),
	title: z.string(),
	url: z.string(),
	isDraft: z.boolean(),
	body: z.string().nullable().optional(),
	state: z.string(),
	mergedAt: z.string().nullable().optional(),
	updatedAt: z.string().optional(),
	headRefName: z.string(),
	baseRefName: z.string().optional(),
	headRefOid: z.string(),
	autoMergeRequest: z.unknown().nullable().optional(),
	commits: graphqlConnection(
		z.object({
			commit: z.object({
				committedDate: z.string().nullable().optional(),
			}),
		}),
	).optional(),
	closingIssuesReferences: graphqlConnection(
		z.object({ number: z.number() }),
	).optional(),
});

export const graphqlReview = z.object({
	author: graphqlActor.optional(),
	commit: z.object({ oid: z.string() }).nullable().optional(),
	state: reviewStateGraphql,
});

export const graphqlPullComment = z.object({
	author: graphqlActor.optional(),
	body: z.string().nullable().optional(),
	createdAt: z.string().optional(),
	reactions: z.object({ totalCount: z.number() }).optional(),
});

export const graphqlReaction = z.object({
	user: graphqlActor.optional(),
	content: reactionContent,
	createdAt: z.string().optional(),
});

export const graphqlCheck = z.object({
	name: z.string().optional(),
	status: checkStatus.optional(),
	conclusion: checkConclusion.nullable().optional(),
});

export const fullIssueLists = z.object({
	id: z.string(),
	comments: graphqlConnection(graphqlComment),
});

export const fullPullLists = z.object({
	id: z.string(),
	reviews: graphqlConnection(graphqlReview),
	comments: graphqlConnection(graphqlPullComment),
});

export const livePullLists = z.object({
	id: z.string(),
	reactions: graphqlConnection(graphqlReaction),
	statusCheckRollup: z
		.object({ contexts: graphqlConnection(graphqlCheck) })
		.nullable(),
});

export type PullLists = {
	reviews?: z.infer<typeof fullPullLists>["reviews"] | undefined;
	comments?: z.infer<typeof fullPullLists>["comments"] | undefined;
	reactions?: z.infer<typeof livePullLists>["reactions"] | undefined;
	statusCheckRollup?: z.infer<typeof livePullLists>["statusCheckRollup"];
};

const graphqlLabelNode = z.object({ name: z.string(), color: z.string() });

const repoReadPage = z.object({
	repository: z
		.object({
			nameWithOwner: z.string(),
			autoMergeAllowed: z.boolean().nullable().optional().catch(null),
			refs: graphqlConnection(
				z.object({ name: z.string() }).nullable(),
			).optional(),
			labels: graphqlConnection(graphqlLabelNode).optional(),
			issues: graphqlConnection(graphqlIssueNode).optional(),
			openPullRequests: graphqlConnection(graphqlPullNode).optional(),
			mergedPullRequests: graphqlConnection(graphqlPullNode).optional(),
		})
		.nullable(),
	editedIssues: graphqlConnection(graphqlIssueNode.nullable()).optional(),
});

type RepoReadPage = z.infer<typeof repoReadPage>;

type PageCursors = {
	issues: string | null;
	pulls: string | null;
	refs: string | null;
	labels: string | null;
	edited: string | null;
};

const autoMergeQuery = `query RepoRead($owner: String!, $name: String!) {
	repository(owner: $owner, name: $name) { nameWithOwner autoMergeAllowed }
}`;

const autoMergeRead = z.object({
	repository: z
		.object({
			nameWithOwner: z.string(),
			autoMergeAllowed: z.boolean().nullable(),
		})
		.nullable(),
});

function notFoundAsNull(error: unknown): null {
	if (error instanceof TrackerError && error.status === 404) {
		return null;
	}
	throw error;
}

export async function readAutoMerge(
	token: string,
	fetchImpl: Fetch,
	repo: string,
): Promise<boolean> {
	const parts = repoParts(repo);
	if (parts === null) {
		return false;
	}
	const read = await githubGraphql(
		{ token, fetchImpl },
		{
			query: autoMergeQuery,
			variables: { owner: parts.owner, name: parts.name },
			data: autoMergeRead,
			label: "read repo",
			subject: repo,
		},
	).catch(notFoundAsNull);
	if (read === null) {
		return false;
	}
	const repository = read.repository;
	if (repository === null || !sameRepo(repository.nameWithOwner, repo)) {
		throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
	}
	return repository.autoMergeAllowed === true;
}

const graphqlErrors = z.object({
	errors: z
		.array(
			z.object({
				message: z.string(),
				path: z.array(z.union([z.string(), z.number()])).optional(),
			}),
		)
		.min(1),
});

function resourceLimited(body: unknown): boolean {
	const parsed = graphqlErrors.safeParse(body);
	return (
		parsed.success &&
		parsed.data.errors.some((error) =>
			error.message.includes("Resource limits for this query exceeded"),
		)
	);
}

/**
 * Sends one poll query at the full page size. A query that GitHub refuses for
 * its cost goes again once at half the page size. A 404 gives null.
 */
export async function postPollQuery(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	build: (size: number) => Pick<GraphqlQuery, "query" | "variables">,
	size = pageSize,
): Promise<unknown> {
	const body = await postGithubGraphql(
		{ token, fetchImpl },
		{ ...build(size), label: "read repo", subject: repo },
	).catch(notFoundAsNull);
	if (body !== null && size === pageSize && resourceLimited(body)) {
		return postPollQuery(token, fetchImpl, repo, build, pageSize / 2);
	}
	return body;
}

const pollPage = z.object({ data: z.record(z.string(), z.unknown()) });

type ErrorPath = (string | number)[];

/**
 * The data of a poll query, with the PRs whose own node or page has an error.
 * `brokenPull` names the PR an error path points at. Any other error fails the
 * read.
 */
export function pollData(
	body: unknown,
	repo: string,
	brokenPull: (path: ErrorPath) => string | null = () => null,
): { data: Record<string, unknown>; broken: Set<string> } {
	const broken = new Set<string>();
	for (const error of graphqlErrors.safeParse(body).data?.errors ?? []) {
		const pull = error.path === undefined ? null : brokenPull(error.path);
		if (pull === null) {
			throw new TrackerError(`GitHub read repo failed: ${error.message}`, 502, [
				error.message,
			]);
		}
		broken.add(pull);
	}
	const parsed = pollPage.safeParse(body);
	if (!parsed.success) {
		throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
	}
	return { data: parsed.data.data, broken };
}

export async function readRepoPage(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	since: Date | null,
	cursors: PageCursors,
	include: RepoIncludes,
): Promise<RepoReadPage | null> {
	const parts = repoParts(repo);
	if (parts === null) {
		return null;
	}
	const sinceStamp = since?.toISOString() ?? null;
	const variables: Record<string, string | null> = {
		owner: parts.owner,
		name: parts.name,
	};
	if (include.issues) {
		variables.afterIssues = cursors.issues;
		variables.since = sinceStamp;
	}
	if (include.openPulls) {
		variables.afterPulls = cursors.pulls;
	}
	if (include.refs) {
		variables.afterRefs = cursors.refs;
	}
	if (include.labels) {
		variables.afterLabels = cursors.labels;
	}
	if (include.edited && sinceStamp !== null) {
		variables.afterEdited = cursors.edited;
		variables.editedQuery = `repo:${repo} is:issue updated:>=${sinceStamp}`;
	}
	const body = await postPollQuery(token, fetchImpl, repo, (size) => ({
		query: repoReadQuery(include, size),
		variables,
	}));
	if (body === null) {
		return null;
	}
	const page = graphqlData(
		"GitHub",
		{ data: repoReadPage, label: "read repo", subject: repo },
		body,
	);
	if (
		page.repository === null ||
		!sameRepo(page.repository.nameWithOwner, repo)
	) {
		throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
	}
	return page;
}

export const emptyCursors: PageCursors = {
	issues: null,
	pulls: null,
	refs: null,
	labels: null,
	edited: null,
};

const noIncludes: RepoIncludes = {
	issues: false,
	openPulls: false,
	mergedPulls: false,
	refs: false,
	labels: false,
	edited: false,
};

export function onlyInclude(key: keyof RepoIncludes): RepoIncludes {
	return { ...noIncludes, [key]: true };
}

export const firstIncludes = (since: Date | null): RepoIncludes => ({
	issues: true,
	openPulls: true,
	mergedPulls: true,
	refs: true,
	labels: true,
	edited: since !== null,
});

export async function collectConnection<T>(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	since: Date | null,
	first: Connection<T> | undefined,
	cursorKey: keyof PageCursors,
	include: RepoIncludes,
	read: (page: RepoReadPage) => Connection<T> | null | undefined,
): Promise<T[]> {
	const nodes = (first?.nodes ?? []).flatMap((node) =>
		node === undefined ? [] : [node],
	);
	let cursor = nextCursor(first);
	while (cursor !== null) {
		const page = await readRepoPage(
			token,
			fetchImpl,
			repo,
			since,
			{ ...emptyCursors, [cursorKey]: cursor },
			include,
		);
		if (page === null || page.repository === null) {
			throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
		}
		const connection = read(page);
		nodes.push(
			...(connection?.nodes ?? []).flatMap((node) =>
				node === undefined ? [] : [node],
			),
		);
		cursor = nextCursor(connection);
	}
	return nodes;
}

export function chunked<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		chunks.push(items.slice(start, start + size));
	}
	return chunks;
}

const nodeId = z.object({ id: z.string() });

/**
 * Reads the `full` and `live` lists of each id with `nodes(ids:)` batches. A
 * PR whose own node has an error goes in `broken`. Any other missing node
 * fails the read, so no other item loses its lists.
 */
export async function readLists(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	ids: { full: string[]; live: string[] },
	pulls: Set<string>,
	broken: Set<string>,
): Promise<{ full: Map<string, unknown>; live: Map<string, unknown> }> {
	const found = {
		full: new Map<string, unknown>(),
		live: new Map<string, unknown>(),
	};
	const full = chunked(ids.full, fullPerBatch);
	const live = chunked(ids.live, livePerBatch);
	for (let index = 0; index < Math.max(full.length, live.length); index += 1) {
		const batch = { full: full[index] ?? [], live: live[index] ?? [] };
		const read = pollData(
			await postPollQuery(token, fetchImpl, repo, (size) => ({
				query: repoListsQuery(size),
				variables: batch,
			})),
			repo,
			([kind, at]) => {
				const id =
					(kind === "full" || kind === "live") && typeof at === "number"
						? batch[kind][at]
						: undefined;
				return id !== undefined && pulls.has(id) ? id : null;
			},
		);
		for (const id of read.broken) {
			broken.add(id);
		}
		for (const kind of ["full", "live"] as const) {
			const nodes = z.array(z.unknown()).safeParse(read.data[kind]).data ?? [];
			batch[kind].forEach((id, at) => {
				const node = nodes[at];
				if (broken.has(id)) {
					return;
				}
				if (nodeId.safeParse(node).data?.id !== id) {
					throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
				}
				found[kind].set(id, node);
			});
		}
	}
	return found;
}

/** One more page of a list that the poll has read only in part. */
type PendingPage = {
	id: string;
	pull: boolean;
	cursor: string;
	selection: (size: number, after: string) => string;
	accept: (node: unknown) => string | null;
};

type PagePath = {
	type: "Issue" | "PullRequest";
	field: string;
	wrap?: string;
	args?: string;
};

const pageHolder = z.record(z.string(), z.unknown());

function child(value: unknown, key: string): unknown {
	return pageHolder.safeParse(value).data?.[key];
}

/** The next page of `path` on node `id`, or null when `target` is complete. */
export function pendingPage<Node extends z.ZodType>(
	id: string,
	path: PagePath,
	selection: string,
	node: Node,
	target: z.infer<ReturnType<typeof graphqlConnection<Node>>> | undefined,
): PendingPage | null {
	const cursor = nextCursor(target);
	if (target === undefined || cursor === null) {
		return null;
	}
	const connection = graphqlConnection(node);
	return {
		id,
		pull: path.type === "PullRequest",
		cursor,
		selection: (size, after) => {
			const list = `${path.field}(first: ${size}, after: ${after}${path.args ?? ""}) { ${selection} }`;
			return `... on ${path.type} { ${path.wrap === undefined ? list : `${path.wrap} { ${list} }`} }`;
		},
		accept: (data) => {
			const holder = path.wrap === undefined ? data : child(data, path.wrap);
			const parsed = connection.safeParse(child(holder, path.field));
			if (!parsed.success) {
				throw new TrackerError(
					`GitHub read repo failed: ${path.field} of ${id}`,
					502,
				);
			}
			target.nodes.push(...parsed.data.nodes);
			return nextCursor(parsed.data);
		},
	};
}

function repoPagesQuery(pages: PendingPage[], size: number): string {
	const variables = pages
		.map((_, at) => `$id${at}: ID!, $after${at}: String!`)
		.join(", ");
	const parts = pages.map(
		(page, at) =>
			`c${at}: node(id: $id${at}) { ${page.selection(size, `$after${at}`)} }`,
	);
	return `query RepoPages(${variables}) {
	${parts.join("\n\t")}
}`;
}

/**
 * Reads every pending page, many items per request, until each list ends. A
 * PR whose own page has an error goes in `broken` and gets no more pages.
 */
export async function readPages(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	pages: (PendingPage | null)[],
	broken: Set<string>,
): Promise<void> {
	let open = pages.flatMap((page) => (page === null ? [] : [page]));
	while (open.length > 0) {
		const next: PendingPage[] = [];
		for (const batch of chunked(
			open.filter((page) => !broken.has(page.id)),
			pagesPerBatch,
		)) {
			const read = pollData(
				await postPollQuery(token, fetchImpl, repo, (size) => ({
					query: repoPagesQuery(batch, size),
					variables: Object.fromEntries(
						batch.flatMap((page, at) => [
							[`id${at}`, page.id],
							[`after${at}`, page.cursor],
						]),
					),
				})),
				repo,
				([alias]) => {
					const page = batch[Number(String(alias).slice(1))];
					return String(alias).startsWith("c") && page?.pull === true
						? page.id
						: null;
				},
			);
			for (const id of read.broken) {
				broken.add(id);
			}
			batch.forEach((page, at) => {
				if (broken.has(page.id)) {
					return;
				}
				const cursor = page.accept(read.data[`c${at}`]);
				if (cursor !== null) {
					next.push({ ...page, cursor });
				}
			});
		}
		open = next;
	}
}
