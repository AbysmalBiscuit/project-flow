import type { Fetch } from "../src/fetch.ts";
import { repoReadFromHandler, urlOf } from "./support.ts";

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

/**
 * Keeps the lists of each issue and PR that a recorded `RepoRead` page holds,
 * so that a later `RepoLists` read gets the same recorded lists.
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
	const repo = String(read.nameWithOwner ?? "").toLowerCase();
	for (const issue of [
		...nodesOf(read.issues),
		...nodesOf(data?.editedIssues),
	]) {
		lists.set(`${repo}#i${issue.number}`, { comments: issue.comments });
	}
	for (const pull of [
		...nodesOf(read.openPullRequests),
		...nodesOf(read.mergedPullRequests),
	]) {
		lists.set(`${repo}#p${pull.number}`, {
			reviews: pull.reviews,
			comments: pull.comments,
			reactions: pull.reactions,
			statusCheckRollup: pull.statusCheckRollup,
		});
	}
}

function answerLists(lists: Map<string, Node>, body: string): Response {
	const parsed = JSON.parse(body) as {
		query?: string;
		variables?: { owner?: string; name?: string };
	};
	const repo =
		`${parsed.variables?.owner ?? ""}/${parsed.variables?.name ?? ""}`.toLowerCase();
	const repository: Record<string, unknown> = {};
	for (const match of (parsed.query ?? "").matchAll(
		/([ip]\d+): (?:issue|pullRequest)\(number: \d+\)/g,
	)) {
		const alias = match[1] ?? "";
		repository[alias] = lists.get(`${repo}#${alias}`) ?? {};
	}
	return Response.json({ data: { repository } });
}

function resourceLimited(payload: unknown): boolean {
	return JSON.stringify(payload ?? null).includes("RESOURCE_LIMITS_EXCEEDED");
}

function repositoryLists(payload: unknown): boolean {
	if (typeof payload !== "object" || payload === null) {
		return false;
	}
	if (resourceLimited(payload)) {
		return true;
	}
	const repository = (payload as { data?: { repository?: unknown } }).data
		?.repository;
	return (
		typeof repository === "object" &&
		repository !== null &&
		Object.keys(repository).some((key) => /^[ip]\d+$/.test(key))
	);
}

export function answerRecordedRepoRead(fetchImpl: Fetch): Fetch {
	const lists = new Map<string, Node>();
	const wrapped: Fetch = async (input, init) => {
		const body = typeof init?.body === "string" ? init.body : "";
		const answered = await fetchImpl(input, init);
		if (urlOf(input) !== "https://api.github.com/graphql") {
			return answered;
		}
		if (body.includes("query BlockerStates")) {
			const states = await blockerStatesFromHandler(body, fetchImpl);
			return states ?? answered;
		}
		if (body.includes("query RepoLists")) {
			const payload: unknown = answered.ok
				? await answered
						.clone()
						.json()
						.catch(() => null)
				: null;
			return repositoryLists(payload) ? answered : answerLists(lists, body);
		}
		if (!body.includes("query RepoRead")) {
			return answered;
		}
		const read = await answerRepoRead(input, init, answered, fetchImpl);
		rememberLists(
			lists,
			await read
				.clone()
				.json()
				.catch(() => null),
		);
		return read;
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
