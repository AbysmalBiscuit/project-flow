import { z } from "zod";

import type { Ticket, TicketRef } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	type ForgejoAccess,
	type ForgejoClient,
	forgejoClient,
} from "./forgejo-api.ts";
import type { Tracker } from "./ports.ts";
import { settingsKey } from "./project-ref.ts";
import { taskListParents } from "./task-list-parents.ts";
import { numberedKey } from "./ticket-key.ts";

const forgejoIssue = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	state: z.string(),
	body: z.string().nullable(),
	updated_at: z.string(),
	created_at: z.string(),
	closed_at: z.string().nullable(),
	milestone: z.object({ title: z.string() }).nullable(),
	labels: z.array(z.object({ name: z.string() })).nullable(),
	assignees: z.array(z.object({ login: z.string() })).nullable(),
});

type ForgejoIssue = z.infer<typeof forgejoIssue>;

const forgejoDependency = z.object({
	number: z.number(),
	title: z.string(),
	state: z.string(),
	repository: z.object({ full_name: z.string() }),
});

const forgejoRepo = z.object({
	full_name: z.string(),
	updated_at: z.string(),
	has_issues: z.boolean(),
});

const forgejoUser = z.object({ login: z.string() });

async function readBlockers(
	client: ForgejoClient,
	host: string,
	repo: string,
	number: number,
): Promise<TicketRef[]> {
	const dependencies = await client.rows(
		`${client.api}/repos/${repo}/issues/${number}/dependencies?limit=50`,
		"list dependencies",
		forgejoDependency,
	);
	return dependencies.map((dependency) => ({
		tracker: "forgejo",
		project: settingsKey(dependency.repository.full_name, host),
		key: numberedKey(dependency.repository.full_name, dependency.number),
		state: dependency.state === "closed" ? "closed" : "open",
		title: dependency.title,
	}));
}

function ticketOf(
	issue: ForgejoIssue,
	repo: string,
	parent: number | undefined,
	blockedBy: TicketRef[],
): Ticket {
	const assignees = (issue.assignees ?? []).map(({ login }) => login);
	return {
		id: String(issue.number),
		tracker: "forgejo",
		key: numberedKey(repo, issue.number),
		title: issue.title,
		url: issue.html_url,
		state: issue.state === "closed" ? "closed" : "open",
		stateReason: null,
		updatedAt: issue.updated_at,
		createdAt: issue.created_at,
		...(issue.closed_at === null ? {} : { closedAt: issue.closed_at }),
		body: issue.body ?? "",
		blockedBy,
		milestone: issue.milestone?.title ?? null,
		parent: parent === undefined ? null : numberedKey(repo, parent),
		labels: (issue.labels ?? []).map(({ name }) => name),
		...(assignees.length === 0
			? {}
			: { assignee: assignees[0] ?? null, assignees }),
	};
}

/** Reads the tickets and found repos of one Forgejo host. A parent comes from the body of another ticket, so each read lists every issue. */
export function forgejoTracker(
	access: ForgejoAccess,
	fetchImpl: Fetch,
): Tracker {
	const client = forgejoClient(access, fetchImpl);
	return {
		async findProjects() {
			const user = forgejoUser.parse(
				await (await client.get(`${client.api}/user`, "read user")).json(),
			);
			const repos = await client.rows(
				`${client.api}/user/repos?limit=50`,
				"find repos",
				forgejoRepo,
			);
			return {
				projects: repos
					.filter((repo) => repo.has_issues)
					.map((repo) => ({
						key: repo.full_name,
						name: settingsKey(repo.full_name, access.host),
						tracker: "forgejo" as const,
						host: access.host,
						updatedAt: repo.updated_at,
					})),
				viewer: { login: user.login, orgs: [] },
			};
		},
		async listTickets(project, _since, held = []) {
			const repo = project.key;
			const issues = await client.rows(
				`${client.api}/repos/${repo}/issues?state=all&type=issues&limit=50`,
				"list issues",
				forgejoIssue,
			);
			const parents = taskListParents(issues);
			const heldTickets = new Map(held.map((ticket) => [ticket.id, ticket]));
			const tickets: Ticket[] = [];
			for (const issue of issues) {
				const stored = heldTickets.get(String(issue.number));
				const blockedBy =
					issue.state === "closed"
						? []
						: stored?.updatedAt === issue.updated_at
							? stored.blockedBy
							: await readBlockers(client, access.host, repo, issue.number);
				tickets.push(
					ticketOf(issue, repo, parents.get(issue.number), blockedBy),
				);
			}
			return { name: repo, tickets };
		},
	};
}
