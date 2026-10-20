import { z } from "zod";
import type {
	Board,
	BotCheck,
	BotComment,
	BotReaction,
	BotReview,
	Comment,
	PostedReply,
	PullRequest,
	ReplyRequest,
	Thread,
	ThreadComment,
	Ticket,
	TicketRef,
	TicketStatus,
} from "./domain.ts";
import {
	backlogColour,
	factoryBoard,
	reviewStateValue,
	statusTypeOfName,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { FoundProject, Tracker, Viewer } from "./ports.ts";

export class TrackerError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "TrackerError";
		this.status = status;
	}
}

export const missingToken =
	'GITHUB_TOKEN is missing: set GITHUB_TOKEN or run "gh auth login".';

const dependency = z.object({
	number: z.number(),
	title: z.string().optional(),
	state: z.string(),
	repository_url: z.string().optional(),
});

const githubIssue = z.object({
	number: z.number(),
	title: z.string(),
	state: z.string(),
	state_reason: z.string().nullable(),
	updated_at: z.string(),
	created_at: z.string().optional(),
	closed_at: z.string().nullable().optional(),
	body: z.string().nullable().optional(),
	milestone: z.object({ title: z.string() }).nullable().optional(),
	labels: z.array(z.object({ name: z.string() })).optional(),
	parent_issue_url: z.string().nullable().optional(),
	issue_dependencies_summary: z
		.object({
			blocked_by: z.number(),
			total_blocked_by: z.number(),
			blocking: z.number().optional(),
			total_blocking: z.number().optional(),
		})
		.optional(),
	pull_request: z.unknown().optional(),
	comments: z.number().optional(),
	assignee: z.object({ login: z.string() }).nullable().optional(),
	assignees: z.array(z.object({ login: z.string() })).optional(),
});

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

const linkedDevelopment = z.object({
	data: z.object({
		repository: z.object({
			pullRequest: z
				.object({
					closingIssuesReferences: z.object({
						nodes: z.array(z.object({ number: z.number() })),
					}),
				})
				.nullable(),
		}),
	}),
});

const developmentQuery = `query LinkedDevelopment($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		pullRequest(number: $number) {
			closingIssuesReferences(first: 10, userLinkedOnly: true) {
				nodes { number }
			}
		}
	}
}`;

const githubIssuePage = z.array(githubIssue);

export function githubHeaders(token: string): HeadersInit {
	return {
		accept: "application/vnd.github+json",
		authorization: `Bearer ${token}`,
		"x-github-api-version": "2022-11-28",
	};
}

type RestEntry = {
	etag: string;
	body: unknown;
	headers: [string, string][];
};

export type RestCache = Map<string, RestEntry>;

const issueList =
	/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?(.*)$/;

function issueWindow(url: string): { repo: string; since: string } | null {
	const match = issueList.exec(url);
	if (match?.[1] === undefined || match[2] === undefined) {
		return null;
	}
	const since = new URLSearchParams(match[2]).get("since");
	if (since === null) {
		return null;
	}
	return { repo: match[1], since };
}

const issueCommentList =
	/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/comments\?(.*)$/;

function commentWindow(url: string): { repo: string; since: string } | null {
	const match = issueCommentList.exec(url);
	if (match?.[1] === undefined || match[2] === undefined) {
		return null;
	}
	const since = new URLSearchParams(match[2]).get("since");
	if (since === null) {
		return null;
	}
	return { repo: match[1], since };
}

function retainWindow(
	cache: RestCache,
	repo: string,
	read: (url: string) => { repo: string; since: string } | null,
): void {
	let current: string | undefined;
	for (const key of cache.keys()) {
		const window = read(key);
		if (window?.repo !== repo) {
			continue;
		}
		if (current === undefined || window.since > current) {
			current = window.since;
		}
	}
	if (current === undefined) {
		return;
	}
	for (const key of cache.keys()) {
		const window = read(key);
		if (window?.repo === repo && window.since < current) {
			cache.delete(key);
		}
	}
}

export function retainIssueWindow(cache: RestCache, repo: string): void {
	retainWindow(cache, repo, issueWindow);
	retainWindow(cache, repo, commentWindow);
}

function restUrl(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

function restKey(url: string): string {
	const parsed = new URL(url);
	parsed.searchParams.sort();
	return parsed.href;
}

function cachedHeaders(entry: RestEntry): Headers {
	const headers = new Headers(entry.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	headers.delete("transfer-encoding");
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	return headers;
}

function storedHeaders(response: Response): [string, string][] {
	return [...response.headers.entries()].filter(
		([name]) =>
			name !== "content-encoding" &&
			name !== "content-length" &&
			name !== "transfer-encoding",
	);
}

function isRestRead(url: string, method: string): boolean {
	if (method !== "GET" && method !== "") {
		return false;
	}
	if (!url.startsWith("https://api.github.com/")) {
		return false;
	}
	return !url.startsWith("https://api.github.com/graphql");
}

export function conditionalFetch(fetchImpl: Fetch, cache: RestCache): Fetch {
	return async (input, init) => {
		const url = restUrl(input);
		const method = (init?.method ?? "GET").toUpperCase();
		if (!isRestRead(url, method)) {
			return fetchImpl(input, init);
		}
		const key = restKey(url);
		const stored = cache.get(key);
		const headers = new Headers(init?.headers);
		if (stored !== undefined && !headers.has("if-none-match")) {
			headers.set("if-none-match", stored.etag);
		}
		const response = await fetchImpl(input, { ...init, headers });
		if (response.status === 304 && stored !== undefined) {
			const replayed = cachedHeaders(stored);
			response.headers.forEach((value, name) => {
				if (name === "etag" || name === "content-length") {
					return;
				}
				replayed.set(name, value);
			});
			const next = response.headers.get("etag");
			const etag = next !== null && next !== "" ? next : stored.etag;
			replayed.set("etag", etag);
			cache.set(key, {
				etag,
				body: stored.body,
				headers: [...replayed.entries()],
			});
			return new Response(JSON.stringify(stored.body), {
				status: 200,
				headers: replayed,
			});
		}
		const next = response.headers.get("etag");
		if (response.ok && next !== null && next !== "") {
			cache.set(key, {
				etag: next,
				body: await response.clone().json(),
				headers: storedHeaders(response),
			});
		}
		return response;
	};
}

function nextPage(link: string | null): string | null {
	if (link === null) {
		return null;
	}
	for (const part of link.split(",")) {
		const match = part.match(/<([^>]+)>;\s*rel="next"/);
		if (match?.[1] !== undefined) {
			return match[1];
		}
	}
	return null;
}

export async function checkToken(
	token: string,
	fetchImpl: Fetch,
): Promise<Response> {
	return fetchImpl("https://api.github.com/user", {
		headers: githubHeaders(token),
	});
}

async function pages(
	start: string,
	token: string,
	fetchImpl: Fetch,
	repo: string,
	label: string,
): Promise<unknown[]> {
	const bodies: unknown[] = [];
	let url: string | null = start;
	while (url !== null) {
		const response = await fetchImpl(url, {
			headers: githubHeaders(token),
		});
		if (!response.ok) {
			throw new Error(
				`GitHub ${label} failed (HTTP ${response.status}): ${repo}`,
			);
		}
		bodies.push(await response.json());
		url = nextPage(response.headers.get("link"));
	}
	return bodies;
}

const githubRepo = z.object({
	full_name: z.string(),
	pushed_at: z.string().nullable().optional(),
});

const pageInfo = z.object({
	hasNextPage: z.boolean(),
	endCursor: z.string().nullable(),
});

const projectNode = z.object({
	id: z.string(),
	number: z.number().int().positive(),
	title: z.string(),
	closed: z.boolean(),
	updatedAt: z.string(),
	owner: z.object({ login: z.string() }).optional(),
});

const projectConnection = z.object({
	nodes: z.array(projectNode),
	pageInfo,
});

const graphqlProjects = z.object({
	data: z.object({
		viewer: z
			.object({
				login: z.string(),
				projectsV2: projectConnection,
				organizations: z.object({
					nodes: z.array(z.object({ login: z.string() })),
					pageInfo,
				}),
			})
			.optional(),
		organization: z
			.object({
				projectsV2: projectConnection,
			})
			.optional(),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

const projectsQuery = `query ViewerProjects($after: String, $orgAfter: String) {
	viewer {
		login
		projectsV2(first: 20, after: $after) {
			nodes { id number title closed updatedAt owner { ... on User { login } ... on Organization { login } } }
			pageInfo { hasNextPage endCursor }
		}
		organizations(first: 20, after: $orgAfter) {
			nodes { login }
			pageInfo { hasNextPage endCursor }
		}
	}
}`;

const orgProjectsQuery = `query OrgProjects($login: String!, $orgProjectAfter: String) {
	organization(login: $login) {
		projectsV2(first: 20, after: $orgProjectAfter) {
			nodes { id number title closed updatedAt owner { ... on User { login } ... on Organization { login } } }
			pageInfo { hasNextPage endCursor }
		}
	}
}`;

function addOpenProjects(
	nodes: z.infer<typeof projectNode>[],
	found: FoundProject[],
	seen: Set<string>,
): void {
	for (const node of nodes) {
		if (seen.has(node.id) || node.owner === undefined) {
			continue;
		}
		seen.add(node.id);
		found.push({
			key: node.id,
			name: node.title,
			tracker: "github",
			updatedAt: node.updatedAt,
			owner: node.owner.login,
			number: node.number,
			closed: node.closed,
		});
	}
}

async function graphqlPage(
	token: string,
	fetchImpl: Fetch,
	query: string,
	variables: Record<string, string | null>,
): Promise<z.infer<typeof graphqlProjects>> {
	const response = await fetchImpl("https://api.github.com/graphql", {
		method: "POST",
		headers: githubHeaders(token),
		body: JSON.stringify({ query, variables }),
	});
	if (!response.ok) {
		throw new Error(`GitHub find projects failed (HTTP ${response.status})`);
	}
	const body: unknown = await response.json();
	if (
		typeof body === "object" &&
		body !== null &&
		"errors" in body &&
		Array.isArray(body.errors)
	) {
		const message = body.errors.find(
			(item): item is { message: string } =>
				typeof item === "object" &&
				item !== null &&
				"message" in item &&
				typeof item.message === "string",
		)?.message;
		if (message !== undefined) {
			throw new Error(`GitHub find projects failed: ${message}`);
		}
	}
	const parsed = graphqlProjects.safeParse(body);
	if (!parsed.success) {
		throw new Error("GitHub find projects failed");
	}
	const page = parsed.data;
	const error = page.errors?.[0];
	if (error !== undefined) {
		throw new Error(`GitHub find projects failed: ${error.message}`);
	}
	return page;
}

async function addOrgProjects(
	token: string,
	fetchImpl: Fetch,
	login: string,
	found: FoundProject[],
	seen: Set<string>,
): Promise<void> {
	let after: string | null = null;
	let done = false;
	while (!done) {
		const page = await graphqlPage(token, fetchImpl, orgProjectsQuery, {
			login,
			orgProjectAfter: after,
		});
		const projects = page.data.organization?.projectsV2;
		if (projects === undefined) {
			throw new Error(`GitHub find projects failed: ${login}`);
		}
		addOpenProjects(projects.nodes, found, seen);
		done = !projects.pageInfo.hasNextPage;
		after = projects.pageInfo.endCursor;
	}
}

export async function findGithubProjects(
	token: string,
	fetchImpl: Fetch,
): Promise<{ projects: FoundProject[]; viewer: Viewer | null }> {
	const found: FoundProject[] = [];
	const seen = new Set<string>();
	const orgs: string[] = [];
	let login = "";
	let after: string | null = null;
	let orgAfter: string | null = null;
	let projectsDone = false;
	let orgsDone = false;
	let projectError: string | null = null;
	try {
		do {
			const page = await graphqlPage(token, fetchImpl, projectsQuery, {
				after,
				orgAfter,
			});
			const viewer = page.data.viewer;
			if (viewer === undefined) {
				throw new Error("GitHub find projects failed");
			}
			if (login === "") {
				login = viewer.login;
			}
			if (!projectsDone) {
				addOpenProjects(viewer.projectsV2.nodes, found, seen);
				projectsDone = !viewer.projectsV2.pageInfo.hasNextPage;
				after = viewer.projectsV2.pageInfo.endCursor;
			}
			if (!orgsDone) {
				for (const org of viewer.organizations.nodes) {
					orgs.push(org.login);
				}
				orgsDone = !viewer.organizations.pageInfo.hasNextPage;
				orgAfter = viewer.organizations.pageInfo.endCursor;
			}
		} while (!projectsDone || !orgsDone);
		for (const org of orgs) {
			await addOrgProjects(token, fetchImpl, org, found, seen);
		}
	} catch (error) {
		projectError = error instanceof Error ? error.message : "poll failed";
		if (login === "") {
			const user = await fetchImpl("https://api.github.com/user", {
				headers: githubHeaders(token),
			});
			if (user.ok) {
				const body = z
					.object({ login: z.string() })
					.safeParse(await user.json());
				if (body.success) {
					login = body.data.login;
				}
			}
		}
	}

	let url: string | null =
		"https://api.github.com/user/repos?affiliation=owner,collaborator&per_page=100&page=1";
	while (url !== null) {
		const response = await fetchImpl(url, { headers: githubHeaders(token) });
		if (!response.ok) {
			throw new Error(`GitHub find repos failed (HTTP ${response.status})`);
		}
		const repos = z.array(githubRepo).parse(await response.json());
		for (const repo of repos) {
			found.push({
				key: repo.full_name,
				tracker: "github",
				updatedAt: repo.pushed_at ?? null,
			});
		}
		url = nextPage(response.headers.get("link"));
	}
	if (projectError !== null && found.length === 0 && login === "") {
		throw new Error(projectError);
	}
	return {
		projects: found,
		viewer: login === "" ? null : { login, orgs },
		...(projectError === null ? {} : { error: projectError }),
	};
}

const projectByNumberQuery = `query ProjectByNumber($owner: String!, $number: Int!) {
	repositoryOwner(login: $owner) {
		projectV2(number: $number) { id number title closed updatedAt }
	}
}`;

const projectByNumber = z.object({
	data: z.object({
		repositoryOwner: z
			.object({
				projectV2: projectNode.nullable(),
			})
			.nullable(),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

export async function githubProjectByNumber(
	token: string,
	fetchImpl: Fetch,
	owner: string,
	number: number,
): Promise<FoundProject | null> {
	const response = await fetchImpl("https://api.github.com/graphql", {
		method: "POST",
		headers: githubHeaders(token),
		body: JSON.stringify({
			query: projectByNumberQuery,
			variables: { owner, number },
		}),
	});
	if (!response.ok) {
		throw new Error(
			`GitHub find project failed (HTTP ${response.status}): ${owner}/${number}`,
		);
	}
	const page = projectByNumber.parse(await response.json());
	const error = page.errors?.[0];
	if (error !== undefined) {
		throw new Error(`GitHub find project failed: ${error.message}`);
	}
	const node = page.data.repositoryOwner?.projectV2;
	if (node === undefined || node === null) {
		return null;
	}
	return {
		key: node.id,
		name: node.title,
		tracker: "github",
		updatedAt: node.updatedAt,
		owner,
		number,
		closed: node.closed,
	};
}

const closingPullNode = z.object({
	number: z.number(),
	repository: z.object({ nameWithOwner: z.string() }).optional(),
});

const closingPullsQuery = `query ClosingPulls($id: ID!, $after: String) {
	node(id: $id) {
		... on Issue {
			closedByPullRequestsReferences(first: 20, after: $after) {
				nodes { number repository { nameWithOwner } }
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const linkedPullsQuery = `query LinkedPulls($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		issue(number: $number) {
			closedByPullRequestsReferences(first: 10) {
				nodes { number repository { nameWithOwner } }
			}
		}
	}
}`;

const linkedPulls = z.object({
	data: z.object({
		repository: z.object({
			issue: z
				.object({
					closedByPullRequestsReferences: z.object({
						nodes: z.array(closingPullNode),
					}),
				})
				.nullable(),
		}),
	}),
});

const closingPulls = z.object({
	data: z.object({
		node: z
			.object({
				closedByPullRequestsReferences: z.object({
					nodes: z.array(closingPullNode),
					pageInfo,
				}),
			})
			.nullable(),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

const projectItemsQuery = `query ProjectItems($id: ID!, $after: String) {
	node(id: $id) {
		... on ProjectV2 {
			items(first: 50, after: $after) {
				nodes {
					fieldValueByName(name: "Status") {
						... on ProjectV2ItemFieldSingleSelectValue {
							name
							optionId
							color
							updatedAt
						}
					}
					content {
						__typename
						... on Issue {
							id number title body state stateReason updatedAt comments { totalCount }
							repository { nameWithOwner }
							milestone { title }
							labels(first: 20) { nodes { name } }
							parent { number repository { nameWithOwner } }
							closedByPullRequestsReferences(first: 20) {
								nodes { number repository { nameWithOwner } }
								pageInfo { hasNextPage endCursor }
							}
							blockedBy(first: 20) {
								nodes { number title state repository { nameWithOwner } }
								pageInfo { hasNextPage endCursor }
							}
						}
					}
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const blockedByQuery = `query BlockedBy($id: ID!, $after: String) {
	node(id: $id) {
		... on Issue {
			blockedBy(first: 20, after: $after) {
				nodes { number title state repository { nameWithOwner } }
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const projectBlockedByNode = z.object({
	number: z.number(),
	title: z.string().nullable().optional(),
	state: z.string(),
	repository: z.object({ nameWithOwner: z.string() }).nullable().optional(),
});

const blockedByPage = z.object({
	data: z.object({
		node: z
			.object({
				blockedBy: z.object({
					nodes: z.array(projectBlockedByNode),
					pageInfo,
				}),
			})
			.nullable(),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

const projectItem = z.object({
	fieldValueByName: z
		.object({
			name: z.string().nullable().optional(),
			optionId: z.string().nullable().optional(),
			color: z.string().nullable().optional(),
			updatedAt: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
	content: z
		.object({
			__typename: z.string(),
			id: z.string().optional(),
			number: z.number().optional(),
			title: z.string().optional(),
			state: z.string().optional(),
			stateReason: z.string().nullable().optional(),
			updatedAt: z.string().optional(),
			comments: z.object({ totalCount: z.number() }).optional(),
			repository: z.object({ nameWithOwner: z.string() }).optional(),
			milestone: z.object({ title: z.string() }).nullable().optional(),
			labels: z
				.object({
					nodes: z.array(z.object({ name: z.string() })),
				})
				.nullable()
				.optional(),
			parent: z
				.object({
					number: z.number(),
					repository: z.object({ nameWithOwner: z.string() }),
				})
				.nullable()
				.optional(),
			body: z.string().nullable().optional(),
			blockedBy: z
				.object({
					nodes: z.array(projectBlockedByNode),
					pageInfo: pageInfo.optional(),
				})
				.optional(),
			closedByPullRequestsReferences: z
				.object({
					nodes: z.array(closingPullNode),
					pageInfo,
				})
				.optional(),
		})
		.nullable(),
});

const projectItems = z.object({
	data: z.object({
		node: z
			.object({
				items: z.object({
					nodes: z.array(projectItem),
					pageInfo,
				}),
			})
			.nullable(),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

function repoFromUrl(url: string | undefined, fallback: string): string {
	if (url === undefined) {
		return fallback;
	}
	const match = url.match(/\/repos\/([^/]+\/[^/]+)/);
	return match?.[1] ?? fallback;
}

function nativeState(state: string): TicketRef["state"] | null {
	if (state === "open" || state === "closed") {
		return state;
	}
	return null;
}

function githubState(state: string): "open" | "closed" | null {
	if (state === "OPEN" || state === "open") {
		return "open";
	}
	if (state === "CLOSED" || state === "closed") {
		return "closed";
	}
	return null;
}

function parentKey(url: string | null | undefined): string | null {
	if (url === null || url === undefined) {
		return null;
	}
	const match = url.match(/\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)/);
	const repo = match?.[1];
	const number = match?.[2];
	if (repo === undefined || number === undefined) {
		return null;
	}
	return `${repo}#${number}`;
}

function githubReason(reason: string | null): string | null {
	if (reason === null) {
		return null;
	}
	const lowered = reason.toLowerCase();
	if (lowered === "completed") {
		return null;
	}
	if (lowered === "not_planned" || lowered === "duplicate") {
		return lowered;
	}
	return reason;
}

type ProjectItem = z.infer<typeof projectItem>;

const githubOptionColours: Record<string, string> = {
	GRAY: "#BEC2C8",
	PURPLE: "#5E6AD2",
	YELLOW: "#F2C94C",
	BLUE: "#4C9AFF",
	GREEN: "#4CB782",
	RED: "#EB5757",
	ORANGE: "#F2994A",
	PINK: "#F7C8C8",
};

function githubOptionColour(color: string): string {
	return githubOptionColours[color] ?? backlogColour;
}

function labelColour(color: string): string {
	const hex = color.replace(/^#/, "");
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
		return backlogColour;
	}
	return `#${hex.toUpperCase()}`;
}

function openLinkedKeys(items: ProjectItem[]): Set<string> {
	const keys = new Set<string>();
	for (const item of items) {
		const content = item.content;
		if (
			content === null ||
			content.__typename !== "Issue" ||
			content.number === undefined ||
			content.repository === undefined ||
			githubState(content.state ?? "") !== "open"
		) {
			continue;
		}
		if ((content.closedByPullRequestsReferences?.nodes.length ?? 0) > 0) {
			keys.add(`${content.repository.nameWithOwner}#${content.number}`);
		}
	}
	return keys;
}

async function listProjectItems(
	token: string,
	fetchImpl: Fetch,
	projectId: string,
): Promise<ProjectItem[]> {
	const items: ProjectItem[] = [];
	let after: string | null = null;
	do {
		const response = await fetchImpl("https://api.github.com/graphql", {
			method: "POST",
			headers: githubHeaders(token),
			body: JSON.stringify({
				query: projectItemsQuery,
				variables: { id: projectId, after },
			}),
		});
		if (!response.ok) {
			throw new Error(
				`GitHub list project tickets failed (HTTP ${response.status}): ${projectId}`,
			);
		}
		const page = projectItems.parse(await response.json());
		const error = page.errors?.[0];
		if (error !== undefined) {
			throw new Error(`GitHub list project tickets failed: ${error.message}`);
		}
		if (page.data.node === null) {
			throw new Error(`GitHub list project tickets failed: ${projectId}`);
		}
		for (const item of page.data.node.items.nodes) {
			items.push(item);
		}
		after = page.data.node.items.pageInfo.hasNextPage
			? page.data.node.items.pageInfo.endCursor
			: null;
	} while (after !== null);
	return items;
}

function githubItemStatus(
	value: z.infer<typeof projectItem>["fieldValueByName"],
) {
	const name = value?.name?.trim() ?? "";
	const optionId = value?.optionId ?? "";
	if (name === "" || optionId === "") {
		return { emptyStatus: true };
	}
	const statusType = statusTypeOfName(name);
	const at = value?.updatedAt?.trim() ?? "";
	return {
		status: {
			id: optionId,
			name,
			statusType,
			colour: githubOptionColour(value?.color ?? ""),
		},
		...(at === "" ? {} : { history: [{ statusId: optionId, at, statusType }] }),
	};
}

const projectFieldsQuery = `query ProjectFields($id: ID!) {
	node(id: $id) {
		... on ProjectV2 {
			fields(first: 20) {
				nodes {
					... on ProjectV2SingleSelectField {
						id
						name
						options { id name color }
					}
				}
			}
		}
	}
}`;

const projectFields = z.object({
	data: z.object({
		node: z
			.object({
				fields: z.object({
					nodes: z.array(
						z.union([
							z.object({
								id: z.string(),
								name: z.string(),
								options: z.array(
									z.object({
										id: z.string(),
										name: z.string(),
										color: z.string(),
									}),
								),
							}),
							z.object({}).strict(),
						]),
					),
				}),
			})
			.nullable(),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

async function listProjectStatuses(
	token: string,
	fetchImpl: Fetch,
	projectId: string,
): Promise<TicketStatus[]> {
	const response = await fetchImpl("https://api.github.com/graphql", {
		method: "POST",
		headers: githubHeaders(token),
		body: JSON.stringify({
			query: projectFieldsQuery,
			variables: { id: projectId },
		}),
	});
	if (!response.ok) {
		throw new Error(
			`GitHub list project statuses failed (HTTP ${response.status}): ${projectId}`,
		);
	}
	const body = await response.json();
	const recorded = projectFields.safeParse(body);
	if (!recorded.success) {
		throw new Error(`GitHub list project statuses failed: ${projectId}`);
	}
	const page = recorded.data;
	const error = page.errors?.[0];
	if (error !== undefined) {
		throw new Error(`GitHub list project statuses failed: ${error.message}`);
	}
	const field = page.data.node?.fields.nodes.find(
		(node) => "name" in node && node.name === "Status",
	);
	if (field === undefined) {
		return [];
	}
	return field.options.map((option) => ({
		id: option.id,
		name: option.name,
		statusType: statusTypeOfName(option.name),
		colour: githubOptionColour(option.color),
	}));
}

const githubLabel = z.object({
	name: z.string(),
	color: z.string(),
});

async function labelPage(
	response: Response,
	repo: string,
): Promise<z.infer<typeof githubLabel>[]> {
	if (!response.ok) {
		throw new Error(
			`GitHub list labels failed (HTTP ${response.status}): ${repo}`,
		);
	}
	const page = z.array(githubLabel).safeParse(await response.json());
	if (!page.success) {
		throw new Error(`GitHub list labels failed: ${repo}`);
	}
	return page.data;
}

const issueEvent = z
	.object({
		event: z.string(),
		created_at: z.string(),
		issue: z.object({ number: z.number() }),
		label: z.object({ name: z.string() }).nullish(),
	})
	.passthrough();

// One page is 100 events. Ten pages covers a busy repo without walking its history.
const issueEventPageBound = 10;

function oldestUpdate(tickets: Ticket[]): string | null {
	let oldest: string | null = null;
	for (const ticket of tickets) {
		if (oldest === null || ticket.updatedAt < oldest) {
			oldest = ticket.updatedAt;
		}
	}
	return oldest;
}

function parseIssueEvents(
	item: unknown,
	repo: string,
): z.infer<typeof issueEvent>[] {
	const page = z.array(issueEvent).safeParse(item);
	if (!page.success) {
		throw new Error(`GitHub list issue events failed: ${repo}`);
	}
	return page.data;
}

// The feed is newest first. A page older than every listed ticket cannot name a later state entry.
function reachedOldestUpdate(
	events: z.infer<typeof issueEvent>[],
	oldest: string | null,
): boolean {
	if (oldest === null || events.length === 0) {
		return false;
	}
	const last = events.at(-1);
	return last !== undefined && last.created_at < oldest;
}

async function listIssueEvents(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	oldest: string | null,
): Promise<z.infer<typeof issueEvent>[]> {
	const start = `https://api.github.com/repos/${repo}/issues/events?per_page=100&page=1`;
	const first = await fetchImpl(start, { headers: githubHeaders(token) });
	if (first.status === 404 || first.status === 410) {
		return [];
	}
	if (!first.ok) {
		throw new Error(
			`GitHub list issue events failed (HTTP ${first.status}): ${repo}`,
		);
	}
	const events = parseIssueEvents(await first.json(), repo);
	if (reachedOldestUpdate(events, oldest)) {
		return events;
	}
	let url = nextPage(first.headers.get("link"));
	for (let page = 2; page <= issueEventPageBound && url !== null; page += 1) {
		const response = await fetchImpl(url, { headers: githubHeaders(token) });
		if (!response.ok) {
			throw new Error(
				`GitHub list issue events failed (HTTP ${response.status}): ${repo}`,
			);
		}
		const next = parseIssueEvents(await response.json(), repo);
		events.push(...next);
		if (reachedOldestUpdate(next, oldest)) {
			return events;
		}
		url = nextPage(response.headers.get("link"));
	}
	return events;
}

function labelHistory(
	events: z.infer<typeof issueEvent>[],
	number: number,
	status: TicketStatus,
) {
	const history: NonNullable<Ticket["history"]> = [];
	for (const event of events) {
		if (event.issue.number !== number) {
			continue;
		}
		const labelName = event.label?.name;
		const named = event.event === "labeled" && labelName === status.name;
		const reopened = event.event === "reopened";
		if (!named && !reopened) {
			continue;
		}
		history.push({
			statusId: status.id,
			at: event.created_at,
			statusType: status.statusType,
		});
	}
	return history;
}

async function listRepoLabels(
	token: string,
	fetchImpl: Fetch,
	repo: string,
): Promise<{ name: string; colour: string }[]> {
	const start = `https://api.github.com/repos/${repo}/labels?per_page=100&page=1`;
	const first = await fetchImpl(start, { headers: githubHeaders(token) });
	const listed = [await labelPage(first, repo)];
	let url = nextPage(first.headers.get("link"));
	while (url !== null) {
		const response = await fetchImpl(url, { headers: githubHeaders(token) });
		listed.push(await labelPage(response, repo));
		url = nextPage(response.headers.get("link"));
	}
	return listed.flatMap((page) =>
		page.map((label) => ({
			name: label.name,
			colour: labelColour(label.color),
		})),
	);
}

function projectBlockedByRefs(
	nodes: z.infer<typeof projectBlockedByNode>[],
	fallback: string,
): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const node of nodes) {
		const state = githubState(node.state);
		if (state === null) {
			continue;
		}
		const project = node.repository?.nameWithOwner ?? fallback;
		const title = node.title?.trim() ?? "";
		const ref: TicketRef = {
			tracker: "github",
			project,
			key: `${project}#${node.number}`,
			state,
			...(title === "" ? {} : { title }),
		};
		if (!refs.some((item) => item.key === ref.key)) {
			refs.push(ref);
		}
	}
	return refs;
}

async function connectionPages<Node>(
	token: string,
	fetchImpl: Fetch,
	issueId: string,
	start: string,
	query: string,
	label: string,
	read: (body: unknown) => {
		nodes: Node[];
		pageInfo: z.infer<typeof pageInfo>;
	},
): Promise<Node[]> {
	const nodes: Node[] = [];
	let after: string | null = start;
	do {
		const response = await fetchImpl("https://api.github.com/graphql", {
			method: "POST",
			headers: githubHeaders(token),
			body: JSON.stringify({
				query,
				variables: { id: issueId, after },
			}),
		});
		if (!response.ok) {
			throw new Error(
				`GitHub ${label} failed (HTTP ${response.status}): ${issueId}`,
			);
		}
		const body: unknown = await response.json();
		const errors = z
			.object({ errors: z.array(z.object({ message: z.string() })).optional() })
			.parse(body).errors;
		const error = errors?.[0];
		if (error !== undefined) {
			throw new Error(`GitHub ${label} failed: ${error.message}`);
		}
		const connection = read(body);
		nodes.push(...connection.nodes);
		after = connection.pageInfo.hasNextPage
			? connection.pageInfo.endCursor
			: null;
	} while (after !== null);
	return nodes;
}

function blockedByPages(
	token: string,
	fetchImpl: Fetch,
	issueId: string,
	start: string,
): Promise<z.infer<typeof projectBlockedByNode>[]> {
	return connectionPages(
		token,
		fetchImpl,
		issueId,
		start,
		blockedByQuery,
		"list blockers",
		(body) => {
			const connection = blockedByPage.parse(body).data.node?.blockedBy;
			if (connection === undefined) {
				throw new Error(`GitHub list blockers failed: ${issueId}`);
			}
			return connection;
		},
	);
}

async function listProjectTickets(
	token: string,
	fetchImpl: Fetch,
	items: ProjectItem[],
	openKeys: Set<string>,
): Promise<Ticket[]> {
	const tickets: Ticket[] = [];
	for (const item of items) {
		const content = item.content;
		if (
			content === null ||
			content.__typename !== "Issue" ||
			content.number === undefined ||
			content.state === undefined ||
			content.repository === undefined
		) {
			continue;
		}
		const state = githubState(content.state);
		if (state === null) {
			continue;
		}
		const repoName = content.repository.nameWithOwner;
		const parent =
			content.parent === null || content.parent === undefined
				? null
				: `${content.parent.repository.nameWithOwner}#${content.parent.number}`;
		const ticketKey = `${repoName}#${content.number}`;
		const comments =
			state === "open" &&
			openKeys.has(ticketKey) &&
			(content.comments?.totalCount ?? 0) > 0
				? await listCommentBodies(token, fetchImpl, repoName, content.number)
				: [];
		const blockedByNodes = [...(content.blockedBy?.nodes ?? [])];
		const blockedByAfter = content.blockedBy?.pageInfo?.hasNextPage
			? content.blockedBy.pageInfo.endCursor
			: null;
		if (blockedByAfter !== null && content.id !== undefined) {
			blockedByNodes.push(
				...(await blockedByPages(token, fetchImpl, content.id, blockedByAfter)),
			);
		}
		tickets.push({
			id: String(content.number),
			tracker: "github",
			key: `${repoName}#${content.number}`,
			title: content.title ?? "",
			state,
			stateReason: githubReason(content.stateReason ?? null),
			updatedAt: content.updatedAt ?? "",
			ref: `${repoName}#${content.number}`,
			body: content.body ?? "",
			blockedBy: projectBlockedByRefs(blockedByNodes, repoName),
			...(comments.length === 0 ? {} : { comments }),
			milestone: content.milestone?.title ?? null,
			parent,
			labels: content.labels?.nodes.map((label) => label.name) ?? [],
			...githubItemStatus(item.fieldValueByName),
		});
	}
	return tickets;
}

function closingPullPages(
	token: string,
	fetchImpl: Fetch,
	issueId: string,
	start: string,
): Promise<z.infer<typeof closingPullNode>[]> {
	return connectionPages(
		token,
		fetchImpl,
		issueId,
		start,
		closingPullsQuery,
		"list closing pulls",
		(body) => {
			const connection =
				closingPulls.parse(body).data.node?.closedByPullRequestsReferences;
			if (connection === undefined) {
				throw new Error(`GitHub list closing pulls failed: ${issueId}`);
			}
			return connection;
		},
	);
}

async function listProjectPulls(
	token: string,
	fetchImpl: Fetch,
	items: ProjectItem[],
	seen: Map<string, ReviewEvidence>,
): Promise<PullRequest[]> {
	const pulls: PullRequest[] = [];
	const seenPulls = new Set<string>();
	for (const item of items) {
		const content = item.content;
		if (
			content === null ||
			content.__typename !== "Issue" ||
			content.number === undefined ||
			content.repository === undefined ||
			githubState(content.state ?? "") !== "open"
		) {
			continue;
		}
		const ticketKey = `${content.repository.nameWithOwner}#${content.number}`;
		const linkedPulls = [
			...(content.closedByPullRequestsReferences?.nodes ?? []),
		];
		const closingAfter = content.closedByPullRequestsReferences?.pageInfo
			.hasNextPage
			? content.closedByPullRequestsReferences.pageInfo.endCursor
			: null;
		if (closingAfter !== null && content.id !== undefined) {
			linkedPulls.push(
				...(await closingPullPages(token, fetchImpl, content.id, closingAfter)),
			);
		}
		for (const linked of linkedPulls) {
			const pullRepo =
				linked.repository?.nameWithOwner ?? content.repository.nameWithOwner;
			const key = `${pullRepo}#${linked.number}`;
			const loaded = pulls.find(
				(pull) => pull.repo === pullRepo && pull.number === linked.number,
			);
			if (loaded !== undefined) {
				if (!loaded.closingKeys.includes(ticketKey)) {
					loaded.closingKeys.push(ticketKey);
				}
				continue;
			}
			if (seenPulls.has(key)) {
				continue;
			}
			seenPulls.add(key);
			const opened = await loadOpenPull(
				token,
				fetchImpl,
				pullRepo,
				linked.number,
				[ticketKey],
			);
			if (opened !== null) {
				pulls.push(opened);
			}
		}
	}
	const repos = new Set(pulls.map((pull) => pull.repo));
	for (const item of items) {
		const content = item.content;
		if (content !== null && content.repository !== undefined) {
			repos.add(content.repository.nameWithOwner);
		}
	}
	for (const repo of repos) {
		pulls.push(...(await mergedPullHistory(repo, token, fetchImpl, seen)));
	}
	return pulls;
}

export async function loadOpenPull(
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
		throw new Error(
			`GitHub list pulls failed (HTTP ${response.status}): ${repo}`,
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
		throw new Error(`GitHub ${label} failed (HTTP ${response.status}): ${url}`);
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

function mergedReviewKey(repo: string, number: number): string {
	return `${repo}#${number}`;
}

export async function mergedPullHistory(
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
	const pulls: PullRequest[] = [];
	for (const pull of page) {
		if ((pull.merged_at ?? null) === null) {
			continue;
		}
		const head = pull.head.sha ?? "";
		const key = mergedReviewKey(repo, pull.number);
		const cached = seen.get(key);
		const review =
			cached ??
			(await pullReview(repo, pull.number, head, false, token, fetchImpl));
		seen.set(key, review);
		pulls.push({
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
		});
	}
	return pulls;
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

export function githubTracker(token: string, fetchImpl: Fetch): Tracker {
	const seenReviews = new Map<string, ReviewEvidence>();
	const projectItemsById = new Map<string, Promise<ProjectItem[]>>();
	const projectItems = (projectId: string) => {
		const cached = projectItemsById.get(projectId);
		if (cached !== undefined) {
			return cached;
		}
		const listed = listProjectItems(token, fetchImpl, projectId).catch(
			(error: unknown) => {
				if (projectItemsById.get(projectId) === listed) {
					projectItemsById.delete(projectId);
				}
				throw error;
			},
		);
		projectItemsById.set(projectId, listed);
		return listed;
	};
	return {
		findProjects() {
			return findGithubProjects(token, fetchImpl);
		},
		async listTickets(repo, since) {
			if (!repo.includes("/")) {
				projectItemsById.clear();
				const items = await projectItems(repo);
				const openKeys = openLinkedKeys(items);
				const tickets = await listProjectTickets(
					token,
					fetchImpl,
					items,
					openKeys,
				);
				const statuses = await listProjectStatuses(token, fetchImpl, repo);
				const board: Board = {
					kind: "github-project",
					statuses,
					factoryLabels: false,
				};
				return { name: repo, tickets, board };
			}
			const tickets: Ticket[] = [];
			const sinceQuery =
				since === null
					? ""
					: `&since=${encodeURIComponent(since.toISOString())}`;
			const listed = await pages(
				`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1${sinceQuery}`,
				token,
				fetchImpl,
				repo,
				"list tickets",
			);
			const issues = listed.flatMap((item) => githubIssuePage.parse(item));
			const seen = new Set(issues.map((issue) => issue.number));
			if (since !== null) {
				issues.push(
					...(await issuesWithEditedComments(
						token,
						fetchImpl,
						repo,
						since,
						seen,
					)),
				);
			}
			for (const issue of issues) {
				if (issue.pull_request !== undefined) {
					continue;
				}
				if (issue.state !== "open" && issue.state !== "closed") {
					continue;
				}
				const closedAt = issue.closed_at?.trim() ?? "";
				const createdAt = issue.created_at?.trim() ?? "";
				const summary = issue.issue_dependencies_summary;
				const blockedBy =
					summary !== undefined && summary.total_blocked_by > 0
						? await listDependencies(
								token,
								fetchImpl,
								repo,
								issue.number,
								"blocked_by",
							)
						: [];
				const blocking =
					summary !== undefined && (summary.total_blocking ?? 0) > 0
						? await listDependencies(
								token,
								fetchImpl,
								repo,
								issue.number,
								"blocking",
							)
						: [];
				const comments =
					issue.state !== "open" ||
					issue.comments === undefined ||
					issue.comments === 0
						? []
						: await listCommentBodies(token, fetchImpl, repo, issue.number);
				tickets.push({
					id: String(issue.number),
					tracker: "github",
					key: `${repo}#${issue.number}`,
					title: issue.title,
					state: issue.state,
					stateReason: issue.state_reason,
					updatedAt: issue.updated_at,
					ref: `${repo}#${issue.number}`,
					body: issue.body ?? "",
					blockedBy,
					...(blocking.length === 0 ? {} : { blocks: blocking }),
					...(comments.length === 0 ? {} : { comments }),
					milestone: issue.milestone?.title ?? null,
					parent: parentKey(issue.parent_issue_url),
					labels: issue.labels?.map((label) => label.name) ?? [],
					...(closedAt === "" ? {} : { closedAt }),
					...(createdAt === "" ? {} : { createdAt }),
					...(issue.assignee === undefined && issue.assignees === undefined
						? {}
						: {
								assignee: issue.assignee?.login ?? null,
								assignees: (issue.assignees ?? []).map(
									(person) => person.login,
								),
							}),
				});
			}
			const labels = await listRepoLabels(token, fetchImpl, repo);
			const board = factoryBoard(labels);
			const events =
				board.factoryLabels && tickets.length > 0
					? await listIssueEvents(token, fetchImpl, repo, oldestUpdate(tickets))
					: [];
			if (board.factoryLabels) {
				for (const ticket of tickets) {
					const status = board.statuses.find((item) =>
						ticket.labels.includes(item.name),
					);
					if (status !== undefined) {
						ticket.status = status;
						const history = labelHistory(events, Number(ticket.id), status);
						if (history.length > 0) {
							ticket.history = history;
						}
					}
				}
			}
			return { name: repo, tickets, board };
		},
		async listPulls(repo) {
			if (!repo.includes("/")) {
				return listProjectPulls(
					token,
					fetchImpl,
					await projectItems(repo),
					seenReviews,
				);
			}
			const pulls: PullRequest[] = [];
			const listed = await pages(
				`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`,
				token,
				fetchImpl,
				repo,
				"list pulls",
			);
			for (const item of listed) {
				const page = z.array(githubPull).parse(item);
				for (const pull of page) {
					if (pull.state !== "open") {
						continue;
					}
					const body = pull.body ?? "";
					const [owner, name] = repo.split("/");
					const keys: string[] = [];
					if (owner !== undefined && name !== undefined) {
						const response = await fetchImpl("https://api.github.com/graphql", {
							method: "POST",
							headers: githubHeaders(token),
							body: JSON.stringify({
								query: developmentQuery,
								variables: { owner, name, number: pull.number },
							}),
						});
						if (response.ok) {
							const linked = linkedDevelopment.parse(await response.json());
							for (const node of linked.data.repository.pullRequest
								?.closingIssuesReferences.nodes ?? []) {
								const key = `${repo}#${node.number}`;
								if (!keys.includes(key)) {
									keys.push(key);
								}
							}
						}
					}
					const head = pull.head.sha ?? "";
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
						pull.draft === true || head === ""
							? null
							: await fetchHeadCommittedAt(repo, head, token, fetchImpl);
					pulls.push({
						repo,
						number: pull.number,
						url: pull.html_url,
						title: pull.title,
						draft: pull.draft === true,
						branch: pull.head.ref,
						body,
						closingKeys: keys,
						headSha: head,
						headCommittedAt,
						merged: false,
						autoMerge: pull.auto_merge != null,
						...review,
					});
				}
			}
			pulls.push(
				...(await mergedPullHistory(repo, token, fetchImpl, seenReviews)),
			);
			return pulls;
		},
		async repoAutoMerge(repo) {
			if (!repo.includes("/")) {
				return false;
			}
			const response = await fetchImpl(`https://api.github.com/repos/${repo}`, {
				headers: githubHeaders(token),
			});
			if (!response.ok) {
				return false;
			}
			const body = z
				.object({ allow_auto_merge: z.boolean().optional() })
				.parse(await response.json());
			return body.allow_auto_merge === true;
		},
		async listBranches(repo) {
			if (!repo.includes("/")) {
				return [];
			}
			const names: string[] = [];
			const listed = await pages(
				`https://api.github.com/repos/${repo}/branches?per_page=100&page=1`,
				token,
				fetchImpl,
				repo,
				"list branches",
			);
			const branch = z.object({ name: z.string() });
			for (const item of listed) {
				for (const row of z.array(branch).parse(item)) {
					names.push(row.name);
				}
			}
			return names;
		},
		fetchThread(project, key) {
			return fetchGithubThread(token, fetchImpl, project, key);
		},
		postReply(reply) {
			return postGithubReply(token, fetchImpl, reply);
		},
	};
}

const githubComment = z.object({
	id: z.number().optional(),
	body: z.string().nullable().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	user: z.object({ login: z.string() }).nullable().optional(),
	reactions: z.object({ total_count: z.number().optional() }).optional(),
});

function commentFromGithub(
	comment: z.infer<typeof githubComment>,
): Comment | null {
	const body = comment.body ?? "";
	if (body === "") {
		return null;
	}
	return {
		body,
		...(comment.id === undefined ? {} : { id: String(comment.id) }),
		...(comment.created_at === undefined
			? {}
			: { createdAt: comment.created_at }),
		...(comment.updated_at === undefined
			? {}
			: { updatedAt: comment.updated_at }),
		...(comment.user?.login === undefined
			? {}
			: { author: comment.user.login }),
		...(comment.reactions?.total_count === undefined
			? {}
			: { reactions: comment.reactions.total_count }),
	};
}

const editedIssueComment = z.object({
	issue_url: z.string().optional(),
});

function issueNumberFromCommentUrl(
	issueUrl: string,
	repo: string,
): number | null {
	const match = issueUrl.match(
		/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/,
	);
	const commentRepo = match?.[1];
	const raw = match?.[2];
	if (commentRepo !== repo || raw === undefined) {
		return null;
	}
	return Number(raw);
}

// A comment edit leaves the issue updated_at unchanged, so the issue list's
// since window misses it. The repository comment list's since uses the comment time.
async function issuesWithEditedComments(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	since: Date,
	seen: Set<number>,
): Promise<z.infer<typeof githubIssue>[]> {
	const listed = await pages(
		`https://api.github.com/repos/${repo}/issues/comments?since=${encodeURIComponent(since.toISOString())}&sort=updated&per_page=100&page=1`,
		token,
		fetchImpl,
		repo,
		"list edited comments",
	);
	const numbers: number[] = [];
	for (const item of listed) {
		for (const comment of z.array(editedIssueComment).parse(item)) {
			if (comment.issue_url === undefined) {
				continue;
			}
			const number = issueNumberFromCommentUrl(comment.issue_url, repo);
			if (number === null || seen.has(number) || numbers.includes(number)) {
				continue;
			}
			numbers.push(number);
		}
	}
	const issues: z.infer<typeof githubIssue>[] = [];
	for (const number of numbers) {
		const response = await fetchImpl(
			`https://api.github.com/repos/${repo}/issues/${number}`,
			{ headers: githubHeaders(token) },
		);
		if (response.status === 404) {
			continue;
		}
		if (!response.ok) {
			throw new Error(
				`GitHub list edited comments failed (HTTP ${response.status}): ${repo}`,
			);
		}
		const issue = githubIssue.parse(await response.json());
		if (issue.pull_request !== undefined || issue.number !== number) {
			continue;
		}
		issues.push(issue);
	}
	return issues;
}

async function listCommentBodies(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	number: number,
): Promise<Comment[]> {
	const listed = await pages(
		`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100&page=1`,
		token,
		fetchImpl,
		repo,
		"list comments",
	);
	const bodies: Comment[] = [];
	for (const item of listed) {
		for (const comment of z.array(githubComment).parse(item)) {
			const mapped = commentFromGithub(comment);
			if (mapped !== null) {
				bodies.push(mapped);
			}
		}
	}
	return bodies;
}

export function githubTicketKey(
	key: string,
): { repo: string; number: number } | null {
	const match = key.match(/^([^/\s]+\/[^/\s]+)#(\d+)$/);
	const repo = match?.[1];
	const raw = match?.[2];
	if (repo === undefined || raw === undefined) {
		return null;
	}
	return { repo, number: Number(raw) };
}

const githubThreadComment = z.object({
	id: z.number(),
	body: z.string().nullable().optional(),
	html_url: z.string().optional(),
	created_at: z.string().optional(),
	user: z.object({ login: z.string() }).nullable().optional(),
	in_reply_to_id: z.number().nullable().optional(),
});

const postedComment = z.object({
	id: z.number(),
	body: z.string().nullable().optional(),
	html_url: z.string(),
	created_at: z.string(),
});

function toThreadComment(
	comment: z.infer<typeof githubThreadComment>,
	kind: ThreadComment["kind"],
): ThreadComment {
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

export async function fetchGithubThread(
	token: string,
	fetchImpl: Fetch,
	project: string,
	key: string,
): Promise<Thread | null> {
	const parsed = githubTicketKey(key);
	if (parsed === null) {
		return null;
	}
	const { repo, number } = parsed;
	const issueUrl = `https://api.github.com/repos/${repo}/issues/${number}`;
	const issueResponse = await fetchImpl(issueUrl, {
		headers: githubHeaders(token),
	});
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
	const comments = (
		await pages(
			`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100&page=1`,
			token,
			fetchImpl,
			repo,
			"fetch thread",
		)
	).flatMap((item) =>
		z
			.array(githubThreadComment)
			.parse(item)
			.map((comment) => toThreadComment(comment, "comment")),
	);
	const reviewTargets =
		issue.pull_request === undefined
			? await linkedReviewTargets(token, fetchImpl, repo, number)
			: [{ repo, number }];
	const review = (
		await Promise.all(
			reviewTargets.map((target) =>
				pages(
					`https://api.github.com/repos/${target.repo}/pulls/${target.number}/comments?per_page=100&page=1`,
					token,
					fetchImpl,
					target.repo,
					"fetch review thread",
				),
			),
		)
	).flatMap((listed) =>
		listed.flatMap((item) =>
			z
				.array(githubThreadComment)
				.parse(item)
				.map((comment) => toThreadComment(comment, "review")),
		),
	);
	return {
		tracker: "github",
		project,
		key,
		title: issue.title,
		url: issue.html_url,
		comments: [...comments, ...review],
	};
}

export async function linkedReviewTargets(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	number: number,
): Promise<{ repo: string; number: number }[]> {
	const [owner, name] = repo.split("/");
	if (owner === undefined || name === undefined) {
		return [];
	}
	const response = await fetchImpl("https://api.github.com/graphql", {
		method: "POST",
		headers: githubHeaders(token),
		body: JSON.stringify({
			query: linkedPullsQuery,
			variables: { owner, name, number },
		}),
	});
	if (!response.ok) {
		return [];
	}
	const linked = linkedPulls.parse(await response.json());
	const targets: { repo: string; number: number }[] = [];
	for (const node of linked.data.repository.issue
		?.closedByPullRequestsReferences.nodes ?? []) {
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

async function postGithubReply(
	token: string,
	fetchImpl: Fetch,
	reply: ReplyRequest,
): Promise<PostedReply> {
	const parsed = githubTicketKey(reply.key);
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

async function listDependencies(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	number: number,
	kind: "blocked_by" | "blocking",
): Promise<TicketRef[]> {
	const refs: TicketRef[] = [];
	let url: string | null =
		`https://api.github.com/repos/${repo}/issues/${number}/dependencies/${kind}?per_page=100&page=1`;
	let first = true;
	while (url !== null) {
		const response = await fetchImpl(url, { headers: githubHeaders(token) });
		if (first && response.status === 404) {
			return [];
		}
		first = false;
		if (!response.ok) {
			throw new Error(
				`GitHub list blockers failed (HTTP ${response.status}): ${repo}#${number}`,
			);
		}
		const page = z.array(dependency).parse(await response.json());
		for (const item of page) {
			const state = nativeState(item.state);
			if (state === null) {
				continue;
			}
			const project = repoFromUrl(item.repository_url, repo);
			const title = item.title?.trim() ?? "";
			const ref: TicketRef = {
				tracker: "github",
				project,
				key: `${project}#${item.number}`,
				...(title === "" ? {} : { title }),
			};
			if (state !== undefined) {
				ref.state = state;
			}
			refs.push(ref);
		}
		url = nextPage(response.headers.get("link"));
	}
	return refs;
}
