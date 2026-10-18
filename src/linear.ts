import { z } from "zod";
import type { PullRequest, Ticket } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { Tracker } from "./ports.ts";

export const missingLinearKey =
	"LINEAR_API_KEY is missing: set LINEAR_API_KEY to list Linear projects.";

const endpoint = "https://api.linear.app/graphql";

const query = `query ProjectIssues($project: String!, $after: String) {
	issues(
		first: 50
		after: $after
		includeArchived: true
		filter: { project: { slugId: { eq: $project } } }
	) {
		nodes {
			identifier
			state { type }
			attachments {
				nodes { url title sourceType }
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

const issueNode = z.object({
	identifier: z.string().optional(),
	state: z.object({ type: z.string() }).nullable(),
	attachments: z.object({ nodes: z.array(attachmentNode) }).optional(),
});

const issuePage = z.object({
	data: z.object({
		issues: z.object({
			nodes: z.array(issueNode),
			pageInfo: z.object({
				hasNextPage: z.boolean(),
				endCursor: z.string().nullable(),
			}),
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

function toTicket(stateType: string, key: string | null): Ticket | null {
	if (stateType === "completed") {
		return { tracker: "linear", key, state: "closed", stateReason: null };
	}
	if (stateType === "canceled" || stateType === "duplicate") {
		return {
			tracker: "linear",
			key,
			state: "closed",
			stateReason: "not_planned",
		};
	}
	if (
		stateType === "backlog" ||
		stateType === "unstarted" ||
		stateType === "started" ||
		stateType === "triage"
	) {
		return { tracker: "linear", key, state: "open", stateReason: null };
	}
	return null;
}

const githubPull = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	draft: z.boolean().optional(),
	body: z.string().nullable(),
	head: z.object({ ref: z.string() }),
	state: z.string(),
});

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

async function issuePages(
	key: string,
	fetchImpl: Fetch,
	project: string,
): Promise<ListedIssue[]> {
	const nodes: ListedIssue[] = [];
	let after: string | null = null;
	do {
		const response = await fetchImpl(endpoint, {
			method: "POST",
			headers: linearHeaders(key),
			body: JSON.stringify({
				query,
				variables: { project, after },
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
	const issues = (project: string) => {
		const cached = issuesByProject.get(project);
		if (cached !== undefined) {
			return cached;
		}
		const listed = issuePages(key, fetchImpl, project);
		issuesByProject.set(project, listed);
		return listed;
	};
	return {
		async listTickets(project) {
			const tickets: Ticket[] = [];
			for (const node of await issues(project)) {
				if (node.state === null) {
					continue;
				}
				const ticket = toTicket(node.state.type, node.identifier ?? null);
				if (ticket !== null) {
					tickets.push(ticket);
				}
			}
			return tickets;
		},
		async listPulls(project) {
			const pulls: PullRequest[] = [];
			if (githubToken === null) {
				return pulls;
			}
			for (const node of await issues(project)) {
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
						{
							headers: {
								accept: "application/vnd.github+json",
								authorization: `Bearer ${githubToken}`,
								"x-github-api-version": "2022-11-28",
							},
						},
					);
					if (!pullResponse.ok) {
						continue;
					}
					const pull = githubPull.parse(await pullResponse.json());
					if (pull.state !== "open") {
						continue;
					}
					const keys = [identifier];
					pulls.push({
						number: pull.number,
						url: pull.html_url,
						title: pull.title,
						draft: pull.draft === true,
						branch: pull.head.ref,
						body: pull.body ?? "",
						closingKeys: keys,
					});
				}
			}
			return pulls;
		},
		async listBranches(_project) {
			return [];
		},
	};
}
