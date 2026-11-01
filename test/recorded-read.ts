import type { Fetch } from "../src/fetch.ts";
import { urlOf } from "./support/fetch.ts";
import { repoReadFromHandler } from "./support/repo-read.ts";

function nullRepository(body: unknown): boolean {
	if (typeof body !== "object" || body === null || !("data" in body)) {
		return false;
	}
	const data = body.data;
	return (
		typeof data === "object" &&
		data !== null &&
		"repository" in data &&
		data.repository === null
	);
}

function repositoryBody(body: unknown): boolean {
	if (typeof body !== "object" || body === null || !("data" in body)) {
		return false;
	}
	const data = body.data;
	return (
		typeof data === "object" &&
		data !== null &&
		"repository" in data &&
		typeof data.repository === "object" &&
		data.repository !== null &&
		"nameWithOwner" in data.repository
	);
}

async function blockerStatesFromHandler(
	body: string,
	handler: Fetch,
): Promise<Response | null> {
	const parsed = JSON.parse(body) as {
		query?: string;
		variables?: { owner?: string; name?: string };
	};
	const owner = parsed.variables?.owner;
	const name = parsed.variables?.name;
	if (
		owner === undefined ||
		name === undefined ||
		owner === "" ||
		name === ""
	) {
		return null;
	}
	const repo = `${owner}/${name}`;
	const aliases = [
		...(parsed.query ?? "").matchAll(/i(\d+): issue\(number: (\d+)\)/g),
	];
	const repository: Record<string, unknown> = {};
	for (const match of aliases) {
		const index = match[1];
		const number = match[2];
		if (index === undefined || number === undefined) {
			continue;
		}
		const response = await handler(
			`https://api.github.com/repos/${repo}/issues/${number}/dependencies/blocked_by?per_page=100&page=1`,
			{ method: "GET" },
		);
		if (!response.ok) {
			return null;
		}
		const rows = (await response.json()) as Record<string, unknown>[];
		repository[`i${index}`] = {
			blockedBy: {
				nodes: (Array.isArray(rows) ? rows : []).flatMap((row) => {
					const repoUrl = String(row.repository_url ?? row.html_url ?? "");
					const repoMatch = repoUrl.match(/\/repos\/([^/]+\/[^/]+)/);
					return [
						{
							number: row.number,
							title: row.title ?? null,
							state: String(row.state ?? "open").toUpperCase(),
							repository:
								repoMatch?.[1] === undefined
									? { nameWithOwner: repo }
									: { nameWithOwner: repoMatch[1] },
						},
					];
				}),
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		};
	}
	return Response.json({ data: { repository } });
}

type Node = Record<string, unknown>;

function nodesOf(connection: unknown): Node[] {
	if (typeof connection !== "object" || connection === null) {
		return [];
	}
	const nodes = (connection as { nodes?: unknown }).nodes;
	return Array.isArray(nodes)
		? nodes.filter(
				(node): node is Node => typeof node === "object" && node !== null,
			)
		: [];
}

const emptyList = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

/** A node id for a recorded issue or PR, which names its repo and number. */
function recordedId(kind: "issue" | "pull", repo: string, number: unknown) {
	return `${kind}:${repo}#${String(number)}`;
}

function parseRecordedId(
	id: string,
): { kind: string; owner: string; name: string; number: number } | null {
	const match = id.match(/^(issue|pull):([^/]+)\/([^#]+)#(\d+)$/);
	if (
		match?.[1] === undefined ||
		match[2] === undefined ||
		match[3] === undefined
	) {
		return null;
	}
	return {
		kind: match[1],
		owner: match[2],
		name: match[3],
		number: Number(match[4]),
	};
}

/**
 * Gives each recorded issue and PR a node id when it has none, and keeps its
 * lists, so that a later `RepoLists` read gets the same recorded lists.
 */
function rememberLists(lists: Map<string, Node>, payload: unknown): void {
	if (typeof payload !== "object" || payload === null) {
		return;
	}
	const data = (payload as { data?: Node }).data;
	const repository = data?.repository;
	if (typeof repository !== "object" || repository === null) {
		return;
	}
	const read = repository as Node;
	const repo = String(read.nameWithOwner ?? "");
	for (const issue of [
		...nodesOf(read.issues),
		...nodesOf(data?.editedIssues),
	]) {
		issue.id ??= recordedId("issue", repo, issue.number);
		lists.set(String(issue.id), {
			id: issue.id,
			comments: issue.comments ?? emptyList,
		});
	}
	for (const pull of [
		...nodesOf(read.openPullRequests),
		...nodesOf(read.mergedPullRequests),
	]) {
		pull.id ??= recordedId("pull", repo, pull.number);
		lists.set(String(pull.id), {
			id: pull.id,
			reviews: pull.reviews ?? emptyList,
			comments: pull.comments ?? emptyList,
			reactions: pull.reactions ?? emptyList,
			statusCheckRollup: pull.statusCheckRollup ?? null,
		});
	}
}

/** Gives each issue of a `HeldIssues` answer a node id, as `rememberLists` does. */
function rememberHeldIssues(
	lists: Map<string, Node>,
	payload: unknown,
	repo: string,
): void {
	const repository = (payload as { data?: { repository?: unknown } } | null)
		?.data?.repository;
	if (typeof repository !== "object" || repository === null) {
		return;
	}
	for (const issue of Object.values(repository)) {
		if (typeof issue !== "object" || issue === null) {
			continue;
		}
		const node = issue as Node;
		node.id ??= recordedId("issue", repo, node.number);
		lists.set(String(node.id), {
			id: node.id,
			comments: node.comments ?? emptyList,
		});
	}
}

function answerLists(lists: Map<string, Node>, body: string): Response {
	const sent = JSON.parse(body) as {
		variables?: { full?: string[]; live?: string[] };
	};
	const pick = (id: string, keys: string[]) => {
		const kept = lists.get(id);
		if (kept === undefined) {
			return null;
		}
		return Object.fromEntries(
			["id", ...keys].flatMap((key) => (key in kept ? [[key, kept[key]]] : [])),
		);
	};
	return Response.json({
		data: {
			full: (sent.variables?.full ?? []).map((id) =>
				pick(id, ["comments", "reviews"]),
			),
			live: (sent.variables?.live ?? []).map((id) =>
				pick(id, ["reactions", "statusCheckRollup"]),
			),
		},
	});
}

const nestedReviewQuery = `query NestedReview($owner: String!, $name: String!, $number: Int!, $afterReviews: String, $afterComments: String, $afterReactions: String, $afterContexts: String, $afterClosing: String) { recorded }`;
const issueCommentsQuery = `query IssueComments($owner: String!, $name: String!, $number: Int!, $after: String) { recorded }`;
const issueRelationsQuery = `query IssueRelations($owner: String!, $name: String!, $number: Int!, $afterBlockedBy: String, $afterBlocking: String, $afterLabels: String) { recorded }`;

const pullCursor: Record<string, string> = {
	reviews: "afterReviews",
	comments: "afterComments",
	reactions: "afterReactions",
	statusCheckRollup: "afterContexts",
	closingIssuesReferences: "afterClosing",
};

const issueCursor: Record<string, string> = {
	blockedBy: "afterBlockedBy",
	blocking: "afterBlocking",
	labels: "afterLabels",
};

/**
 * Answers each alias of a `RepoPages` read with the per-item page query that
 * the recorded handlers answer: `NestedReview`, `IssueComments` or
 * `IssueRelations`. A failed page becomes a null alias with an error on its
 * path, as GitHub reports one broken node.
 */
async function answerPages(fetchImpl: Fetch, body: string): Promise<Response> {
	const sent = JSON.parse(body) as {
		query?: string;
		variables?: Record<string, string>;
	};
	const data: Record<string, unknown> = {};
	const errors: { message: string; path: string[] }[] = [];
	for (const match of (sent.query ?? "").matchAll(
		/c(\d+): node\(id: \$id\d+\) \{ \.\.\. on (Issue|PullRequest) \{ (\w+)/g,
	)) {
		const at = match[1] ?? "";
		const field = match[3] ?? "";
		const item = parseRecordedId(sent.variables?.[`id${at}`] ?? "");
		if (item === null) {
			data[`c${at}`] = null;
			continue;
		}
		const cursor = sent.variables?.[`after${at}`] ?? null;
		const base = { owner: item.owner, name: item.name, number: item.number };
		const issueComments = item.kind === "issue" && field === "comments";
		const request =
			item.kind === "pull"
				? {
						query: nestedReviewQuery,
						variables: { ...base, [pullCursor[field] ?? field]: cursor },
					}
				: issueComments
					? { query: issueCommentsQuery, variables: { ...base, after: cursor } }
					: {
							query: issueRelationsQuery,
							variables: { ...base, [issueCursor[field] ?? field]: cursor },
						};
		const answered = await fetchImpl("https://api.github.com/graphql", {
			method: "POST",
			body: JSON.stringify(request),
		});
		if (!answered.ok) {
			data[`c${at}`] = null;
			errors.push({
				message: `recorded page failed (HTTP ${answered.status})`,
				path: [`c${at}`],
			});
			continue;
		}
		const payload = (await answered.json().catch(() => null)) as {
			data?: { repository?: { pullRequest?: Node; issue?: Node } };
		} | null;
		const node =
			item.kind === "pull"
				? payload?.data?.repository?.pullRequest
				: payload?.data?.repository?.issue;
		const list =
			field === "statusCheckRollup"
				? {
						statusCheckRollup: {
							contexts:
								(node?.statusCheckRollup as Node | undefined)?.contexts ??
								emptyList,
						},
					}
				: { [field]: node?.[field] ?? emptyList };
		data[`c${at}`] = list;
	}
	return Response.json(errors.length === 0 ? { data } : { data, errors });
}

function resourceLimited(payload: unknown): boolean {
	return JSON.stringify(payload ?? null).includes("RESOURCE_LIMITS_EXCEEDED");
}

/** True when the handler answered a batched read itself. */
function answeredItself(payload: unknown, keys: RegExp): boolean {
	if (typeof payload !== "object" || payload === null) {
		return false;
	}
	if ("errors" in payload) {
		return true;
	}
	const data = (payload as { data?: unknown }).data;
	return (
		typeof data === "object" &&
		data !== null &&
		Object.keys(data).some((key) => keys.test(key))
	);
}

/** A recording with no commit status list means that the commit has no status. */
async function recordedStatuses(answered: Response): Promise<Response> {
	const payload: unknown = await answered
		.clone()
		.json()
		.catch(() => null);
	const listed =
		answered.ok &&
		typeof payload === "object" &&
		payload !== null &&
		"statuses" in payload &&
		Array.isArray(payload.statuses);
	return listed ? answered : Response.json({ statuses: [] });
}

export function answerRecordedRepoRead(fetchImpl: Fetch): Fetch {
	const lists = new Map<string, Node>();
	const wrapped: Fetch = async (input, init) => {
		const body = typeof init?.body === "string" ? init.body : "";
		const answered = await fetchImpl(input, init);
		if (
			/^https:\/\/api\.github\.com\/repos\/.+\/commits\/[^/]+\/status\b/.test(
				urlOf(input),
			)
		) {
			return recordedStatuses(answered);
		}
		if (urlOf(input) !== "https://api.github.com/graphql") {
			return answered;
		}
		if (body.includes("query BlockerStates")) {
			const states = await blockerStatesFromHandler(body, fetchImpl);
			return states ?? answered;
		}
		if (body.includes("query HeldIssues") && answered.ok) {
			const payload: unknown = await answered.json().catch(() => null);
			const variables = (
				JSON.parse(body) as {
					variables?: { owner?: string; name?: string };
				}
			).variables;
			rememberHeldIssues(
				lists,
				payload,
				`${variables?.owner ?? ""}/${variables?.name ?? ""}`,
			);
			return Response.json(payload);
		}
		if (body.includes("query RepoLists") || body.includes("query RepoPages")) {
			const payload: unknown = answered.ok
				? await answered
						.clone()
						.json()
						.catch(() => null)
				: null;
			const failed = !answered.ok && answered.status !== 404;
			if (failed || answeredItself(payload, /^(full|live|c\d+)$/)) {
				return answered;
			}
			return body.includes("query RepoLists")
				? answerLists(lists, body)
				: answerPages(fetchImpl, body);
		}
		if (!body.includes("query RepoRead")) {
			return answered;
		}
		const read = await answerRepoRead(input, init, answered, fetchImpl);
		const payload: unknown = await read
			.clone()
			.json()
			.catch(() => null);
		if (!repositoryBody(payload)) {
			return read;
		}
		rememberLists(lists, payload);
		return Response.json(payload, { status: read.status });
	};
	return wrapped;
}

async function answerRepoRead(
	input: string | URL | Request,
	init: RequestInit | undefined,
	answered: Response,
	fetchImpl: Fetch,
): Promise<Response> {
	if (!answered.ok) {
		if (answered.status !== 404) {
			return answered;
		}
	} else {
		const payload: unknown = await answered
			.clone()
			.json()
			.catch(() => null);
		if (
			repositoryBody(payload) ||
			nullRepository(payload) ||
			resourceLimited(payload)
		) {
			return answered;
		}
	}
	try {
		const read = await repoReadFromHandler(input, init, fetchImpl);
		return read ?? answered;
	} catch {
		return answered;
	}
}
