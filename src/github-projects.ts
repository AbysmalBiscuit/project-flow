import { z } from "zod";

import type { Fetch } from "./fetch.ts";
import { githubGraphql, pageInfo } from "./github-graphql.ts";
import { githubHeaders, nextPage } from "./github-pages.ts";
import { type FoundProject, TrackerError, type Viewer } from "./ports.ts";

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
		... on User { projectV2(number: $number) { id number title closed updatedAt } }
		... on Organization { projectV2(number: $number) { id number title closed updatedAt } }
	}
}`;

const projectByNumber = z.object({
	repositoryOwner: z
		.object({
			projectV2: projectNode.nullable(),
		})
		.nullable(),
});

export async function githubProjectByNumber(
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
