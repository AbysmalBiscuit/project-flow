import { z } from "zod";
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
import {
	closedStatusType,
	factoryBoard,
	heldBlockerIds,
	refreshedBlockers,
	reviewStateValue,
	statusTypeOfName,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	commentFromGithub,
	githubComment,
	graphqlActor,
	graphqlComment,
} from "./github-comment.ts";
import {
	githubGraphql,
	graphqlConnection,
	graphqlDependency,
	pageInfo,
	postGithubGraphql,
} from "./github-graphql.ts";
import { githubHeaders, nextPage, pages } from "./github-pages.ts";
import { fetchGithubThread, postGithubReply } from "./github-thread.ts";
import { type GraphqlQuery, graphqlData } from "./graphql.ts";
import {
	type FoundProject,
	type GithubTracker,
	TrackerError,
	type Viewer,
} from "./ports.ts";
import { repoParts, sameRepo } from "./project-ref.ts";
import { githubKey } from "./ticket-key.ts";
import { statusColours } from "./token-palette.ts";

export { githubHeaders } from "./github-pages.ts";

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

type RestCache = Map<string, RestEntry>;

/** The last GitHub REST response for each URL, kept across restarts. */
export type ValidatorStore = {
	read: () => { url: string; etag: string; body: string; headers: string }[];
	record: (url: string, etag: string, body: string, headers: string) => void;
};

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

function rememberValidator(
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
	validators?: ValidatorStore,
): Fetch {
	const cache: RestCache = new Map();
	for (const validator of validators?.read() ?? []) {
		rememberValidator(
			cache,
			validator.url,
			validator.etag,
			JSON.parse(validator.body) as unknown,
			validator.headers,
		);
	}
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
				validators?.record(
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
			validators?.record(key, next, JSON.stringify(body), JSON.stringify(kept));
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

function graphqlPage(
	token: string,
	fetchImpl: Fetch,
	query: string,
	variables: Record<string, string | null>,
): Promise<z.infer<typeof graphqlProjects>> {
	return githubGraphql(
		{ token, fetchImpl },
		{ query, variables, data: graphqlProjects, label: "find projects" },
	);
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
		const projects = page.organization?.projectsV2;
		if (projects === undefined) {
			throw new TrackerError(`GitHub find projects failed: ${login}`, 502);
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
			const viewer = page.viewer;
			if (viewer === undefined) {
				throw new TrackerError("GitHub find projects failed", 502);
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
			throw new TrackerError(
				`GitHub find repos failed (HTTP ${response.status})`,
				response.status,
			);
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
		throw new TrackerError(projectError, 502);
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
	repositoryOwner: z
		.object({
			projectV2: projectNode.nullable(),
		})
		.nullable(),
});

async function githubProjectByNumber(
	token: string,
	fetchImpl: Fetch,
	owner: string,
	number: number,
): Promise<FoundProject | null> {
	const page = await githubGraphql(
		{ token, fetchImpl },
		{
			query: projectByNumberQuery,
			variables: { owner, number },
			data: projectByNumber,
			label: "find project",
			subject: `${owner}/${number}`,
		},
	);
	const node = page.repositoryOwner?.projectV2;
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

const pageSize = 100;

const connectionPage = `pageInfo { hasNextPage endCursor }`;

const nestedPageSize = 20;

const issueTicketFields = (
	labelPage: number,
) => `number title state stateReason updatedAt createdAt closedAt body
				labels(first: ${labelPage}) { nodes { name } ${connectionPage} }
				assignees(first: 10) { nodes { login } }
				milestone { title }
				parent { number title state stateReason url repository { nameWithOwner } }
				blockedBy(first: 20) {
					nodes { number title state repository { nameWithOwner } }
					${connectionPage}
				}
				blocking(first: 20) {
					nodes { number title state repository { nameWithOwner } }
					${connectionPage}
				}`;

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
	node: z
		.object({
			closedByPullRequestsReferences: z.object({
				nodes: z.array(closingPullNode),
				pageInfo,
			}),
		})
		.nullable(),
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
							id ${issueTicketFields(pageSize)}
							comments { totalCount }
							repository { nameWithOwner }
							closedByPullRequestsReferences(first: 20) {
								nodes { number repository { nameWithOwner } }
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

const blockingQuery = `query Blocking($id: ID!, $after: String) {
	node(id: $id) {
		... on Issue {
			blocking(first: 20, after: $after) {
				nodes { number title state repository { nameWithOwner } }
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const dependencyConnection = z.object({
	nodes: z.array(graphqlDependency),
	pageInfo,
});

const dependencyPage = z.object({
	node: z
		.object({
			blockedBy: dependencyConnection.optional(),
			blocking: dependencyConnection.optional(),
		})
		.nullable(),
});

const githubParent = z.object({
	number: z.number(),
	title: z.string().nullable().optional(),
	state: z.string().optional(),
	stateReason: z.string().nullable().optional(),
	url: z.string().optional(),
	repository: z.object({ nameWithOwner: z.string() }),
});

function parentOf(
	parent: z.infer<typeof githubParent> | null | undefined,
): Pick<Ticket, "parent" | "parentDetails"> {
	if (parent === null || parent === undefined) {
		return { parent: null };
	}
	const project = parent.repository.nameWithOwner;
	const key = githubKey(project, parent.number);
	const state = githubState(parent.state ?? "");
	if (state === null || parent.url === undefined) {
		return { parent: key };
	}
	return {
		parent: key,
		parentDetails: {
			title: parent.title ?? "",
			...(state === "open"
				? {}
				: {
						state: closedStatusType(githubReason(parent.stateReason ?? null)),
					}),
			project,
			url: parent.url,
		},
	};
}

const githubIssue = z.object({
	number: z.number(),
	title: z.string(),
	state: z.string(),
	stateReason: z.string().nullable().optional(),
	updatedAt: z.string(),
	createdAt: z.string().optional(),
	closedAt: z.string().nullable().optional(),
	body: z.string().nullable().optional(),
	labels: graphqlConnection(z.object({ name: z.string() })).optional(),
	assignees: z
		.object({ nodes: z.array(z.object({ login: z.string() })) })
		.optional(),
	milestone: z.object({ title: z.string() }).nullable().optional(),
	parent: githubParent.nullable().optional().catch(null),
	blockedBy: graphqlConnection(graphqlDependency).optional().catch(undefined),
	blocking: graphqlConnection(graphqlDependency).optional(),
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
	content: githubIssue
		.partial()
		.extend({
			__typename: z.string(),
			id: z.string().optional(),
			comments: z.object({ totalCount: z.number() }).optional(),
			repository: z.object({ nameWithOwner: z.string() }).optional(),
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
	node: z
		.object({
			items: z.object({
				nodes: z.array(projectItem),
				pageInfo,
			}),
		})
		.nullable(),
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

function openIssues(items: ProjectItem[]) {
	return items.flatMap(({ content }) =>
		content === null ||
		content.__typename !== "Issue" ||
		content.number === undefined ||
		content.repository === undefined ||
		githubState(content.state ?? "") !== "open"
			? []
			: [
					{
						content,
						repo: content.repository.nameWithOwner,
						key: githubKey(content.repository.nameWithOwner, content.number),
					},
				],
	);
}

function openLinkedKeys(items: ProjectItem[]): Set<string> {
	return new Set(
		openIssues(items).flatMap(({ content, key }) =>
			(content.closedByPullRequestsReferences?.nodes.length ?? 0) > 0
				? [key]
				: [],
		),
	);
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
		const page: z.infer<typeof projectItems> = await githubGraphql(
			{ token, fetchImpl },
			{
				query: projectItemsQuery,
				variables: { id: projectId, after, projectOwner },
				data: projectItems,
				label: "list project tickets",
				subject: projectId,
			},
		);
		if (page.node === null) {
			throw new TrackerError(
				`GitHub list project tickets failed: ${projectId}`,
				502,
			);
		}
		for (const item of page.node.items.nodes) {
			items.push(item);
		}
		after = page.node.items.pageInfo.hasNextPage
			? page.node.items.pageInfo.endCursor
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
});

async function listProjectStatuses(
	token: string,
	fetchImpl: Fetch,
	projectId: string,
	projectOwner: string,
): Promise<TicketStatus[]> {
	const page = await githubGraphql(
		{ token, fetchImpl },
		{
			query: projectFieldsQuery,
			variables: { id: projectId, projectOwner },
			data: projectFields,
			label: "list project statuses",
			subject: projectId,
		},
	);
	const field = page.node?.fields.nodes.find(
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
		throw new TrackerError(`GitHub list issue events failed: ${repo}`, 502);
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
		throw new TrackerError(
			`GitHub list issue events failed (HTTP ${first.status}): ${repo}`,
			first.status,
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
			throw new TrackerError(
				`GitHub list issue events failed (HTTP ${response.status}): ${repo}`,
				response.status,
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

function dependencyRefs(
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
			key: githubKey(project, node.number),
			state,
			...(title === "" ? {} : { title }),
		};
		if (!refs.some((item) => item.key === ref.key)) {
			refs.push(ref);
		}
	}
	return refs;
}

async function connectionPages<Data extends z.ZodType, Node>(
	token: string,
	fetchImpl: Fetch,
	issueId: string,
	start: string,
	query: string,
	label: string,
	projectOwner: string,
	data: Data,
	read: (page: z.infer<Data>) =>
		| {
				nodes: Node[];
				pageInfo: z.infer<typeof pageInfo>;
		  }
		| undefined,
): Promise<Node[]> {
	const nodes: Node[] = [];
	let after: string | null = start;
	do {
		const page = await githubGraphql(
			{ token, fetchImpl },
			{
				query,
				variables: { id: issueId, after, projectOwner },
				data,
				label,
				subject: issueId,
			},
		);
		const connection = read(page);
		if (connection === undefined) {
			throw new TrackerError(`GitHub ${label} failed: ${issueId}`, 502);
		}
		nodes.push(...connection.nodes);
		after = connection.pageInfo.hasNextPage
			? connection.pageInfo.endCursor
			: null;
	} while (after !== null);
	return nodes;
}

const dependencyQueries = {
	blockedBy: { query: blockedByQuery, label: "list blockers" },
	blocking: { query: blockingQuery, label: "list blocked tickets" },
};

async function dependencyPages(
	token: string,
	fetchImpl: Fetch,
	issueId: string | undefined,
	relation: keyof typeof dependencyQueries,
	first: z.infer<typeof githubIssue>[typeof relation],
	projectOwner: string,
): Promise<z.infer<typeof graphqlDependency>[]> {
	const nodes = (first?.nodes ?? []).flatMap((node) =>
		node === undefined ? [] : [node],
	);
	const start = nextCursor(first);
	if (start === null || issueId === undefined) {
		return nodes;
	}
	const { query, label } = dependencyQueries[relation];
	const rest = await connectionPages(
		token,
		fetchImpl,
		issueId,
		start,
		query,
		label,
		projectOwner,
		dependencyPage,
		(page) => page.node?.[relation],
	);
	return [...nodes, ...rest];
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
		const ticketKey = githubKey(repoName, content.number);
		const comments =
			state === "open" &&
			openKeys.has(ticketKey) &&
			(content.comments?.totalCount ?? 0) > 0
				? await listCommentBodies(token, fetchImpl, repoName, content.number)
				: [];
		const blockedBy = await dependencyPages(
			token,
			fetchImpl,
			content.id,
			"blockedBy",
			content.blockedBy,
			projectOwner,
		);
		const blocking =
			state === "closed"
				? []
				: await dependencyPages(
						token,
						fetchImpl,
						content.id,
						"blocking",
						content.blocking,
						projectOwner,
					);
		tickets.push({
			...ticketFromGithubIssue(
				{
					...content,
					number: content.number,
					title: content.title ?? "",
					state,
					updatedAt: content.updatedAt ?? "",
					blockedBy: { nodes: blockedBy },
					blocking: { nodes: blocking },
				},
				repoName,
				comments,
			),
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
		closingPulls,
		(page) => page.node?.closedByPullRequestsReferences,
	);
}

async function listProjectPulls(
	token: string,
	fetchImpl: Fetch,
	items: ProjectItem[],
	seen: Map<string, ReviewEvidence>,
	projectOwner: string,
): Promise<PullRequest[]> {
	const links: PullLink[] = [];
	for (const { content, repo, key: ticketKey } of openIssues(items)) {
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
			links.push({
				repo: linked.repository?.nameWithOwner ?? repo,
				number: linked.number,
				ticketKey,
			});
		}
	}
	const repos = items.flatMap(({ content }) =>
		content?.repository === undefined ? [] : [content.repository.nameWithOwner],
	);
	return loadLinkedPulls(token, fetchImpl, links, repos, seen);
}

export type PullLink = { repo: string; number: number; ticketKey: string };

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

const mergedPageBound = 10;

type RepoIncludes = {
	issues: boolean;
	openPulls: boolean;
	mergedPulls: boolean;
	refs: boolean;
	labels: boolean;
	edited: boolean;
};

const closingSelection = `nodes { number } ${connectionPage}`;

const pullNodeFields = `id number title url isDraft body state mergedAt updatedAt headRefName headRefOid
				autoMergeRequest { enabledAt }
				commits(last: 1) { nodes { commit { committedDate } } }
				closingIssuesReferences(first: 10, userLinkedOnly: true) { ${closingSelection} }`;

const issueNodeFields = `id ${issueTicketFields(nestedPageSize)}`;

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

const issueCommentSelection = `nodes { databaseId body createdAt updatedAt author { login } reactions { totalCount } } ${connectionPage}`;

const pullCommentSelection = `nodes { author { login } body createdAt reactions { totalCount } } ${connectionPage}`;

const reviewSelection = `nodes { author { login } commit { oid } state } ${connectionPage}`;

const reactionSelection = `nodes { user { login } content createdAt } ${connectionPage}`;

const checkSelection = `nodes { ... on CheckRun { name status conclusion } } ${connectionPage}`;

const labelSelection = `nodes { name } ${connectionPage}`;

const dependencySelection = `nodes { number title state repository { nameWithOwner } } ${connectionPage}`;

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

const graphqlIssueNode = githubIssue.extend({ id: z.string() });

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

const graphqlReview = z.object({
	author: graphqlActor.optional(),
	commit: z.object({ oid: z.string() }).nullable().optional(),
	state: reviewStateGraphql,
});

const graphqlPullComment = z.object({
	author: graphqlActor.optional(),
	body: z.string().nullable().optional(),
	createdAt: z.string().optional(),
	reactions: z.object({ totalCount: z.number() }).optional(),
});

const graphqlReaction = z.object({
	user: graphqlActor.optional(),
	content: reactionContent,
	createdAt: z.string().optional(),
});

const graphqlCheck = z.object({
	name: z.string().optional(),
	status: checkStatus.optional(),
	conclusion: checkConclusion.nullable().optional(),
});

const fullIssueLists = z.object({
	id: z.string(),
	comments: graphqlConnection(graphqlComment),
});

const fullPullLists = z.object({
	id: z.string(),
	reviews: graphqlConnection(graphqlReview),
	comments: graphqlConnection(graphqlPullComment),
});

const livePullLists = z.object({
	id: z.string(),
	reactions: graphqlConnection(graphqlReaction),
	statusCheckRollup: z
		.object({ contexts: graphqlConnection(graphqlCheck) })
		.nullable(),
});

type PullLists = {
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

async function readAutoMerge(
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
async function postPollQuery(
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
function pollData(
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

async function readRepoPage(
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

function ticketFromGithubIssue(
	issue: z.infer<typeof githubIssue>,
	repo: string,
	comments: Comment[],
): Ticket {
	const closedAt = issue.closedAt?.trim() ?? "";
	const createdAt = issue.createdAt?.trim() ?? "";
	const state = issue.state.toLowerCase();
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
		key: githubKey(repo, issue.number),
		title: issue.title,
		state: state === "closed" ? "closed" : "open",
		stateReason: githubReason(issue.stateReason ?? null),
		updatedAt: issue.updatedAt,
		ref: githubKey(repo, issue.number),
		body: issue.body ?? "",
		blockedBy,
		...(blocking.length === 0 ? {} : { blocks: blocking }),
		...(comments.length === 0 ? {} : { comments }),
		milestone: issue.milestone?.title ?? null,
		...parentOf(issue.parent),
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
			const key = githubKey(repo, node.number);
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

function chunked<T>(items: T[], size: number): T[][] {
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
async function readLists(
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
function pendingPage<Node extends z.ZodType>(
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
async function readPages(
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

type IssueComments = z.infer<typeof fullIssueLists>["comments"];

/** The lists of each item as the poll last read them, keyed by ticket key. */
type StoredLists = {
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
async function currentBlockers(
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

async function readRepo(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	since: Date | null,
	stored: StoredLists,
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
			stored.issues.get(githubKey(repo, issue.number))?.updatedAt !==
				issue.updatedAt,
	);
	const readable = allPulls.filter((pull) => !pull.isDraft);
	const changedPulls = readable.filter((pull) => {
		const kept = stored.pulls.get(githubKey(repo, pull.number));
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
		const key = githubKey(repo, pull.number);
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
		const key = githubKey(repo, issue.number);
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

export function githubTracker(token: string, fetchImpl: Fetch): GithubTracker {
	const seenReviews = new Map<string, ReviewEvidence>();
	const storedLists: StoredLists = { issues: new Map(), pulls: new Map() };
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
	const repoSnapshots = new Map<string, ReturnType<typeof readRepo>>();
	const repoReadFor = (repo: string, since: Date | null) => {
		const cached = repoSnapshots.get(repo);
		if (cached !== undefined) {
			return cached;
		}
		const read = readRepo(token, fetchImpl, repo, since, storedLists).catch(
			(error: unknown) => {
				if (repoSnapshots.get(repo) === read) {
					repoSnapshots.delete(repo);
				}
				throw error;
			},
		);
		repoSnapshots.set(repo, read);
		return read;
	};
	return {
		beginPoll() {
			repoSnapshots.clear();
			autoMergeByRepo.clear();
		},
		findProjects() {
			return findGithubProjects(token, fetchImpl);
		},
		findPinnedProject(owner, number) {
			return githubProjectByNumber(token, fetchImpl, owner, number);
		},
		async listTickets(project, since, held = []) {
			const repo = project.key;
			if (project.ref.kind === "github-project") {
				projectItemsById.clear();
				const owner = project.ref.owner;
				const items = await projectItems(repo, owner);
				const openKeys = openLinkedKeys(items);
				const tickets = await listProjectTickets(
					token,
					fetchImpl,
					items,
					openKeys,
					owner,
				);
				const statuses = await listProjectStatuses(
					token,
					fetchImpl,
					repo,
					owner,
				);
				const board: Board = {
					kind: "github-project",
					laneKey: project.ref.key,
					statuses,
					factoryLabels: false,
				};
				return { name: repo, tickets, board };
			}
			const batched = await repoReadFor(repo, since);
			if (batched === null) {
				throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
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
		async listPulls(project) {
			const repo = project.key;
			if (project.ref.kind === "github-project") {
				const owner = project.ref.owner;
				return listProjectPulls(
					token,
					fetchImpl,
					await projectItems(repo, owner),
					seenReviews,
					owner,
				);
			}
			const batched = await repoReadFor(repo, null);
			if (batched === null) {
				throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
			}
			for (const pull of batched.pulls) {
				if (pull.merged) {
					seenReviews.set(githubKey(repo, pull.number), {
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
			const batched = await repoReadFor(repo, null);
			if (batched === null) {
				throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
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
