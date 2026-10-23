import { z } from "zod";
import type {
	Board,
	Comment,
	PullRequest,
	Ticket,
	TicketRef,
	TicketStatus,
} from "./domain.ts";
import { linearStatusType } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	conditionalFetch,
	loadLinkedPulls,
	type PullLink,
	type ReviewEvidence,
} from "./github.ts";
import { commentAuthor, linearGraphql, linearPageInfo } from "./linear-api.ts";
import { fetchLinearThread, postLinearReply } from "./linear-thread.ts";
import { type FoundProject, type Tracker, TrackerError } from "./ports.ts";

export const missingLinearKey =
	"LINEAR_API_KEY is missing: set LINEAR_API_KEY to list Linear projects.";

const pageInfo = linearPageInfo;

const projectsQuery = `query MemberProjects($viewer: ID!, $after: String) {
	projects(
		first: 50
		after: $after
		filter: {
			or: [
				{ lead: { id: { eq: $viewer } } }
				{ members: { some: { id: { eq: $viewer } } } }
			]
		}
	) {
		nodes { id name slugId updatedAt }
		pageInfo { hasNextPage endCursor }
	}
}`;

const memberProjects = z.object({
	projects: z.object({
		nodes: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				slugId: z.string(),
				updatedAt: z.string(),
			}),
		),
		pageInfo,
	}),
});

const projectQuery = `query ProjectByPin($pin: String!) {
	projects(first: 2, filter: {
		or: [
			{ slugId: { eq: $pin } }
			{ slugId: { endsWith: $pin } }
		]
	}) {
		nodes {
			id name slugId
			teams { nodes { id key name } }
		}
	}
}`;

const query = `query ProjectIssues($filter: IssueFilter!, $after: String) {
	issues(
		first: 50
		after: $after
		includeArchived: true
		filter: $filter
	) {
		nodes {
			identifier
			title
			description
			state { id name type color }
			updatedAt
			parent { identifier title url state { type name } project { name } }
			projectMilestone { name }
			labels { nodes { name } }
			assignee { id name displayName }
			attachments {
				nodes { url title sourceType }
			}
			comments(first: 50) {
				nodes { id body createdAt updatedAt user { name displayName } reactions { id } }
				pageInfo { hasNextPage endCursor }
			}
			history(first: 50) {
				nodes { createdAt toState { id } }
			}
			inverseRelations(first: 30) {
				nodes {
					type
					issue {
						identifier
						title
						state { type }
						project { name slugId }
					}
				}
			}
		}
		pageInfo {
			hasNextPage
			endCursor
		}
	}
}`;

const attachmentNode = z.object({
	url: z.string(),
	title: z.string(),
	sourceType: z.string().nullable(),
});

const linearTeamNode = z.object({
	id: z.string(),
	key: z.string(),
	name: z.string(),
});

const linearProjectNode = z.object({
	id: z.string(),
	name: z.string(),
	slugId: z.string(),
	teams: z.object({ nodes: z.array(linearTeamNode) }).optional(),
});

const projectPage = z.object({
	projects: z.object({ nodes: z.array(linearProjectNode) }),
});

type LinearProject = z.infer<typeof linearProjectNode>;

const openProjectStates = new Set(["backlog", "planned", "started"]);

const ticketProject = z.object({
	issue: z
		.object({
			identifier: z.string(),
			project: z
				.object({
					id: z.string(),
					name: z.string(),
					slugId: z.string(),
					state: z.string(),
				})
				.nullable(),
		})
		.nullable(),
});

const relatedIssue = z.object({
	identifier: z.string(),
	title: z.string().nullable().optional(),
	state: z.object({ type: z.string() }).nullable(),
	project: z
		.object({
			name: z.string().optional(),
			slugId: z.string(),
		})
		.nullable(),
});

const issueNode = z.object({
	identifier: z.string().optional(),
	title: z.string().optional(),
	description: z.string().nullable().optional(),
	updatedAt: z.string(),
	state: z
		.object({
			id: z.string().optional(),
			name: z.string().optional(),
			type: z.string(),
			color: z.string().optional(),
		})
		.nullable(),
	parent: z
		.object({
			identifier: z.string(),
			title: z.string().optional(),
			url: z.string().optional(),
			state: z
				.object({ type: z.string(), name: z.string().optional() })
				.nullable()
				.optional(),
			project: z.object({ name: z.string() }).nullable().optional(),
		})
		.nullable()
		.optional(),
	projectMilestone: z.object({ name: z.string() }).nullable().optional(),
	labels: z
		.object({ nodes: z.array(z.object({ name: z.string() })) })
		.optional(),
	assignee: z
		.object({
			id: z.string().optional(),
			name: z.string().nullable().optional(),
			displayName: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
	attachments: z.object({ nodes: z.array(attachmentNode) }).optional(),
	comments: z
		.object({
			nodes: z.array(
				z.object({
					id: z.string().optional(),
					body: z.string().nullable().optional(),
					createdAt: z.string().optional(),
					updatedAt: z.string().optional(),
					user: z
						.object({
							name: z.string().nullable().optional(),
							displayName: z.string().nullable().optional(),
						})
						.nullable()
						.optional(),
					reactions: z.array(z.object({ id: z.string() })).optional(),
				}),
			),
			pageInfo: pageInfo.optional(),
		})
		.optional(),
	history: z
		.object({
			nodes: z.array(
				z.object({
					createdAt: z.string(),
					toState: z.object({ id: z.string() }).nullable(),
				}),
			),
		})
		.optional(),
	inverseRelations: z
		.object({
			nodes: z.array(
				z.object({
					type: z.string(),
					issue: relatedIssue,
				}),
			),
		})
		.nullish()
		.transform((relations) => relations ?? { nodes: [] }),
});

const issuePage = z.object({
	issues: z.object({
		nodes: z.array(issueNode),
		pageInfo,
	}),
});

const viewerQuery = "query { viewer { id } }";

/** Send the viewer query with this key, and throw the tracker error when Linear refuses it. */
export async function checkLinearKey(
	key: string,
	fetchImpl: Fetch,
): Promise<void> {
	await linearGraphql(
		{ key, fetchImpl },
		{
			query: viewerQuery,
			variables: {},
			data: z.unknown(),
			label: "key check",
		},
	);
}

function toState(
	stateType: string,
): { state: Ticket["state"]; stateReason: string | null } | null {
	if (stateType === "completed") {
		return { state: "closed", stateReason: null };
	}
	if (stateType === "canceled" || stateType === "duplicate") {
		return { state: "closed", stateReason: "not_planned" };
	}
	if (
		stateType === "backlog" ||
		stateType === "unstarted" ||
		stateType === "started" ||
		stateType === "triage"
	) {
		return { state: "open", stateReason: null };
	}
	return null;
}

function relationRef(
	relation: NonNullable<
		z.infer<typeof issueNode>["inverseRelations"]
	>["nodes"][number],
): TicketRef[] {
	if (relation.issue.state === null) {
		return [];
	}
	const mapped = toState(relation.issue.state.type);
	if (mapped === null) {
		return [];
	}
	const title = relation.issue.title?.trim() ?? "";
	const projectName = relation.issue.project?.name?.trim() ?? "";
	const ref: TicketRef = {
		tracker: "linear",
		project: relation.issue.project?.slugId ?? "",
		key: relation.issue.identifier,
		state: mapped.state,
		...(title === "" ? {} : { title }),
		...(projectName === "" ? {} : { projectName }),
	};
	return [ref];
}

function blockedBy(node: z.infer<typeof issueNode>): TicketRef[] {
	return (node.inverseRelations?.nodes ?? []).flatMap((relation) => {
		if (relation.type !== "blocks") {
			return [];
		}
		return relationRef(relation);
	});
}

function blocking(node: z.infer<typeof issueNode>): TicketRef[] {
	return (node.inverseRelations?.nodes ?? []).flatMap((relation) => {
		if (relation.type !== "blockedBy" && relation.type !== "blocked") {
			return [];
		}
		return relationRef(relation);
	});
}

function parentDetailsOf(
	parent: z.infer<typeof issueNode>["parent"],
): Pick<Ticket, "parentDetails"> {
	const state = parent?.state;
	if (
		parent === null ||
		parent === undefined ||
		parent.title === undefined ||
		parent.url === undefined ||
		state === null ||
		state === undefined ||
		toState(state.type) === null
	) {
		return {};
	}
	return {
		parentDetails: {
			title: parent.title,
			state: linearStatusType(state.type, state.name ?? ""),
			project: parent.project?.name ?? "",
			url: parent.url,
		},
	};
}

function toTicket(node: z.infer<typeof issueNode>): Ticket | null {
	if (node.state === null || node.identifier === undefined) {
		return null;
	}
	const mapped = toState(node.state.type);
	if (mapped === null) {
		return null;
	}
	const history = (node.history?.nodes ?? []).flatMap((change) =>
		change.toState === null
			? []
			: [{ statusId: change.toState.id, at: change.createdAt }],
	);
	const comments = (node.comments?.nodes ?? []).flatMap((comment) => {
		const listed = listedComment(comment);
		return listed === null ? [] : [listed];
	});
	const assignee = node.assignee?.id ?? null;
	const statusName = node.state.name ?? "";
	const status =
		node.state.id === undefined || statusName === ""
			? undefined
			: {
					id: node.state.id,
					name: statusName,
					statusType: linearStatusType(node.state.type, statusName),
					colour: node.state.color ?? "",
				};
	return {
		id: node.identifier,
		tracker: "linear",
		key: node.identifier,
		title: node.title ?? "",
		state: mapped.state,
		stateReason: mapped.stateReason,
		updatedAt: node.updatedAt,
		body: node.description ?? "",
		blockedBy: blockedBy(node),
		...(blocking(node).length === 0 ? {} : { blocks: blocking(node) }),
		...(comments.length === 0 ? {} : { comments }),
		milestone: node.projectMilestone?.name ?? null,
		parent: node.parent?.identifier ?? null,
		...parentDetailsOf(node.parent),
		labels: (node.labels?.nodes ?? []).map((label) => label.name),
		...(node.assignee === undefined ? {} : { assignee }),
		...(status === undefined ? {} : { status }),
		...(history.length === 0 ? {} : { history }),
	};
}

async function findLinearProjects(
	key: string,
	fetchImpl: Fetch,
): Promise<{ projects: FoundProject[]; viewerId: string }> {
	const connection = { key, fetchImpl };
	const viewerPage = await linearGraphql(connection, {
		query: viewerQuery,
		variables: {},
		data: z.object({ viewer: z.object({ id: z.string() }) }),
		label: "find projects",
	});
	const viewerId = viewerPage.viewer.id;
	const found: FoundProject[] = [];
	let after: string | null = null;
	do {
		const page: z.infer<typeof memberProjects> = await linearGraphql(
			connection,
			{
				query: projectsQuery,
				variables: { viewer: viewerId, after },
				data: memberProjects,
				label: "find projects",
			},
		);
		for (const node of page.projects.nodes) {
			found.push({
				key: node.slugId,
				name: node.name,
				tracker: "linear",
				updatedAt: node.updatedAt,
			});
		}
		after = page.projects.pageInfo.hasNextPage
			? page.projects.pageInfo.endCursor
			: null;
	} while (after !== null);
	return { projects: found, viewerId };
}

function matchesPin(slugId: string, pin: string): boolean {
	return slugId === pin || slugId.endsWith(`-${pin}`);
}

async function findLinearProject(
	key: string,
	pin: string,
	fetchImpl: Fetch,
): Promise<LinearProject> {
	const page = await linearGraphql(
		{ key, fetchImpl },
		{
			query: projectQuery,
			variables: { pin },
			data: projectPage,
			label: "project lookup",
			subject: pin,
		},
	);
	const match = page.projects.nodes.find((project) =>
		matchesPin(project.slugId, pin),
	);
	if (match === undefined) {
		throw new TrackerError(`Linear project not found: ${pin}`, 404);
	}
	return match;
}

const teamStatesQuery = `query TeamStates($id: String!) {
	team(id: $id) {
		states {
			nodes { id name type position color }
		}
	}
}`;

const teamStates = z.object({
	team: z
		.object({
			states: z.object({
				nodes: z.array(
					z.object({
						id: z.string(),
						name: z.string(),
						type: z.string(),
						position: z.number(),
						color: z.string(),
					}),
				),
			}),
		})
		.nullable(),
});

async function listTeamStates(
	key: string,
	teamId: string,
	fetchImpl: Fetch,
): Promise<TicketStatus[]> {
	const { team } = await linearGraphql(
		{ key, fetchImpl },
		{
			query: teamStatesQuery,
			variables: { id: teamId },
			data: teamStates,
			label: "list team statuses",
			subject: teamId,
		},
	);
	if (team === null) {
		throw new TrackerError(`Linear list team statuses failed: ${teamId}`, 502);
	}
	const nodes = team.states.nodes;
	return [...nodes]
		.sort((left, right) => left.position - right.position)
		.map((node) => ({
			id: node.id,
			name: node.name,
			statusType: linearStatusType(node.type, node.name),
			colour: node.color,
		}));
}

function linearBoard(
	team: { key: string } | undefined,
	statuses: TicketStatus[],
): Board {
	return {
		kind: "linear",
		...(team === undefined ? {} : { laneKey: team.key }),
		statuses,
		factoryLabels: false,
	};
}

const commentPage = z.object({
	issue: z
		.object({
			comments: z.object({
				nodes: z.array(
					z.object({
						id: z.string().optional(),
						body: z.string().nullable(),
						createdAt: z.string().optional(),
						updatedAt: z.string().optional(),
						user: z
							.object({
								name: z.string().nullable().optional(),
								displayName: z.string().nullable().optional(),
							})
							.nullable()
							.optional(),
						reactions: z.array(z.object({ id: z.string() })).optional(),
					}),
				),
				pageInfo,
			}),
		})
		.nullable(),
});

const commentsQuery = `query IssueComments($id: String!, $after: String) {
	issue(id: $id) {
		comments(first: 50, after: $after) {
			nodes { id body createdAt updatedAt user { name displayName } reactions { id } }
			pageInfo { hasNextPage endCursor }
		}
	}
}`;

type ListedComment = Comment;

function listedComment(node: {
	id?: string | undefined;
	body?: string | null | undefined;
	createdAt?: string | undefined;
	updatedAt?: string | undefined;
	user?:
		| {
				name?: string | null | undefined;
				displayName?: string | null | undefined;
		  }
		| null
		| undefined;
	reactions?: { id: string }[] | undefined;
}): ListedComment | null {
	const body = node.body ?? "";
	if (body === "") {
		return null;
	}
	const author = commentAuthor(node.user);
	return {
		body,
		...(node.id === undefined ? {} : { id: node.id }),
		...(node.createdAt === undefined ? {} : { createdAt: node.createdAt }),
		...(node.updatedAt === undefined ? {} : { updatedAt: node.updatedAt }),
		...(author === undefined ? {} : { author }),
		...(node.reactions === undefined
			? {}
			: { reactions: node.reactions.length }),
	};
}

function byCreatedAt(left: ListedComment, right: ListedComment): number {
	const leftTime =
		left.createdAt === undefined ? 0 : Date.parse(left.createdAt);
	const rightTime =
		right.createdAt === undefined ? 0 : Date.parse(right.createdAt);
	return (
		(Number.isNaN(leftTime) ? 0 : leftTime) -
		(Number.isNaN(rightTime) ? 0 : rightTime)
	);
}

async function commentPages(
	key: string,
	fetchImpl: Fetch,
	id: string,
	after: string | null,
): Promise<ListedComment[]> {
	const comments: ListedComment[] = [];
	let cursor = after;
	do {
		const page: z.infer<typeof commentPage> = await linearGraphql(
			{ key, fetchImpl },
			{
				query: commentsQuery,
				variables: { id, after: cursor },
				data: commentPage,
				label: "list comments",
				subject: id,
			},
		);
		const connection = page.issue?.comments;
		if (connection === undefined) {
			throw new TrackerError(`Linear list comments failed: ${id}`, 502);
		}
		for (const node of connection.nodes) {
			const comment = listedComment(node);
			if (comment !== null) {
				comments.push(comment);
			}
		}
		cursor = connection.pageInfo.hasNextPage
			? connection.pageInfo.endCursor
			: null;
	} while (cursor !== null);
	return comments;
}

async function pullsForIssues(
	nodes: z.infer<typeof issueNode>[],
	githubToken: string | null,
	fetchGithub: Fetch,
	seenReviews: Map<string, ReviewEvidence>,
): Promise<PullRequest[]> {
	if (githubToken === null) {
		return [];
	}
	const links: PullLink[] = [];
	const repos: string[] = [];
	for (const node of nodes) {
		for (const attachment of node.attachments?.nodes ?? []) {
			const target = pullFromUrl(attachment.url);
			if (target === null) {
				continue;
			}
			repos.push(target.repo);
			if (attachment.sourceType === "github" && node.identifier !== undefined) {
				links.push({ ...target, ticketKey: node.identifier });
			}
		}
	}
	return loadLinkedPulls(githubToken, fetchGithub, links, repos, seenReviews);
}

function pullFromUrl(url: string): { repo: string; number: number } | null {
	const match = url.match(
		/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/,
	);
	const repo = match?.[1];
	const number = match?.[2];
	if (repo === undefined || number === undefined) {
		return null;
	}
	return { repo, number: Number(number) };
}

type ListedIssue = z.infer<typeof issueNode>;

type IssueListFilter = {
	project: { id: { eq: string } };
	or?: (
		| { updatedAt: { gte: string } }
		| { comments: { updatedAt: { gte: string } } }
	)[];
};

function issueFilter(project: string, since: Date | null): IssueListFilter {
	const filter: IssueListFilter = { project: { id: { eq: project } } };
	if (since === null) {
		return filter;
	}
	const gte = since.toISOString();
	return {
		...filter,
		or: [{ updatedAt: { gte } }, { comments: { updatedAt: { gte } } }],
	};
}

async function issuePages(
	key: string,
	fetchImpl: Fetch,
	project: string,
	filter: IssueListFilter,
): Promise<ListedIssue[]> {
	const nodes: ListedIssue[] = [];
	let after: string | null = null;
	do {
		const page: z.infer<typeof issuePage> = await linearGraphql(
			{ key, fetchImpl },
			{
				query,
				variables: { filter, after },
				data: issuePage,
				label: "list tickets",
				subject: project,
			},
		);
		nodes.push(...page.issues.nodes);
		after = page.issues.pageInfo.hasNextPage
			? page.issues.pageInfo.endCursor
			: null;
	} while (after !== null);
	return nodes;
}

export function linearTracker(
	key: string,
	fetchImpl: Fetch,
	githubToken: string | null = null,
	fetchGithub: Fetch = conditionalFetch(fetchImpl),
): Tracker {
	const issuesByProject = new Map<string, Promise<ListedIssue[]>>();
	const seenReviews = new Map<string, ReviewEvidence>();
	let issueGeneration = 0;
	const issues = (project: string, since: Date | null) => {
		const cacheKey = `${issueGeneration}\0${project}\0${since?.toISOString() ?? ""}`;
		const cached = issuesByProject.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}
		const listed = issuePages(
			key,
			fetchImpl,
			project,
			issueFilter(project, since),
		);
		issuesByProject.set(cacheKey, listed);
		void listed.catch(() => {
			if (issuesByProject.get(cacheKey) === listed) {
				issuesByProject.delete(cacheKey);
			}
		});
		return listed;
	};
	return {
		beginPoll() {
			issueGeneration += 1;
		},
		findProjects() {
			return findLinearProjects(key, fetchImpl).then((found) => ({
				projects: found.projects,
				viewer:
					found.viewerId === ""
						? null
						: { login: "", orgs: [], id: found.viewerId },
			}));
		},
		async projectsForKeys(keys) {
			const found: FoundProject[] = [];
			for (const ticketKey of keys) {
				const read = await linearGraphql(
					{ key, fetchImpl },
					{
						query:
							"query TicketProject($id: String!) { issue(id: $id) { identifier project { id name slugId state } } }",
						variables: { id: ticketKey },
						data: ticketProject,
						label: "project lookup",
						subject: ticketKey,
					},
				).catch((error: unknown) => {
					if (error instanceof TrackerError) {
						return null;
					}
					throw error;
				});
				const project = read?.issue?.project;
				if (
					project === null ||
					project === undefined ||
					!openProjectStates.has(project.state) ||
					found.some((item) => item.key === project.slugId)
				) {
					continue;
				}
				found.push({
					key: project.slugId,
					name: project.name,
					tracker: "linear",
					updatedAt: null,
				});
			}
			return found;
		},
		async listTickets(tracked, since) {
			issuesByProject.clear();
			const project = await findLinearProject(key, tracked.key, fetchImpl);
			const team = project.teams?.nodes[0];
			const statuses =
				team === undefined ? [] : await listTeamStates(key, team.id, fetchImpl);
			const board = linearBoard(team, statuses);
			const nodes = await issues(project.id, since);
			const openKeys = new Set(
				nodes.flatMap((node) =>
					node.identifier !== undefined &&
					(node.attachments?.nodes ?? []).some(
						(attachment) =>
							attachment.sourceType === "github" &&
							pullFromUrl(attachment.url) !== null,
					)
						? [node.identifier]
						: [],
				),
			);
			const tickets: Ticket[] = [];
			for (const node of nodes) {
				const ticket = toTicket(node);
				if (ticket === null) {
					continue;
				}
				if (
					ticket.key !== null &&
					openKeys.has(ticket.key) &&
					node.comments?.pageInfo?.hasNextPage === true
				) {
					ticket.comments = [
						...(ticket.comments ?? []),
						...(await commentPages(
							key,
							fetchImpl,
							node.identifier ?? ticket.key,
							node.comments.pageInfo.endCursor,
						)),
					];
				}
				if (ticket.comments !== undefined) {
					ticket.comments = [...ticket.comments].sort(byCreatedAt);
				}
				tickets.push(ticket);
			}
			return {
				name: project.name,
				tickets,
				board,
			};
		},
		async listPulls(tracked, since = null) {
			const project = await findLinearProject(key, tracked.key, fetchImpl);
			const nodes = await issues(project.id, since ?? null);
			return pullsForIssues(nodes, githubToken, fetchGithub, seenReviews);
		},
		fetchThread(project, ticketKey, signal) {
			return fetchLinearThread(key, fetchImpl, project, ticketKey, signal);
		},
		postReply(reply) {
			return postLinearReply(key, fetchImpl, reply);
		},
	};
}
