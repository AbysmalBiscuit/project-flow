import { z } from "zod";
import type { PullRequest, Ticket, TicketRef } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { FoundProject, Tracker } from "./ports.ts";

const dependency = z.object({
	number: z.number(),
	state: z.string(),
	repository_url: z.string().optional(),
});

const githubIssue = z.object({
	number: z.number(),
	title: z.string(),
	state: z.string(),
	state_reason: z.string().nullable(),
	updated_at: z.string(),
	body: z.string().nullable().optional(),
	issue_dependencies_summary: z
		.object({
			blocked_by: z.number(),
			total_blocked_by: z.number(),
		})
		.optional(),
	pull_request: z.unknown().optional(),
});

const githubPull = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	draft: z.boolean().optional(),
	body: z.string().nullable(),
	head: z.object({ ref: z.string() }),
	state: z.string(),
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
			nodes { id number title closed updatedAt owner { login } }
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
			nodes { id number title closed updatedAt owner { login } }
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
	const page = graphqlProjects.parse(await response.json());
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

async function findGithubProjects(
	token: string,
	fetchImpl: Fetch,
): Promise<FoundProject[]> {
	const found: FoundProject[] = [];
	const seen = new Set<string>();
	const orgs: string[] = [];
	let after: string | null = null;
	let orgAfter: string | null = null;
	let projectsDone = false;
	let orgsDone = false;
	do {
		const page = await graphqlPage(token, fetchImpl, projectsQuery, {
			after,
			orgAfter,
		});
		const viewer = page.data.viewer;
		if (viewer === undefined) {
			throw new Error("GitHub find projects failed");
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
	for (const login of orgs) {
		await addOrgProjects(token, fetchImpl, login, found, seen);
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
	return found;
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

const projectItemsQuery = `query ProjectItems($id: ID!, $after: String) {
	node(id: $id) {
		... on ProjectV2 {
			items(first: 50, after: $after) {
				nodes {
					content {
						__typename
						... on Issue { number title state stateReason updatedAt repository { nameWithOwner } }
					}
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const projectItems = z.object({
	data: z.object({
		node: z
			.object({
				items: z.object({
					nodes: z.array(
						z.object({
							content: z
								.object({
									__typename: z.string(),
									number: z.number().optional(),
									title: z.string().optional(),
									state: z.string().optional(),
									stateReason: z.string().nullable().optional(),
									updatedAt: z.string().optional(),
									repository: z
										.object({ nameWithOwner: z.string() })
										.optional(),
								})
								.nullable(),
						}),
					),
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

async function listProjectTickets(
	token: string,
	fetchImpl: Fetch,
	projectId: string,
): Promise<Ticket[]> {
	const tickets: Ticket[] = [];
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
			tickets.push({
				id: String(content.number),
				tracker: "github",
				key: `${content.repository.nameWithOwner}#${content.number}`,
				title: content.title ?? "",
				state,
				stateReason: githubReason(content.stateReason ?? null),
				updatedAt: content.updatedAt ?? "",
				ref: `${content.repository.nameWithOwner}#${content.number}`,
				body: "",
				blockedBy: [],
			});
		}
		after = page.data.node.items.pageInfo.hasNextPage
			? page.data.node.items.pageInfo.endCursor
			: null;
	} while (after !== null);
	return tickets;
}

export function githubTracker(token: string, fetchImpl: Fetch): Tracker {
	return {
		findProjects() {
			return findGithubProjects(token, fetchImpl);
		},
		async listTickets(repo, since) {
			if (!repo.includes("/")) {
				const tickets = await listProjectTickets(token, fetchImpl, repo);
				return { name: repo, tickets };
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
			for (const item of listed) {
				const page = githubIssuePage.parse(item);
				for (const issue of page) {
					if (issue.pull_request !== undefined) {
						continue;
					}
					if (issue.state !== "open" && issue.state !== "closed") {
						continue;
					}
					const summary = issue.issue_dependencies_summary;
					const blockedBy =
						summary !== undefined && summary.blocked_by > 0
							? await listBlockedBy(token, fetchImpl, repo, issue.number)
							: [];
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
					});
				}
			}
			return { name: repo, tickets };
		},
		async listPulls(repo) {
			if (!repo.includes("/")) {
				return [];
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
					pulls.push({
						number: pull.number,
						url: pull.html_url,
						title: pull.title,
						draft: pull.draft === true,
						branch: pull.head.ref,
						body,
						closingKeys: keys,
					});
				}
			}
			return pulls;
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
	};
}

async function listBlockedBy(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	number: number,
): Promise<TicketRef[]> {
	const url = `https://api.github.com/repos/${repo}/issues/${number}/dependencies/blocked_by`;
	const response = await fetchImpl(url, { headers: githubHeaders(token) });
	if (response.status === 404) {
		return [];
	}
	if (!response.ok) {
		throw new Error(
			`GitHub list blockers failed (HTTP ${response.status}): ${repo}#${number}`,
		);
	}
	const page = z.array(dependency).parse(await response.json());
	return page.flatMap((item) => {
		const state = nativeState(item.state);
		if (state === null) {
			return [];
		}
		const project = repoFromUrl(item.repository_url, repo);
		const ref: TicketRef = {
			tracker: "github",
			project,
			key: `${project}#${item.number}`,
		};
		if (state !== undefined) {
			ref.state = state;
		}
		return [ref];
	});
}
