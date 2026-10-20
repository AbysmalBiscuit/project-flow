import { z } from "zod";
import type {
	Board,
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
import { linearStatusType } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	conditionalFetch,
	fetchHeadCommittedAt,
	githubHeaders,
	githubPull,
	mergedPullHistory,
	pullReview,
	type ReviewEvidence,
	TrackerError,
} from "./github.ts";
import type { FoundProject, Tracker } from "./ports.ts";

export const missingLinearKey =
	"LINEAR_API_KEY is missing: set LINEAR_API_KEY to list Linear projects.";

const endpoint = "https://api.linear.app/graphql";

const pageInfo = z.object({
	hasNextPage: z.boolean(),
	endCursor: z.string().nullable(),
});

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
	data: z.object({
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
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
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
			parent { identifier }
			projectMilestone { name }
			labels { nodes { name } }
			assignee { id name displayName }
			attachments {
				nodes { url title sourceType }
			}
			comments(first: 50) {
				nodes { id body createdAt user { name displayName } reactions { id } }
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
	data: z.object({
		projects: z.object({ nodes: z.array(linearProjectNode) }),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

type LinearProject = z.infer<typeof linearProjectNode>;

const openProjectStates = new Set(["backlog", "planned", "started"]);

const ticketProject = z.object({
	data: z.object({
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
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
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
	parent: z.object({ identifier: z.string() }).nullable().optional(),
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
	data: z.object({
		issues: z.object({
			nodes: z.array(issueNode),
			pageInfo,
		}),
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

export function linearHeaders(key: string): HeadersInit {
	return {
		authorization: key,
		"content-type": "application/json",
	};
}

export async function checkLinearKey(
	key: string,
	fetchImpl: Fetch,
): Promise<Response> {
	return fetchImpl(endpoint, {
		method: "POST",
		headers: linearHeaders(key),
		body: JSON.stringify({ query: "query { viewer { id } }" }),
	});
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

function blockedBy(node: z.infer<typeof issueNode>): TicketRef[] {
	return (node.inverseRelations?.nodes ?? []).flatMap((relation) => {
		if (relation.type !== "blocks" || relation.issue.state === null) {
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
	});
}

function linearAuthor(
	user:
		| {
				name?: string | null | undefined;
				displayName?: string | null | undefined;
		  }
		| null
		| undefined,
): string {
	return commentAuthor(user) ?? "";
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
		...(comments.length === 0 ? {} : { comments }),
		milestone: node.projectMilestone?.name ?? null,
		parent: node.parent?.identifier ?? null,
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
	const viewer = await checkLinearKey(key, fetchImpl);
	if (!viewer.ok) {
		throw new Error(`Linear find projects failed (HTTP ${viewer.status})`);
	}
	const viewerPage = z
		.object({
			data: z.object({ viewer: z.object({ id: z.string() }) }),
		})
		.parse(await viewer.json());
	const viewerId = viewerPage.data.viewer.id;
	const found: FoundProject[] = [];
	let after: string | null = null;
	do {
		const response = await fetchImpl(endpoint, {
			method: "POST",
			headers: linearHeaders(key),
			body: JSON.stringify({
				query: projectsQuery,
				variables: { viewer: viewerId, after },
			}),
		});
		if (!response.ok) {
			throw new Error(`Linear find projects failed (HTTP ${response.status})`);
		}
		const page = memberProjects.parse(await response.json());
		const error = page.errors?.[0];
		if (error !== undefined) {
			throw new Error(`Linear find projects failed: ${error.message}`);
		}
		for (const node of page.data.projects.nodes) {
			found.push({
				key: node.slugId,
				name: node.name,
				tracker: "linear",
				updatedAt: node.updatedAt,
			});
		}
		after = page.data.projects.pageInfo.hasNextPage
			? page.data.projects.pageInfo.endCursor
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
	const response = await fetchImpl(endpoint, {
		method: "POST",
		headers: linearHeaders(key),
		body: JSON.stringify({
			query: projectQuery,
			variables: { pin },
		}),
	});
	if (!response.ok) {
		throw new Error(
			`Linear project lookup failed (HTTP ${response.status}): ${pin}`,
		);
	}
	const page = projectPage.parse(await response.json());
	const error = page.errors?.[0];
	if (error !== undefined) {
		throw new Error(`Linear project lookup failed: ${error.message}`);
	}
	const match = page.data.projects.nodes.find((project) =>
		matchesPin(project.slugId, pin),
	);
	if (match === undefined) {
		throw new Error(`Linear project not found: ${pin}`);
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
	data: z.object({
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
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

async function listTeamStates(
	key: string,
	teamId: string,
	fetchImpl: Fetch,
): Promise<TicketStatus[]> {
	const response = await fetchImpl(endpoint, {
		method: "POST",
		headers: linearHeaders(key),
		body: JSON.stringify({
			query: teamStatesQuery,
			variables: { id: teamId },
		}),
	});
	if (!response.ok) {
		throw new Error(
			`Linear list team statuses failed (HTTP ${response.status}): ${teamId}`,
		);
	}
	const body = await response.json();
	const failed = linearError(body, "list team statuses");
	if (failed !== null) {
		throw new Error(failed);
	}
	const recorded = teamStates.safeParse(body);
	const team = recorded.success ? recorded.data.data.team : null;
	if (!recorded.success || team === null) {
		throw new Error(`Linear list team statuses failed: ${teamId}`);
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
	data: z.object({
		issue: z
			.object({
				comments: z.object({
					nodes: z.array(
						z.object({
							id: z.string().optional(),
							body: z.string().nullable(),
							createdAt: z.string().optional(),
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
	}),
	errors: z.array(z.object({ message: z.string() })).optional(),
});

const commentsQuery = `query IssueComments($id: String!, $after: String) {
	issue(id: $id) {
		comments(first: 50, after: $after) {
			nodes { id body createdAt user { name displayName } reactions { id } }
			pageInfo { hasNextPage endCursor }
		}
	}
}`;

type ListedComment = Comment;

function commentAuthor(
	user:
		| {
				name?: string | null | undefined;
				displayName?: string | null | undefined;
		  }
		| null
		| undefined,
): string | undefined {
	if (user?.displayName !== undefined && user.displayName !== null) {
		return user.displayName;
	}
	if (user?.name !== undefined && user.name !== null) {
		return user.name;
	}
	return undefined;
}

function listedComment(node: {
	id?: string | undefined;
	body?: string | null | undefined;
	createdAt?: string | undefined;
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
		const response = await fetchImpl(endpoint, {
			method: "POST",
			headers: linearHeaders(key),
			body: JSON.stringify({
				query: commentsQuery,
				variables: { id, after: cursor },
			}),
		});
		if (!response.ok) {
			throw new Error(
				`Linear list comments failed (HTTP ${response.status}): ${id}`,
			);
		}
		const page = commentPage.parse(await response.json());
		const error = page.errors?.[0];
		if (error !== undefined) {
			throw new Error(`Linear list comments failed: ${error.message}`);
		}
		const connection = page.data.issue?.comments;
		if (connection === undefined) {
			throw new Error(`Linear list comments failed: ${id}`);
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
	const pulls: PullRequest[] = [];
	if (githubToken === null) {
		return pulls;
	}
	for (const node of nodes) {
		const identifier = node.identifier;
		if (identifier === undefined) {
			continue;
		}
		for (const attachment of node.attachments?.nodes ?? []) {
			if (attachment.sourceType !== "github") {
				continue;
			}
			const target = pullFromUrl(attachment.url);
			if (target === null) {
				continue;
			}
			const loaded = pulls.find(
				(pull) => pull.repo === target.repo && pull.number === target.number,
			);
			if (loaded !== undefined) {
				if (!loaded.closingKeys.includes(identifier)) {
					loaded.closingKeys.push(identifier);
				}
				continue;
			}
			const pullResponse = await fetchGithub(
				`https://api.github.com/repos/${target.repo}/pulls/${target.number}`,
				{ headers: githubHeaders(githubToken) },
			);
			if (!pullResponse.ok) {
				continue;
			}
			const pull = githubPull.parse(await pullResponse.json());
			if (pull.state !== "open") {
				continue;
			}
			const head = pull.head.sha ?? "";
			const review =
				head === ""
					? { checks: [], comments: [], reviews: [], reactions: [] }
					: await pullReview(
							target.repo,
							pull.number,
							head,
							pull.draft === true,
							githubToken,
							fetchGithub,
						);
			const headCommittedAt =
				pull.draft === true || head === ""
					? null
					: await fetchHeadCommittedAt(
							target.repo,
							head,
							githubToken,
							fetchGithub,
						);
			pulls.push({
				repo: target.repo,
				number: pull.number,
				url: pull.html_url,
				title: pull.title,
				draft: pull.draft === true,
				branch: pull.head.ref,
				body: pull.body ?? "",
				closingKeys: [identifier],
				headSha: head,
				headCommittedAt,
				merged: false,
				autoMerge: pull.auto_merge != null,
				...review,
			});
		}
	}
	const repos = new Set(pulls.map((pull) => pull.repo));
	for (const node of nodes) {
		for (const attachment of node.attachments?.nodes ?? []) {
			const target = pullFromUrl(attachment.url);
			if (target !== null) {
				repos.add(target.repo);
			}
		}
	}
	for (const repo of repos) {
		pulls.push(
			...(await mergedPullHistory(repo, githubToken, fetchGithub, seenReviews)),
		);
	}
	return pulls;
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

function issueFilter(
	project: string,
	since: Date | null,
): { project: { id: { eq: string } }; updatedAt?: { gte: string } } {
	const filter = { project: { id: { eq: project } } };
	if (since === null) {
		return filter;
	}
	return { ...filter, updatedAt: { gte: since.toISOString() } };
}

async function issuePages(
	key: string,
	fetchImpl: Fetch,
	project: string,
	since: Date | null,
): Promise<ListedIssue[]> {
	const nodes: ListedIssue[] = [];
	let after: string | null = null;
	do {
		const response = await fetchImpl(endpoint, {
			method: "POST",
			headers: linearHeaders(key),
			body: JSON.stringify({
				query,
				variables: {
					filter: issueFilter(project, since),
					after,
				},
			}),
		});
		if (!response.ok) {
			throw new Error(
				`Linear list tickets failed (HTTP ${response.status}): ${project}`,
			);
		}
		const page = issuePage.parse(await response.json());
		const error = page.errors?.[0];
		if (error !== undefined) {
			throw new Error(`Linear list tickets failed: ${error.message}`);
		}
		nodes.push(...page.data.issues.nodes);
		after = page.data.issues.pageInfo.hasNextPage
			? page.data.issues.pageInfo.endCursor
			: null;
	} while (after !== null);
	return nodes;
}

export function linearTracker(
	key: string,
	fetchImpl: Fetch,
	githubToken: string | null = null,
): Tracker {
	const fetchGithub = conditionalFetch(fetchImpl, new Map());
	const issuesByProject = new Map<string, Promise<ListedIssue[]>>();
	const seenReviews = new Map<string, ReviewEvidence>();
	const issues = (project: string, since: Date | null) => {
		const cacheKey = `${project}\0${since?.toISOString() ?? ""}`;
		const cached = issuesByProject.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}
		const listed = issuePages(key, fetchImpl, project, since);
		issuesByProject.set(cacheKey, listed);
		void listed.catch(() => {
			if (issuesByProject.get(cacheKey) === listed) {
				issuesByProject.delete(cacheKey);
			}
		});
		return listed;
	};
	return {
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
				const response = await fetchImpl(endpoint, {
					method: "POST",
					headers: linearHeaders(key),
					body: JSON.stringify({
						query:
							"query TicketProject($id: String!) { issue(id: $id) { identifier project { id name slugId state } } }",
						variables: { id: ticketKey },
					}),
				});
				if (!response.ok) {
					continue;
				}
				const parsed = ticketProject.safeParse(await response.json());
				const project = parsed.success ? parsed.data.data.issue?.project : null;
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
		async listTickets(pin, since) {
			issuesByProject.clear();
			const project = await findLinearProject(key, pin, fetchImpl);
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
		async listPulls(pin, since = null) {
			const project = await findLinearProject(key, pin, fetchImpl);
			const nodes = await issues(project.id, since ?? null);
			return pullsForIssues(nodes, githubToken, fetchGithub, seenReviews);
		},
		async listBranches(_project) {
			return [];
		},
		fetchThread(project, ticketKey) {
			return fetchLinearThread(key, fetchImpl, project, ticketKey);
		},
		postReply(reply) {
			return postLinearReply(key, fetchImpl, reply);
		},
	};
}

const threadQuery = `query IssueThread($id: String!, $after: String) {
	issue(id: $id) {
		identifier
		title
		url
		comments(first: 50, after: $after) {
			nodes {
				id
				body
				createdAt
				url
				parent { id }
				user { name displayName }
			}
			pageInfo { hasNextPage endCursor }
		}
	}
}`;

const threadPage = z.object({
	data: z.object({
		issue: z.object({
			identifier: z.string(),
			title: z.string(),
			url: z.string(),
			comments: z.object({
				nodes: z.array(
					z.object({
						id: z.string(),
						body: z.string().nullable().optional(),
						createdAt: z.string().optional(),
						url: z.string().optional(),
						parent: z.object({ id: z.string() }).nullable().optional(),
						user: z
							.object({
								name: z.string().nullable().optional(),
								displayName: z.string().nullable().optional(),
							})
							.nullable()
							.optional(),
					}),
				),
				pageInfo,
			}),
		}),
	}),
});

const commentCreate = `mutation CommentCreate($input: CommentCreateInput!) {
	commentCreate(input: $input) {
		success
		comment { id body createdAt url }
	}
}`;

const createdComment = z.object({
	data: z.object({
		commentCreate: z.object({
			success: z.boolean(),
			comment: z
				.object({
					id: z.string(),
					body: z.string().nullable().optional(),
					createdAt: z.string(),
					url: z.string(),
				})
				.nullable(),
		}),
	}),
});

async function linearPost(
	key: string,
	fetchImpl: Fetch,
	queryText: string,
	variables: Record<string, unknown>,
	label: string,
): Promise<unknown> {
	const response = await fetchImpl(endpoint, {
		method: "POST",
		headers: linearHeaders(key),
		body: JSON.stringify({ query: queryText, variables }),
	});
	if (!response.ok) {
		throw new TrackerError(
			`Linear ${label} failed (HTTP ${response.status})`,
			response.status,
		);
	}
	return response.json();
}

const linearErrors = z.object({
	errors: z.array(z.object({ message: z.string() })).min(1),
});

function linearError(body: unknown, label: string): string | null {
	const parsed = linearErrors.safeParse(body);
	if (!parsed.success) {
		return null;
	}
	return `Linear ${label} failed: ${parsed.data.errors[0]?.message ?? "request failed"}`;
}

export async function fetchLinearThread(
	key: string,
	fetchImpl: Fetch,
	project: string,
	ticketKey: string,
): Promise<Thread | null> {
	const nodes: z.infer<
		typeof threadPage
	>["data"]["issue"]["comments"]["nodes"] = [];
	let issue: z.infer<typeof threadPage>["data"]["issue"] | null = null;
	let after: string | null = null;
	do {
		const body = await linearPost(
			key,
			fetchImpl,
			threadQuery,
			{ id: ticketKey, after },
			"fetch thread",
		);
		if (linearError(body, "fetch thread") !== null) {
			return null;
		}
		const page = threadPage.parse(body);
		issue = page.data.issue;
		nodes.push(...issue.comments.nodes);
		after = issue.comments.pageInfo.hasNextPage
			? issue.comments.pageInfo.endCursor
			: null;
	} while (after !== null);
	if (issue === null) {
		return null;
	}
	const comments: ThreadComment[] = nodes
		.map((comment) => ({
			id: comment.id,
			body: comment.body ?? "",
			author: linearAuthor(comment.user),
			createdAt: comment.createdAt ?? "",
			url: comment.url ?? "",
			parentId: comment.parent?.id ?? null,
			kind: "comment" as const,
			children: [],
		}))
		.sort((left, right) => {
			const leftTime = Date.parse(left.createdAt);
			const rightTime = Date.parse(right.createdAt);
			return (
				(Number.isNaN(leftTime) ? 0 : leftTime) -
				(Number.isNaN(rightTime) ? 0 : rightTime)
			);
		});
	return {
		tracker: "linear",
		project,
		key: issue.identifier,
		title: issue.title,
		url: issue.url,
		comments,
	};
}

export async function postLinearReply(
	key: string,
	fetchImpl: Fetch,
	reply: ReplyRequest,
): Promise<PostedReply> {
	const input = {
		issueId: reply.key,
		body: reply.body,
		...(reply.parentId === undefined ? {} : { parentId: reply.parentId }),
	};
	const body = await linearPost(
		key,
		fetchImpl,
		commentCreate,
		{ input },
		"reply",
	);
	const failed = linearError(body, "reply");
	if (failed !== null) {
		throw new TrackerError(failed, 502);
	}
	const page = createdComment.parse(body);
	const created = page.data.commentCreate.comment;
	if (!page.data.commentCreate.success || created === null) {
		throw new TrackerError("Linear reply failed", 502);
	}
	return {
		id: created.id,
		body: created.body ?? reply.body,
		url: created.url,
		createdAt: created.createdAt,
	};
}
