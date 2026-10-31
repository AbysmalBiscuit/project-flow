import { z } from "zod";

import type { Ticket, TicketRef } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	failedResponse,
	graphqlData,
	type GraphqlQuery,
	responseBody,
} from "./graphql.ts";
import { type FoundProject, type Tracker, TrackerError } from "./ports.ts";
import { numberedKey } from "./ticket-key.ts";

/**
 * The work items of one state of a GitLab project. A read lists every open work
 * item and the newest page of closed ones, with each widget that the tracker reads.
 */
export const workItemsQuery = `query ProjectWorkItems($path: ID!, $state: IssuableState!, $sort: WorkItemSort!, $after: String) {
	project(fullPath: $path) {
		workItems(state: $state, sort: $sort, first: 100, after: $after) {
			pageInfo { hasNextPage endCursor }
			nodes {
				iid title state webUrl description createdAt updatedAt closedAt
				widgets {
					... on WorkItemWidgetHierarchy { parent { iid title state webUrl namespace { fullPath } } }
					... on WorkItemWidgetMilestone { milestone { title } }
					... on WorkItemWidgetLabels { labels { nodes { title } } }
					... on WorkItemWidgetAssignees { assignees { nodes { username } } }
					... on WorkItemWidgetLinkedItems { linkedItems { nodes { linkType workItem { iid title state namespace { fullPath } } } } }
				}
			}
		}
	}
}`;

const linkedWorkItem = z.object({
	iid: z.string(),
	title: z.string(),
	state: z.string(),
	namespace: z.object({ fullPath: z.string() }),
});

const widget = z.object({
	parent: linkedWorkItem.extend({ webUrl: z.string() }).nullish(),
	milestone: z.object({ title: z.string() }).nullish(),
	labels: z
		.object({ nodes: z.array(z.object({ title: z.string() })) })
		.nullish(),
	assignees: z
		.object({ nodes: z.array(z.object({ username: z.string() })) })
		.nullish(),
	linkedItems: z
		.object({
			nodes: z.array(
				z.object({ linkType: z.string(), workItem: linkedWorkItem }),
			),
		})
		.nullish(),
});

const workItem = z.object({
	iid: z.string(),
	title: z.string(),
	state: z.string(),
	webUrl: z.string(),
	description: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	closedAt: z.string().nullable(),
	widgets: z.array(widget),
});

type WorkItem = z.infer<typeof workItem>;

const workItemsPage = z.object({
	project: z
		.object({
			workItems: z.object({
				pageInfo: z.object({
					hasNextPage: z.boolean(),
					endCursor: z.string().nullable(),
				}),
				nodes: z.array(workItem),
			}),
		})
		.nullable(),
});

const listedProject = z.object({
	path_with_namespace: z.string(),
	last_activity_at: z.string().nullable(),
	archived: z.boolean().optional(),
});

const user = z.object({ username: z.string() });

function ticketState(state: string): "open" | "closed" {
	return state === "CLOSED" ? "closed" : "open";
}

function linkedRef(item: z.infer<typeof linkedWorkItem>): TicketRef {
	const project = item.namespace.fullPath;
	return {
		tracker: "gitlab",
		project,
		key: numberedKey(project, item.iid),
		state: ticketState(item.state),
		title: item.title,
	};
}

/** The ticket of one work item. GitLab names a blocker link from either end, so each end reads it. */
function ticketOf(project: string, item: WorkItem): Ticket {
	const read: z.infer<typeof widget> = {};
	for (const next of item.widgets) {
		Object.assign(read, next);
	}
	const links = read.linkedItems?.nodes ?? [];
	const linked = (type: string) =>
		links
			.filter((link) => link.linkType === type)
			.map((link) => linkedRef(link.workItem));
	const assignees = (read.assignees?.nodes ?? []).map(
		(person) => person.username,
	);
	const parent = read.parent;
	const parentProject = parent?.namespace.fullPath;
	return {
		id: item.iid,
		tracker: "gitlab",
		key: numberedKey(project, item.iid),
		title: item.title,
		url: item.webUrl,
		state: ticketState(item.state),
		stateReason: null,
		updatedAt: item.updatedAt,
		createdAt: item.createdAt,
		...(item.closedAt === null ? {} : { closedAt: item.closedAt }),
		body: item.description ?? "",
		blockedBy: linked("is_blocked_by"),
		blocks: linked("blocks"),
		milestone: read.milestone?.title ?? null,
		labels: (read.labels?.nodes ?? []).map((label) => label.title),
		...(assignees.length === 0
			? {}
			: { assignee: assignees[0] ?? null, assignees }),
		...(parent === null || parent === undefined || parentProject === undefined
			? { parent: null }
			: {
					parent: numberedKey(parentProject, parent.iid),
					parentDetails: {
						title: parent.title,
						...(ticketState(parent.state) === "open"
							? {}
							: { state: "done" as const }),
						project: parentProject,
						url: parent.webUrl,
					},
				}),
	};
}

/** The tracker of the issues and tasks of the repos on one GitLab host. A project is one repo. */
export function gitlabTracker(
	host: string,
	token: string,
	fetchImpl: Fetch,
): Tracker {
	const headers = { authorization: `Bearer ${token}` };

	const graphql = async <Data extends z.ZodType>(
		request: GraphqlQuery & { data: Data },
	): Promise<z.output<Data>> => {
		const response = await fetchImpl(`https://${host}/api/graphql`, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body: JSON.stringify({
				query: request.query,
				variables: request.variables,
			}),
		});
		if (!response.ok) {
			throw failedResponse("GitLab", request, response);
		}
		return graphqlData(
			"GitLab",
			request,
			await responseBody("GitLab", request, response),
		);
	};

	const rest = async <Schema extends z.ZodType>(
		path: string,
		schema: Schema,
	): Promise<{ body: z.output<Schema>; next: string | null }> => {
		const response = await fetchImpl(`https://${host}/api/v4${path}`, {
			headers,
		});
		if (!response.ok) {
			throw new TrackerError(
				`GitLab read failed (HTTP ${response.status}): ${path}`,
				response.status,
			);
		}
		const next = response.headers.get("x-next-page") ?? "";
		return {
			body: schema.parse(await response.json()),
			next: next === "" ? null : next,
		};
	};

	/** Each project that the token is a member of, read 100 at a time. */
	const memberProjects = async () => {
		const projects: z.output<typeof listedProject>[] = [];
		let page: string | null = "1";
		while (page !== null) {
			const read: {
				body: z.output<typeof listedProject>[];
				next: string | null;
			} = await rest(
				`/projects?membership=true&archived=false&order_by=last_activity_at&per_page=100&page=${page}`,
				z.array(listedProject),
			);
			projects.push(...read.body);
			page = read.next;
		}
		return projects;
	};

	type WorkItemState = "opened" | "closed";

	const readPage = async (
		repo: string,
		state: WorkItemState,
		after: string | null,
	) => {
		const { project: read } = await graphql({
			label: "read work items",
			subject: repo,
			query: workItemsQuery,
			variables: {
				path: repo,
				state,
				sort: state === "opened" ? "CREATED_DESC" : "UPDATED_DESC",
				after,
			},
			data: workItemsPage,
		});
		if (read === null) {
			throw new TrackerError(`GitLab project not found: ${repo}`, 404);
		}
		return read.workItems;
	};

	const readWorkItems = async (
		repo: string,
		state: WorkItemState,
	): Promise<WorkItem[]> => {
		const items: WorkItem[] = [];
		let after: string | null = null;
		do {
			const page = await readPage(repo, state, after);
			items.push(...page.nodes);
			after =
				state === "opened" && page.pageInfo.hasNextPage
					? page.pageInfo.endCursor
					: null;
		} while (after !== null);
		return items;
	};

	return {
		async listTickets(tracked) {
			const repo = tracked.key;
			const items = [
				...(await readWorkItems(repo, "opened")),
				...(await readWorkItems(repo, "closed")),
			];
			return {
				name: repo,
				tickets: items.map((item) => ticketOf(repo, item)),
			};
		},
		async findProjects() {
			const { body: viewer } = await rest("/user", user);
			const projects = await memberProjects();
			return {
				projects: projects.map((item): FoundProject => ({
					key: item.path_with_namespace,
					tracker: "gitlab",
					updatedAt: item.last_activity_at,
				})),
				viewer: { login: viewer.username, orgs: [] },
			};
		},
	};
}
