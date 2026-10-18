import { z } from "zod";
import type { Ticket } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { Tracker } from "./ports.ts";

const endpoint = "https://api.linear.app/graphql";

const query = `query ProjectIssues($project: String!, $after: String) {
	issues(
		first: 50
		after: $after
		includeArchived: true
		filter: { project: { slugId: { eq: $project } } }
	) {
		nodes {
			state { type }
		}
		pageInfo {
			hasNextPage
			endCursor
		}
	}
}`;

const issueNode = z.object({
	state: z.object({ type: z.string() }).nullable(),
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

function toTicket(stateType: string): Ticket | null {
	if (stateType === "completed") {
		return { tracker: "linear", state: "closed", stateReason: null };
	}
	if (stateType === "canceled" || stateType === "duplicate") {
		return { tracker: "linear", state: "closed", stateReason: "not_planned" };
	}
	if (
		stateType === "backlog" ||
		stateType === "unstarted" ||
		stateType === "started" ||
		stateType === "triage"
	) {
		return { tracker: "linear", state: "open", stateReason: null };
	}
	return null;
}

export function linearTracker(key: string, fetchImpl: Fetch): Tracker {
	return {
		async listTickets(project) {
			const tickets: Ticket[] = [];
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
				for (const node of page.data.issues.nodes) {
					if (node.state === null) {
						continue;
					}
					const ticket = toTicket(node.state.type);
					if (ticket !== null) {
						tickets.push(ticket);
					}
				}
				after = page.data.issues.pageInfo.hasNextPage
					? page.data.issues.pageInfo.endCursor
					: null;
			} while (after !== null);
			return tickets;
		},
	};
}
