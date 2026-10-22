import { z } from "zod";
import { currentBlockers } from "./blocker-refresh.ts";
import type {
	Board,
	BotCheck,
	BotComment,
	BotReaction,
	BotReview,
	Comment,
	PullRequest,
	Ticket,
	TicketRef,
	TicketStatus,
} from "./domain.ts";
import { factoryBoard, reviewStateValue, statusTypeOfName } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	commentFromGithub,
	githubComment,
	graphqlActor,
	graphqlComment,
	projectComments,
	projectItemComments,
} from "./github-comment.ts";
import { githubHeaders, nextPage, pages } from "./github-pages.ts";
import { fetchGithubThread, postGithubReply } from "./github-thread.ts";
import type { FoundProject, Tracker, Viewer } from "./ports.ts";
import { statusColours } from "./token-palette.ts";

export { githubHeaders } from "./github-pages.ts";

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

type RestEntry = {
	etag: string;
	body: unknown;
	headers: [string, string][];
};

export type RestCache = Map<string, RestEntry>;

const issueList =
	/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?(.*)$/;
const issueCommentList =
	/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/comments\?(.*)$/;

function listWindow(
	url: string,
	pattern: RegExp,
): { repo: string; since: string } | null {
	const match = pattern.exec(url);
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
	forget?: (url: string) => void,
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
			forget?.(key);
		}
	}
}

export function retainListWindows(
	cache: RestCache,
	repo: string,
	forget?: (url: string) => void,
): void {
	retainWindow(cache, repo, (url) => listWindow(url, issueList), forget);
	retainWindow(cache, repo, (url) => listWindow(url, issueCommentList), forget);
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

function parseStoredHeaders(headers: string): [string, string][] {
	const parsed: unknown = JSON.parse(headers);
	if (!Array.isArray(parsed)) {
		return [];
	}
	const entries: [string, string][] = [];
	for (const item of parsed) {
		if (!Array.isArray(item) || item.length < 2) {
			continue;
		}
		const name = item[0];
		const value = item[1];
		if (typeof name === "string" && typeof value === "string") {
			entries.push([name, value]);
		}
	}
	return entries;
}

export function rememberValidator(
	cache: RestCache,
	url: string,
	etag: string,
	body: unknown,
	headers: string,
): void {
	const key = restKey(url);
	const stored = parseStoredHeaders(headers);
	const restored =
		stored.length > 0
			? stored
			: ([["etag", etag]] satisfies [string, string][]);
	cache.set(key, {
		etag,
		body,
		headers: restored,
	});
}

function sameHeaders(
	left: [string, string][],
	right: [string, string][],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every(
		([name, value], index) =>
			name === right[index]?.[0] && value === right[index]?.[1],
	);
}

export function conditionalFetch(
	fetchImpl: Fetch,
	cache: RestCache,
	remember?: (url: string, etag: string, body: string, headers: string) => void,
): Fetch {
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
			const kept = [...replayed.entries()];
			if (etag !== stored.etag || !sameHeaders(stored.headers, kept)) {
				cache.set(key, {
					etag,
					body: stored.body,
					headers: kept,
				});
				remember?.(
					key,
					etag,
					JSON.stringify(stored.body),
					JSON.stringify(kept),
				);
			}
			return new Response(JSON.stringify(stored.body), {
				status: 200,
				headers: replayed,
			});
		}
		const next = response.headers.get("etag");
		if (response.ok && next !== null && next !== "") {
			const body: unknown = await response.clone().json();
			const kept = storedHeaders(response);
			cache.set(key, {
				etag: next,
				body,
				headers: kept,
			});
			remember?.(key, next, JSON.stringify(body), JSON.stringify(kept));
		}
		return response;
	};
}

export async function checkToken(
	token: string,
	fetchImpl: Fetch,
): Promise<Response> {
	return fetchImpl("https://api.github.com/user", {
		headers: githubHeaders(token),
	});
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
							id number title body state stateReason updatedAt comments(first: 20) { nodes { databaseId body createdAt updatedAt author { login } reactions { totalCount } } totalCount }
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
			comments: projectItemComments,
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

function githubState(state: string): "open" | "closed" | null {
	const lower = state.toLowerCase();
	if (lower === "open" || lower === "closed") {
		return lower;
	}
	return null;
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
	return githubOptionColours[color] ?? statusColours.backlog;
}

function labelColour(color: string): string {
	const hex = color.replace(/^#/, "");
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
		return statusColours.backlog;
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
	projectOwner: string,
): Promise<ProjectItem[]> {
	const items: ProjectItem[] = [];
	let after: string | null = null;
	do {
		const response = await fetchImpl("https://api.github.com/graphql", {
			method: "POST",
			headers: githubHeaders(token),
			body: JSON.stringify({
				query: projectItemsQuery,
				variables: { id: projectId, after, projectOwner },
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
	projectOwner: string,
): Promise<TicketStatus[]> {
	const response = await fetchImpl("https://api.github.com/graphql", {
		method: "POST",
		headers: githubHeaders(token),
		body: JSON.stringify({
			query: projectFieldsQuery,
			variables: { id: projectId, projectOwner },
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

export function dependencyRefs(
	nodes: {
		number: number;
		title?: string | null | undefined;
		state: string;
		repository?: { nameWithOwner: string } | null | undefined;
	}[],
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
	projectOwner: string,
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
				variables: { id: issueId, after, projectOwner },
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
	projectOwner: string,
): Promise<z.infer<typeof projectBlockedByNode>[]> {
	return connectionPages(
		token,
		fetchImpl,
		issueId,
		start,
		blockedByQuery,
		"list blockers",
		projectOwner,
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
	projectOwner: string,
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
		const issueNumber = content.number;
		const parent =
			content.parent === null || content.parent === undefined
				? null
				: `${content.parent.repository.nameWithOwner}#${content.parent.number}`;
		const ticketKey = `${repoName}#${issueNumber}`;
		const comments = await projectComments(
			content.comments,
			state === "open" && openKeys.has(ticketKey),
			() => listCommentBodies(token, fetchImpl, repoName, issueNumber),
		);
		const blockedByNodes = [...(content.blockedBy?.nodes ?? [])];
		const blockedByAfter = content.blockedBy?.pageInfo?.hasNextPage
			? content.blockedBy.pageInfo.endCursor
			: null;
		if (blockedByAfter !== null && content.id !== undefined) {
			blockedByNodes.push(
				...(await blockedByPages(
					token,
					fetchImpl,
					content.id,
					blockedByAfter,
					projectOwner,
				)),
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
			blockedBy: dependencyRefs(blockedByNodes, repoName),
			...(comments.length === 0 ? {} : { comments }),
			milestone: content.milestone?.title ?? null,
			parent,
			labels:
				content.labels?.nodes.flatMap((label) =>
					label === undefined ? [] : [label.name],
				) ?? [],
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
	projectOwner: string,
): Promise<z.infer<typeof closingPullNode>[]> {
	return connectionPages(
		token,
		fetchImpl,
		issueId,
		start,
		closingPullsQuery,
		"list closing pulls",
		projectOwner,
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
	projectOwner: string,
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
				...(await closingPullPages(
					token,
					fetchImpl,
					content.id,
					closingAfter,
					projectOwner,
				)),
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

const pageSize = 100;
const mergedPageBound = 10;

type RepoIncludes = {
	issues: boolean;
	openPulls: boolean;
	mergedPulls: boolean;
	refs: boolean;
	labels: boolean;
	edited: boolean;
};

const connectionPage = `pageInfo { hasNextPage endCursor }`;

function pullNodeFields(include: boolean): string {
	if (!include) {
		return "";
	}
	return `number title url isDraft body state mergedAt headRefName headRefOid
				autoMergeRequest { enabledAt }
				commits(last: 1) { nodes { commit { committedDate } } ${connectionPage} }
				closingIssuesReferences(first: 10, userLinkedOnly: true) {
					nodes { number }
					${connectionPage}
				}
				reviews(first: ${pageSize}) {
					nodes { author { login } commit { oid } state }
					${connectionPage}
				}
				comments(first: ${pageSize}) {
					nodes { author { login } body createdAt reactions { totalCount } }
					${connectionPage}
				}
				reactions(first: ${pageSize}) {
					nodes { user { login } content createdAt }
					${connectionPage}
				}
				statusCheckRollup {
					contexts(first: ${pageSize}) {
						nodes { ... on CheckRun { name status conclusion } }
						${connectionPage}
					}
				}`;
}

function issueNodeFields(include: boolean): string {
	if (!include) {
		return "";
	}
	return `number title state stateReason updatedAt createdAt closedAt body
				comments(first: ${pageSize}) {
					nodes { databaseId body createdAt updatedAt author { login } reactions { totalCount } }
					${connectionPage}
				}
				labels(first: ${pageSize}) { nodes { name color } ${connectionPage} }
				assignees(first: 10) { nodes { login } }
				milestone { title }
				parent { number repository { nameWithOwner } }
				blockedBy(first: 20) {
					nodes { number title state repository { nameWithOwner } }
					${connectionPage}
				}
				blocking(first: 20) {
					nodes { number title state repository { nameWithOwner } }
					${connectionPage}
				}`;
}

function repoReadQuery(include: RepoIncludes): string {
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
		? `editedIssues: search(first: ${pageSize}, after: $afterEdited, type: ISSUE, query: $editedQuery) {
			nodes { ... on Issue { ${issueNodeFields(true)} } }
			${connectionPage}
		}`
		: "";
	return `query RepoRead(${variables.join(", ")}) {
	repository(owner: $owner, name: $name) {
		nameWithOwner
		autoMergeAllowed
		${
			include.refs
				? `refs(refPrefix: "refs/heads/", first: ${pageSize}, after: $afterRefs) {
			nodes { name }
			${connectionPage}
		}`
				: ""
		}
		${
			include.labels
				? `labels(first: ${pageSize}, after: $afterLabels) {
			nodes { name color }
			${connectionPage}
		}`
				: ""
		}
		${
			include.issues
				? `issues(first: ${pageSize}, after: $afterIssues, states: [OPEN, CLOSED], filterBy: { since: $since }, orderBy: { field: UPDATED_AT, direction: DESC }) {
			nodes { ${issueNodeFields(true)} }
			${connectionPage}
		}`
				: ""
		}
		${
			include.openPulls
				? `openPullRequests: pullRequests(first: ${pageSize}, after: $afterPulls, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
			nodes { ${pullNodeFields(true)} }
			${connectionPage}
		}`
				: ""
		}
		${
			include.mergedPulls
				? `mergedPullRequests: pullRequests(first: ${mergedPageBound}, states: [MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
			nodes { ${pullNodeFields(true)} }
			${connectionPage}
		}`
				: ""
		}
	}
	${editedFilter}
}`;
}

const graphqlDependency = z.object({
	number: z.number(),
	title: z.string().nullable().optional(),
	state: z.string(),
	repository: z.object({ nameWithOwner: z.string() }).nullable().optional(),
});

const graphqlConnection = <T extends z.ZodType>(node: T) =>
	z.object({
		nodes: z.array(node.optional().catch(undefined)),
		pageInfo: pageInfo.optional(),
	});

const graphqlIssueNode = z.object({
	number: z.number(),
	title: z.string(),
	state: z.string(),
	stateReason: z.string().nullable().optional(),
	updatedAt: z.string(),
	createdAt: z.string().optional(),
	closedAt: z.string().nullable().optional(),
	body: z.string().nullable().optional(),
	comments: graphqlConnection(graphqlComment).optional(),
	labels: graphqlConnection(
		z.object({ name: z.string(), color: z.string() }),
	).optional(),
	assignees: z
		.object({ nodes: z.array(z.object({ login: z.string() })) })
		.optional(),
	milestone: z.object({ title: z.string() }).nullable().optional(),
	parent: z
		.object({
			number: z.number(),
			title: z.string().nullable().optional(),
			repository: z.object({ nameWithOwner: z.string() }),
		})
		.nullable()
		.optional()
		.catch(null),
	blockedBy: graphqlConnection(graphqlDependency).optional().catch(undefined),
	blocking: graphqlConnection(graphqlDependency).optional(),
});

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

const graphqlPullNode = z.object({
	number: z.number(),
	title: z.string(),
	url: z.string(),
	isDraft: z.boolean(),
	body: z.string().nullable().optional(),
	state: z.string(),
	mergedAt: z.string().nullable().optional(),
	headRefName: z.string(),
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
	reviews: graphqlConnection(
		z.object({
			author: graphqlActor.optional(),
			commit: z.object({ oid: z.string() }).nullable().optional(),
			state: reviewStateGraphql,
		}),
	).optional(),
	comments: graphqlConnection(
		z.object({
			author: graphqlActor.optional(),
			body: z.string().nullable().optional(),
			createdAt: z.string().optional(),
			reactions: z.object({ totalCount: z.number() }).optional(),
		}),
	).optional(),
	reactions: graphqlConnection(
		z.object({
			user: graphqlActor.optional(),
			content: reactionContent,
			createdAt: z.string().optional(),
		}),
	).optional(),
	statusCheckRollup: z
		.object({
			contexts: graphqlConnection(
				z.object({
					name: z.string().optional(),
					status: checkStatus.optional(),
					conclusion: checkConclusion.nullable().optional(),
				}),
			),
		})
		.nullable()
		.optional(),
});

const graphqlLabelNode = z.object({ name: z.string(), color: z.string() });

const repoReadPage = z.object({
	data: z.object({
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
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

type RepoReadPage = z.infer<typeof repoReadPage>["data"];

function splitRepo(repo: string): { owner: string; name: string } | null {
	const [owner, name] = repo.split("/");
	if (owner === undefined || name === undefined || name === "") {
		return null;
	}
	return { owner, name };
}

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

async function readAutoMerge(
	token: string,
	fetchImpl: Fetch,
	repo: string,
): Promise<boolean> {
	const parts = splitRepo(repo);
	if (parts === null) {
		return false;
	}
	const response = await fetchImpl("https://api.github.com/graphql", {
		method: "POST",
		headers: githubHeaders(token),
		body: JSON.stringify({
			query: autoMergeQuery,
			variables: { owner: parts.owner, name: parts.name },
		}),
	});
	if (response.status === 404) {
		return false;
	}
	if (!response.ok) {
		throw new Error(
			`GitHub read repo failed (HTTP ${response.status}): ${repo}`,
		);
	}
	const parsed = z
		.object({
			data: z.object({
				repository: z
					.object({
						nameWithOwner: z.string(),
						autoMergeAllowed: z.boolean().nullable(),
					})
					.nullable(),
			}),
			errors: z.array(z.object({ message: z.string() })).optional(),
		})
		.safeParse(await response.json());
	const repository = parsed.success ? parsed.data.data.repository : null;
	if (
		!parsed.success ||
		parsed.data.errors?.[0] !== undefined ||
		repository === null ||
		repository.nameWithOwner.toLowerCase() !== repo.toLowerCase()
	) {
		throw new Error(`GitHub read repo failed: ${repo}`);
	}
	return repository.autoMergeAllowed === true;
}

async function readRepoPage(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	since: Date | null,
	cursors: PageCursors,
	include: RepoIncludes,
): Promise<RepoReadPage | null> {
	const parts = splitRepo(repo);
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
	const response = await fetchImpl("https://api.github.com/graphql", {
		method: "POST",
		headers: githubHeaders(token),
		body: JSON.stringify({
			query: repoReadQuery(include),
			variables,
		}),
	});
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(
			`GitHub read repo failed (HTTP ${response.status}): ${repo}`,
		);
	}
	const body: unknown = await response.json();
	const parsed = repoReadPage.safeParse(body);
	if (!parsed.success) {
		const failed = z
			.object({ errors: z.array(z.object({ message: z.string() })).min(1) })
			.safeParse(body);
		const failure = failed.success ? failed.data.errors[0] : undefined;
		if (failure !== undefined) {
			throw new Error(failure.message);
		}
		throw new Error(`GitHub read repo failed: ${repo}`);
	}
	const error = parsed.data.errors?.[0];
	if (error !== undefined) {
		throw new Error(`GitHub read repo failed: ${error.message}`);
	}
	const repository = parsed.data.data.repository;
	if (
		repository === null ||
		repository.nameWithOwner.toLowerCase() !== repo.toLowerCase()
	) {
		throw new Error(`GitHub read repo failed: ${repo}`);
	}
	return parsed.data.data;
}

function ticketFromGraphql(
	issue: z.infer<typeof graphqlIssueNode>,
	repo: string,
): Ticket {
	const closedAt = issue.closedAt?.trim() ?? "";
	const createdAt = issue.createdAt?.trim() ?? "";
	const state = issue.state.toLowerCase();
	const comments = (issue.comments?.nodes ?? []).flatMap((comment) => {
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
	const blockedBy = dependencyRefs(
		(issue.blockedBy?.nodes ?? []).flatMap((node) =>
			node === undefined ? [] : [node],
		),
		repo,
	);
	const blocking =
		state === "closed"
			? []
			: dependencyRefs(
					(issue.blocking?.nodes ?? []).flatMap((node) =>
						node === undefined ? [] : [node],
					),
					repo,
				);
	const assignees = (issue.assignees?.nodes ?? []).flatMap((person) =>
		person === undefined ? [] : [person.login],
	);
	return {
		id: String(issue.number),
		tracker: "github",
		key: `${repo}#${issue.number}`,
		title: issue.title,
		state: state === "closed" ? "closed" : "open",
		stateReason: githubReason(issue.stateReason ?? null),
		updatedAt: issue.updatedAt,
		ref: `${repo}#${issue.number}`,
		body: issue.body ?? "",
		blockedBy,
		...(blocking.length === 0 ? {} : { blocks: blocking }),
		...(comments.length === 0 ? {} : { comments }),
		milestone: issue.milestone?.title ?? null,
		parent:
			issue.parent === undefined || issue.parent === null
				? null
				: `${issue.parent.repository.nameWithOwner}#${issue.parent.number}`,
		labels:
			issue.labels?.nodes.flatMap((label) =>
				label === undefined ? [] : [label.name],
			) ?? [],
		...(closedAt === "" ? {} : { closedAt }),
		...(createdAt === "" ? {} : { createdAt }),
		...(assignees.length === 0
			? {}
			: { assignee: assignees[0] ?? null, assignees }),
	};
}

function reviewFromGraphql(
	pull: z.infer<typeof graphqlPullNode>,
): ReviewEvidence {
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

function pullFromGraphql(
	pull: z.infer<typeof graphqlPullNode>,
	repo: string,
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
			const key = `${repo}#${node.number}`;
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
		...(pull.isDraft
			? { checks: [], comments: [], reviews: [], reactions: [] }
			: reviewFromGraphql(pull)),
	};
}

type Connection<T> = {
	nodes: T[];
	pageInfo?: { hasNextPage: boolean; endCursor: string | null } | undefined;
};

function nextCursor<T>(
	connection: Connection<T> | null | undefined,
): string | null {
	if (connection?.pageInfo?.hasNextPage !== true) {
		return null;
	}
	return connection.pageInfo.endCursor;
}

const emptyCursors: PageCursors = {
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

function onlyInclude(key: keyof RepoIncludes): RepoIncludes {
	return { ...noIncludes, [key]: true };
}

const firstIncludes = (since: Date | null): RepoIncludes => ({
	issues: true,
	openPulls: true,
	mergedPulls: true,
	refs: true,
	labels: true,
	edited: since !== null,
});

async function collectConnection<T>(
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
			throw new Error(`GitHub read repo failed: ${repo}`);
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

const nestedReviewQuery = `query NestedReview($owner: String!, $name: String!, $number: Int!, $afterReviews: String, $afterComments: String, $afterReactions: String, $afterContexts: String, $afterClosing: String) {
	repository(owner: $owner, name: $name) {
		pullRequest(number: $number) {
			reviews(first: ${pageSize}, after: $afterReviews) {
				nodes { author { login } commit { oid } state }
				${connectionPage}
			}
			comments(first: ${pageSize}, after: $afterComments) {
				nodes { author { login } body createdAt reactions { totalCount } }
				${connectionPage}
			}
			reactions(first: ${pageSize}, after: $afterReactions) {
				nodes { user { login } content createdAt }
				${connectionPage}
			}
			closingIssuesReferences(first: 10, after: $afterClosing, userLinkedOnly: true) {
				nodes { number }
				${connectionPage}
			}
			statusCheckRollup {
				contexts(first: ${pageSize}, after: $afterContexts) {
					nodes { ... on CheckRun { name status conclusion } }
					${connectionPage}
				}
			}
		}
	}
}`;

const nestedReviewPage = z.object({
	data: z.object({
		repository: z
			.object({
				pullRequest: z
					.object({
						reviews: graphqlPullNode.shape.reviews,
						comments: graphqlPullNode.shape.comments,
						reactions: graphqlPullNode.shape.reactions,
						closingIssuesReferences:
							graphqlPullNode.shape.closingIssuesReferences,
						statusCheckRollup: graphqlPullNode.shape.statusCheckRollup,
					})
					.nullable(),
			})
			.nullable(),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

async function pageNestedReviews(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	pull: z.infer<typeof graphqlPullNode>,
): Promise<void> {
	const parts = splitRepo(repo);
	if (parts === null) {
		return;
	}
	const pending = {
		reviews: pull.reviews === undefined ? null : nextCursor(pull.reviews),
		comments: pull.comments === undefined ? null : nextCursor(pull.comments),
		reactions: pull.reactions === undefined ? null : nextCursor(pull.reactions),
		contexts:
			pull.statusCheckRollup?.contexts === undefined
				? null
				: nextCursor(pull.statusCheckRollup.contexts),
		closing:
			pull.closingIssuesReferences === undefined
				? null
				: nextCursor(pull.closingIssuesReferences),
	};
	while (
		pending.reviews !== null ||
		pending.comments !== null ||
		pending.reactions !== null ||
		pending.contexts !== null ||
		pending.closing !== null
	) {
		const response = await fetchImpl("https://api.github.com/graphql", {
			method: "POST",
			headers: githubHeaders(token),
			body: JSON.stringify({
				query: nestedReviewQuery,
				variables: {
					owner: parts.owner,
					name: parts.name,
					number: pull.number,
					afterReviews: pending.reviews,
					afterComments: pending.comments,
					afterReactions: pending.reactions,
					afterContexts: pending.contexts,
					afterClosing: pending.closing,
				},
			}),
		});
		if (!response.ok) {
			throw new Error(
				`GitHub read repo failed (HTTP ${response.status}): ${repo}`,
			);
		}
		const parsed = nestedReviewPage.safeParse(await response.json());
		const next = parsed.success
			? parsed.data.data.repository?.pullRequest
			: null;
		if (!parsed.success || next === null || next === undefined) {
			throw new Error(`GitHub read repo failed: ${repo}`);
		}
		if (parsed.data.errors?.[0] !== undefined) {
			throw new Error(
				`GitHub read repo failed: ${parsed.data.errors[0].message}`,
			);
		}
		if (pending.reviews !== null) {
			pull.reviews?.nodes.push(...(next.reviews?.nodes ?? []));
			pending.reviews = nextCursor(next.reviews);
		}
		if (pending.comments !== null) {
			pull.comments?.nodes.push(...(next.comments?.nodes ?? []));
			pending.comments = nextCursor(next.comments);
		}
		if (pending.reactions !== null) {
			pull.reactions?.nodes.push(...(next.reactions?.nodes ?? []));
			pending.reactions = nextCursor(next.reactions);
		}
		if (pending.closing !== null) {
			pull.closingIssuesReferences?.nodes.push(
				...(next.closingIssuesReferences?.nodes ?? []),
			);
			pending.closing = nextCursor(next.closingIssuesReferences);
		}
		if (pending.contexts !== null) {
			const contexts = pull.statusCheckRollup?.contexts;
			contexts?.nodes.push(...(next.statusCheckRollup?.contexts.nodes ?? []));
			pending.contexts = nextCursor(next.statusCheckRollup?.contexts);
		}
	}
}

async function pageIssueRelations(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	issue: z.infer<typeof graphqlIssueNode>,
): Promise<void> {
	const parts = splitRepo(repo);
	if (parts === null) {
		return;
	}
	const pending = {
		blockedBy: nextCursor(issue.blockedBy),
		blocking: nextCursor(issue.blocking),
		labels: nextCursor(issue.labels),
	};
	while (
		pending.blockedBy !== null ||
		pending.blocking !== null ||
		pending.labels !== null
	) {
		const response = await fetchImpl("https://api.github.com/graphql", {
			method: "POST",
			headers: githubHeaders(token),
			body: JSON.stringify({
				query: `query IssueRelations($owner: String!, $name: String!, $number: Int!, $afterBlockedBy: String, $afterBlocking: String, $afterLabels: String) {
					repository(owner: $owner, name: $name) {
						issue(number: $number) {
							blockedBy(first: 20, after: $afterBlockedBy) {
								nodes { number title state repository { nameWithOwner } }
								${connectionPage}
							}
							blocking(first: 20, after: $afterBlocking) {
								nodes { number title state repository { nameWithOwner } }
								${connectionPage}
							}
							labels(first: ${pageSize}, after: $afterLabels) {
								nodes { name color }
								${connectionPage}
							}
						}
					}
				}`,
				variables: {
					owner: parts.owner,
					name: parts.name,
					number: issue.number,
					afterBlockedBy: pending.blockedBy,
					afterBlocking: pending.blocking,
					afterLabels: pending.labels,
				},
			}),
		});
		if (!response.ok) {
			throw new Error(
				`GitHub read repo failed (HTTP ${response.status}): ${repo}`,
			);
		}
		const parsed = z
			.object({
				data: z.object({
					repository: z
						.object({
							issue: z
								.object({
									blockedBy: graphqlIssueNode.shape.blockedBy,
									blocking: graphqlIssueNode.shape.blocking,
									labels: graphqlIssueNode.shape.labels,
								})
								.nullable(),
						})
						.nullable(),
				}),
				errors: z.array(z.object({ message: z.string() })).optional(),
			})
			.safeParse(await response.json());
		const next = parsed.success ? parsed.data.data.repository?.issue : null;
		if (
			!parsed.success ||
			parsed.data.errors?.[0] !== undefined ||
			next === null ||
			next === undefined
		) {
			throw new Error(`GitHub read repo failed: ${repo}`);
		}
		if (pending.blockedBy !== null) {
			issue.blockedBy?.nodes.push(...(next.blockedBy?.nodes ?? []));
			pending.blockedBy = nextCursor(next.blockedBy);
		}
		if (pending.blocking !== null) {
			issue.blocking?.nodes.push(...(next.blocking?.nodes ?? []));
			pending.blocking = nextCursor(next.blocking);
		}
		if (pending.labels !== null) {
			issue.labels?.nodes.push(...(next.labels?.nodes ?? []));
			pending.labels = nextCursor(next.labels);
		}
	}
}

async function pageIssueComments(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	issue: z.infer<typeof graphqlIssueNode>,
): Promise<void> {
	const parts = splitRepo(repo);
	if (parts === null || nextCursor(issue.comments) === null) {
		return;
	}
	let cursor = nextCursor(issue.comments);
	while (cursor !== null) {
		const response = await fetchImpl("https://api.github.com/graphql", {
			method: "POST",
			headers: githubHeaders(token),
			body: JSON.stringify({
				query: `query IssueComments($owner: String!, $name: String!, $number: Int!, $after: String) {
					repository(owner: $owner, name: $name) {
						issue(number: $number) {
							comments(first: ${pageSize}, after: $after) {
								nodes { databaseId body createdAt updatedAt author { login } reactions { totalCount } }
								${connectionPage}
							}
						}
					}
				}`,
				variables: {
					owner: parts.owner,
					name: parts.name,
					number: issue.number,
					after: cursor,
				},
			}),
		});
		if (!response.ok) {
			throw new Error(
				`GitHub read repo failed (HTTP ${response.status}): ${repo}`,
			);
		}
		const parsed = z
			.object({
				data: z.object({
					repository: z
						.object({
							issue: z
								.object({ comments: graphqlConnection(graphqlComment) })
								.nullable(),
						})
						.nullable(),
				}),
			})
			.safeParse(await response.json());
		const comments = parsed.success
			? parsed.data.data.repository?.issue?.comments
			: undefined;
		if (comments === undefined) {
			throw new Error(`GitHub read repo failed: ${repo}`);
		}
		issue.comments?.nodes.push(...comments.nodes);
		cursor = nextCursor(comments);
	}
}

async function readRepo(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	since: Date | null,
): Promise<{
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	labels: { name: string; colour: string }[];
	autoMerge: boolean;
} | null> {
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
			issues.push(issue);
		}
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
	for (const issue of issueNodes) {
		await pageIssueRelations(token, fetchImpl, repo, issue);
		await pageIssueComments(token, fetchImpl, repo, issue);
	}
	const pullPages = [
		...pullNodes,
		...(first.mergedPullRequests?.nodes ?? []),
	].flatMap((node) => (node === undefined || node === null ? [] : [node]));
	for (const pull of pullPages) {
		await pageNestedReviews(token, fetchImpl, repo, pull);
	}
	const tickets = issueNodes
		.filter((issue) => {
			const state = issue.state.toLowerCase();
			return state === "open" || state === "closed";
		})
		.map((issue) => ticketFromGraphql(issue, repo));
	const openPulls = pullNodes.flatMap((pull) => {
		if (pull === undefined) {
			return [];
		}
		const mapped = pullFromGraphql(pull, repo);
		return mapped === null || mapped.merged ? [] : [mapped];
	});
	const mergedKept = (first.mergedPullRequests?.nodes ?? []).flatMap((pull) => {
		if (pull === undefined) {
			return [];
		}
		const mapped = pullFromGraphql(pull, repo);
		return mapped?.merged === true ? [mapped] : [];
	});
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

export function githubTracker(token: string, fetchImpl: Fetch): Tracker {
	let holdLists: Promise<void> = Promise.resolve();
	const seenReviews = new Map<string, ReviewEvidence>();
	const projectItemsById = new Map<string, Promise<ProjectItem[]>>();
	const projectItems = (projectId: string, projectOwner: string) => {
		const cached = projectItemsById.get(projectId);
		if (cached !== undefined) {
			return cached;
		}
		const listed = listProjectItems(
			token,
			fetchImpl,
			projectId,
			projectOwner,
		).catch((error: unknown) => {
			if (projectItemsById.get(projectId) === listed) {
				projectItemsById.delete(projectId);
			}
			throw error;
		});
		projectItemsById.set(projectId, listed);
		return listed;
	};
	const autoMergeByRepo = new Map<string, Promise<boolean>>();
	const pollReads = new Map<string, Promise<Date | null>>();
	const repoSnapshots = new Map<string, ReturnType<typeof readRepo>>();
	const repoReadFor = (repo: string, since: Date | null) => {
		const pending = pollReads.get(repo);
		const cutoff = pending ?? Promise.resolve(since);
		if (pending === undefined) {
			pollReads.set(repo, cutoff);
		} else {
			pollReads.set(
				repo,
				Promise.all([pending, Promise.resolve(since)]).then(
					([earlier, next]) => {
						if (earlier === null || next === null) {
							return null;
						}
						return earlier < next ? earlier : next;
					},
				),
			);
		}
		const cached = repoSnapshots.get(repo);
		if (cached !== undefined) {
			return cached;
		}
		const read = Promise.all([cutoff, holdLists]).then(([stamp]) =>
			readRepo(token, fetchImpl, repo, stamp).catch((error: unknown) => {
				if (repoSnapshots.get(repo) === read) {
					repoSnapshots.delete(repo);
					pollReads.delete(repo);
				}
				throw error;
			}),
		);
		repoSnapshots.set(repo, read);
		return read;
	};
	return {
		beginPoll() {
			pollReads.clear();
			repoSnapshots.clear();
			autoMergeByRepo.clear();
		},
		holdLists(held: Promise<void>) {
			holdLists = held;
		},
		findProjects() {
			return findGithubProjects(token, fetchImpl);
		},
		async listTickets(repo, since, projectOwner = "", held = []) {
			if (!repo.includes("/")) {
				projectItemsById.clear();
				const items = await projectItems(repo, projectOwner);
				const openKeys = openLinkedKeys(items);
				const tickets = await listProjectTickets(
					token,
					fetchImpl,
					items,
					openKeys,
					projectOwner,
				);
				const statuses = await listProjectStatuses(
					token,
					fetchImpl,
					repo,
					projectOwner,
				);
				const board: Board = {
					kind: "github-project",
					statuses,
					factoryLabels: false,
				};
				return { name: repo, tickets, board };
			}
			const batched = await repoReadFor(repo, since);
			if (batched === null) {
				throw new Error(`GitHub read repo failed: ${repo}`);
			}
			const board = factoryBoard(batched.labels);
			const tickets = await currentBlockers(
				token,
				fetchImpl,
				repo,
				batched.tickets,
				since === null ? [] : held,
			);
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
		async listPulls(repo, _since, projectOwner = "") {
			if (!repo.includes("/")) {
				return listProjectPulls(
					token,
					fetchImpl,
					await projectItems(repo, projectOwner),
					seenReviews,
					projectOwner,
				);
			}
			const batched = await repoReadFor(repo, null);
			if (batched === null) {
				throw new Error(`GitHub read repo failed: ${repo}`);
			}
			for (const pull of batched.pulls) {
				if (pull.merged) {
					seenReviews.set(mergedReviewKey(repo, pull.number), {
						checks: pull.checks,
						comments: pull.comments,
						reviews: pull.reviews,
						reactions: pull.reactions,
					});
				}
			}
			return batched.pulls;
		},
		async repoAutoMerge(repo) {
			if (!repo.includes("/")) {
				return false;
			}
			const cached = autoMergeByRepo.get(repo);
			if (cached !== undefined) {
				return cached;
			}
			const snapshot = repoSnapshots.get(repo);
			const read =
				snapshot === undefined
					? readAutoMerge(token, fetchImpl, repo)
					: snapshot.then((opened) => opened?.autoMerge ?? false);
			autoMergeByRepo.set(repo, read);
			return read;
		},
		async listBranches(repo) {
			if (!repo.includes("/")) {
				return [];
			}
			const batched = await repoReadFor(repo, null);
			if (batched === null) {
				throw new Error(`GitHub read repo failed: ${repo}`);
			}
			return batched.branches;
		},
		fetchThread(project, key, signal) {
			return fetchGithubThread(token, fetchImpl, project, key, signal);
		},
		postReply(reply) {
			return postGithubReply(token, fetchImpl, reply);
		},
	};
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
