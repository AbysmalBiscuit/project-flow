import { z } from "zod";

import type { Board, Ticket, TicketStatus } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubForge } from "./github-forge.ts";
import { githubHeaders, nextPage } from "./github-pages.ts";
import {
	listProjectPullLinks,
	listProjectStatuses,
	listProjectTickets,
	openLinkedKeys,
} from "./github-project-items.ts";
import {
	findGithubProjects,
	githubProjectByNumber,
} from "./github-projects.ts";
import { type GithubReads, githubReads } from "./github-reads.ts";
import { currentBlockers } from "./github-repo.ts";
import {
	addGithubLabel,
	fetchGithubThread,
	postGithubReply,
} from "./github-thread.ts";
import { factoryBoard } from "./lanes.ts";
import { type Forge, type Tracker, TrackerError } from "./ports.ts";

export { githubHeaders } from "./github-pages.ts";
export { conditionalFetch, type ValidatorStore } from "./github-rest-cache.ts";

export const missingToken =
	'GITHUB_TOKEN is missing: set GITHUB_TOKEN or run "gh auth login".';

export async function checkToken(
	token: string,
	fetchImpl: Fetch,
): Promise<Response> {
	return fetchImpl("https://api.github.com/user", {
		headers: githubHeaders(token),
	});
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

function githubTracker(
	token: string,
	fetchImpl: Fetch,
	reads: GithubReads,
): Tracker {
	return {
		beginPoll() {
			reads.clear();
		},
		forgetProject(project) {
			reads.forget(project.key);
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
				const owner = project.ref.owner;
				const items = await reads.projectItems(repo, owner);
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
			const batched = await reads.repo(repo, since, held);
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
		async pullLinks(project) {
			if (project.ref.kind !== "github-project") {
				return { links: [], repos: [] };
			}
			const owner = project.ref.owner;
			return listProjectPullLinks(
				token,
				fetchImpl,
				await reads.projectItems(project.key, owner),
				owner,
			);
		},
		fetchThread(project, key, signal) {
			return fetchGithubThread(token, fetchImpl, project, key, signal);
		},
		postReply(reply) {
			return postGithubReply(token, fetchImpl, reply);
		},
		addLabel(key, label) {
			return addGithubLabel(token, fetchImpl, key, label);
		},
	};
}

/** The GitHub tracker and forge. They share one read of each repo in a poll. */
export function githubAdapters(
	token: string,
	fetchImpl: Fetch,
): { tracker: Tracker; forge: Forge } {
	const reads = githubReads(token, fetchImpl);
	return {
		tracker: githubTracker(token, fetchImpl, reads),
		forge: githubForge(token, fetchImpl, reads),
	};
}
