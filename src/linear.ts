import { z } from "zod";
import type { PullRequest, Ticket, TicketRef } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	githubHeaders,
	githubPull,
	mergedPullHistory,
	pullReview,
	type ReviewEvidence,
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
		nodes { id name slugId }
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
			state { type }
			updatedAt
			parent { identifier }
			projectMilestone { name }
			labels { nodes { name } }
			attachments {
				nodes { url title sourceType }
			}
			inverseRelations(first: 30) {
				nodes {
					type
					issue {
						identifier
						state { type }
						project { slugId }
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

const linearProjectNode = z.object({
	id: z.string(),
	name: z.string(),
	slugId: z.string(),
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
	state: z.object({ type: z.string() }).nullable(),
	project: z.object({ slugId: z.string() }).nullable(),
});

const issueNode = z.object({
	identifier: z.string().optional(),
	title: z.string().optional(),
	description: z.string().nullable().optional(),
	updatedAt: z.string(),
	state: z.object({ type: z.string() }).nullable(),
	parent: z.object({ identifier: z.string() }).nullable().optional(),
	projectMilestone: z.object({ name: z.string() }).nullable().optional(),
	labels: z
		.object({ nodes: z.array(z.object({ name: z.string() })) })
		.optional(),
	attachments: z.object({ nodes: z.array(attachmentNode) }).optional(),
	inverseRelations: z
		.object({
			nodes: z.array(
				z.object({
					type: z.string(),
					issue: relatedIssue,
				}),
			),
		})
		.optional(),
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
		const ref: TicketRef = {
			tracker: "linear",
			project: relation.issue.project?.slugId ?? "",
			key: relation.issue.identifier,
			state: mapped.state,
		};
		return [ref];
	});
}

function toTicket(node: z.infer<typeof issueNode>): Ticket | null {
	if (node.state === null || node.identifier === undefined) {
		return null;
	}
	const mapped = toState(node.state.type);
	if (mapped === null) {
		return null;
	}
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
		milestone: node.projectMilestone?.name ?? null,
		parent: node.parent?.identifier ?? null,
		labels: (node.labels?.nodes ?? []).map((label) => label.name),
	};
}

async function findLinearProjects(
	key: string,
	fetchImpl: Fetch,
): Promise<FoundProject[]> {
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
	return found;
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
			return findLinearProjects(key, fetchImpl).then((projects) => ({
				projects,
				viewer: null,
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
			const tickets: Ticket[] = [];
			for (const node of await issues(project.id, since)) {
				const ticket = toTicket(node);
				if (ticket !== null) {
					tickets.push(ticket);
				}
			}
			return { name: project.name, tickets };
		},
		async listPulls(pin, since = null) {
			const project = await findLinearProject(key, pin, fetchImpl);
			const nodes = await issues(project.id, since ?? null);
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
					const pullResponse = await fetchImpl(
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
					const review = await pullReview(
						target.repo,
						pull.number,
						pull.head.sha,
						githubToken,
						fetchImpl,
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
						headSha: pull.head.sha,
						merged: false,
						...review,
					});
				}
			}
			const repos = [...new Set(pulls.map((pull) => pull.repo))];
			for (const repo of repos) {
				pulls.push(
					...(await mergedPullHistory(
						repo,
						githubToken,
						fetchImpl,
						seenReviews,
					)),
				);
			}
			return pulls;
		},
		async listBranches(_project) {
			return [];
		},
	};
}
