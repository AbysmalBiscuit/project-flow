import { z } from "zod";

import type { Board, Ticket, TicketStatus } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubHeaders, nextPage } from "./github-pages.ts";
import {
	listProjectItems,
	listProjectPulls,
	listProjectStatuses,
	listProjectTickets,
	openLinkedKeys,
	type ProjectItem,
} from "./github-project-items.ts";
import {
	findGithubProjects,
	githubProjectByNumber,
} from "./github-projects.ts";
import type { ReviewEvidence } from "./github-pulls.ts";
import { readAutoMerge } from "./github-repo-query.ts";
import { currentBlockers, readRepo, type StoredLists } from "./github-repo.ts";
import {
	addGithubLabel,
	fetchGithubThread,
	postGithubReply,
} from "./github-thread.ts";
import { factoryBoard } from "./lanes.ts";
import { type GithubTracker, TrackerError } from "./ports.ts";
import { githubKey } from "./ticket-key.ts";

export { githubHeaders } from "./github-pages.ts";
export {
	loadLinkedPulls,
	type PullLink,
	type ReviewEvidence,
} from "./github-pulls.ts";
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

export function githubTracker(token: string, fetchImpl: Fetch): GithubTracker {
	const seenReviews = new Map<string, ReviewEvidence>();
	const storedLists: StoredLists = { issues: new Map(), pulls: new Map() };
	const projectItemsById = new Map<string, Promise<ProjectItem[]>>();
	const projectItems = (projectId: string, projectOwner: string) => {
		const cached = projectItemsById.get(projectId);
		if (cached !== undefined) {
			return cached;
		}
		const listed = listProjectItems(
			token,
			fetchImpl,
			projectId,
			projectOwner,
		).catch((error: unknown) => {
			if (projectItemsById.get(projectId) === listed) {
				projectItemsById.delete(projectId);
			}
			throw error;
		});
		projectItemsById.set(projectId, listed);
		return listed;
	};
	const autoMergeByRepo = new Map<string, Promise<boolean>>();
	const repoSnapshots = new Map<string, ReturnType<typeof readRepo>>();
	const repoReadFor = (
		repo: string,
		since: Date | null,
		held: Ticket[] = [],
	) => {
		const cached = repoSnapshots.get(repo);
		if (cached !== undefined) {
			return cached;
		}
		const read = readRepo(
			token,
			fetchImpl,
			repo,
			since,
			storedLists,
			held,
		).catch((error: unknown) => {
			if (repoSnapshots.get(repo) === read) {
				repoSnapshots.delete(repo);
			}
			throw error;
		});
		repoSnapshots.set(repo, read);
		return read;
	};
	return {
		beginPoll() {
			repoSnapshots.clear();
			autoMergeByRepo.clear();
			projectItemsById.clear();
		},
		forgetProject(project) {
			repoSnapshots.delete(project.key);
			autoMergeByRepo.delete(project.key);
			projectItemsById.delete(project.key);
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
				const items = await projectItems(repo, owner);
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
			const batched = await repoReadFor(repo, since, held);
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
		async listPulls(project) {
			const repo = project.key;
			if (project.ref.kind === "github-project") {
				const owner = project.ref.owner;
				return listProjectPulls(
					token,
					fetchImpl,
					await projectItems(repo, owner),
					seenReviews,
					owner,
				);
			}
			const batched = await repoReadFor(repo, null);
			if (batched === null) {
				throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
			}
			for (const pull of batched.pulls) {
				if (pull.merged) {
					seenReviews.set(githubKey(repo, pull.number), {
						checks: pull.checks,
						comments: pull.comments,
						reviews: pull.reviews,
						reactions: pull.reactions,
					});
				}
			}
			return batched.pulls;
		},
		async repoAutoMerge(repo) {
			const cached = autoMergeByRepo.get(repo);
			if (cached !== undefined) {
				return cached;
			}
			const snapshot = repoSnapshots.get(repo);
			const read =
				snapshot === undefined
					? readAutoMerge(token, fetchImpl, repo)
					: snapshot.then((opened) => opened?.autoMerge ?? false);
			autoMergeByRepo.set(repo, read);
			return read;
		},
		async listBranches(repo) {
			const batched = await repoReadFor(repo, null);
			if (batched === null) {
				throw new TrackerError(`GitHub read repo failed: ${repo}`, 502);
			}
			return batched.branches;
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
