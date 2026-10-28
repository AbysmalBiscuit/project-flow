import { expect } from "bun:test";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	page,
	recordedDiscovery,
	repo,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import {
	repoReadFromHandler,
	repoReadFromLists,
	repoReadResponse,
} from "../support/repo-read.ts";

export async function readServedOverview(base: string): Promise<Overview> {
	const response = await fetch(new URL("/api/overview", base));
	expect(response.status).toBe(200);
	return (await response.json()) as Overview;
}

export function githubTicket(
	number: number,
	state: "open" | "closed",
	stateReason: string | null,
	title = `Ticket ${number}`,
): Record<string, unknown> {
	return {
		number,
		title,
		state,
		state_reason: stateReason,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-10-18T12:00:00.000Z",
	};
}

export function pullRequest(number: number): Record<string, unknown> {
	return {
		...githubTicket(number, "closed", "completed"),
		pull_request: {
			url: `https://api.github.com/repos/${repo}/pulls/${number}`,
		},
	};
}

export function emptyList(url: string): Response | null {
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?")
	) {
		return page([], null);
	}
	return null;
}

export const fixtureTickets = [
	githubTicket(1, "closed", "completed"),
	githubTicket(2, "closed", "not_planned"),
	githubTicket(3, "closed", "duplicate"),
	githubTicket(4, "closed", null),
	githubTicket(5, "open", null),
	githubTicket(6, "open", null),
	pullRequest(7),
];

export function githubFetch(requests: string[] = []): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		requests.push(url);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const first = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
		const second = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=2`;
		if (url === first) {
			return page(fixtureTickets.slice(0, 4), second);
		}
		if (url === second) {
			return page(fixtureTickets.slice(4), null);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?")
		) {
			return page([], null);
		}
		if (url.includes("/check-runs")) {
			return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
		}
		if (
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			/\/pulls\/\d+$/.test(url)
		) {
			return page([], null);
		}
		if (url === "https://api.github.com/graphql") {
			const read = repoReadFromLists(input, init, {
				[repo]: [...fixtureTickets.slice(0, 4), ...fixtureTickets.slice(4)],
			});
			if (read !== null) {
				requests.push(
					`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`,
				);
				return read;
			}
			return new Response(
				JSON.stringify({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				}),
				{ status: 200 },
			);
		}
		if (url === "https://api.linear.app/graphql") {
			return new Response(JSON.stringify({ data: { viewer: { id: "lev" } } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return (
			emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
		);
	};
}

export async function assertCard(base: string): Promise<void> {
	const response = await fetch(new URL("/api/overview", base));
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		projects: unknown;
		fetchedAt: string | null;
		error: string | null;
	};
	expect(body.projects).toEqual([
		{
			name: repo,
			tracker: "github",
			ref: { tracker: "github", repo },
			done: 2,
			dropped: 2,
			blocked: 0,
			backlog: 2,
			inProgress: 0,
			inReview: 0,
			awaitingMerge: 0,
			tags: [],
			unlinkedPrs: [],
			tickets: [
				{
					key: `${repo}#1`,
					title: "Ticket 1",
					state: "done",
					blockers: [],
					lane: "Done",
					statusType: "done",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#2`,
					title: "Ticket 2",
					state: "dropped",
					blockers: [],
					lane: "Dropped",
					statusType: "dropped",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#3`,
					title: "Ticket 3",
					state: "dropped",
					blockers: [],
					lane: "Dropped",
					statusType: "dropped",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#4`,
					title: "Ticket 4",
					state: "done",
					blockers: [],
					lane: "Done",
					statusType: "done",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#5`,
					title: "Ticket 5",
					state: "backlog",
					blockers: [],
					lane: "Backlog",
					statusType: "backlog",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
				{
					key: `${repo}#6`,
					title: "Ticket 6",
					state: "backlog",
					blockers: [],
					lane: "Backlog",
					statusType: "backlog",
					enteredStateAt: "2026-10-18T12:00:00.000Z",
					updatedAt: "2026-10-18T12:00:00.000Z",
				},
			],
			crossProjectBlockers: [],
			needsYou: 0,
			progress: 33,
			fetchedAt: body.fetchedAt,
			error: null,
			statusTypes: {
				backlog: 2,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 0,
				done: 2,
				dropped: 2,
			},
		},
	]);
	expect(body.error).toBeNull();
	expect(body.fetchedAt).not.toBeNull();
	const pageResponse = await fetch(new URL("/", base));
	expect(pageResponse.status).toBe(200);
	expect(pageResponse.headers.get("content-type")).toContain("text/html");
	const html = await pageResponse.text();
	expect(html).toContain('<div id="root"></div>');
	expect(html).toContain(`id="${storedPageId}"`);
	expect(embeddedForRoute(html, "/")).toEqual(body);
}

export const linearProject = "widget-launch-0d42ae5d46d0";
export const linearName = "Widget launch";

export function linearIssue(
	id: string,
	stateType: "completed" | "canceled" | "duplicate" | "backlog" | "started",
): Record<string, unknown> {
	return {
		id,
		identifier: `WID-${id}`,
		title: `Linear ticket ${id}`,
		state: { type: stateType },
		updatedAt: "2026-08-18T12:00:00.000Z",
	};
}

export const linearRecorded = [
	linearIssue("1", "completed"),
	linearIssue("2", "canceled"),
	linearIssue("3", "duplicate"),
	linearIssue("4", "completed"),
	linearIssue("5", "backlog"),
	linearIssue("6", "started"),
];

export function linearFetch(requests: string[]): Fetch {
	return linearFake({
		project: {
			id: "project-1",
			name: linearName,
			slugId: linearProject,
		},
		pages: [
			{ nodes: linearRecorded.slice(0, 4), endCursor: "page-2" },
			{ nodes: linearRecorded.slice(4), endCursor: null },
		],
		requests,
		github: async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const list = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
			if (url === list) {
				return page(
					fixtureTickets.filter((item) => item.pull_request === undefined),
					null,
				);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([], null);
			}
			if (url.includes("/check-runs")) {
				return new Response(JSON.stringify({ check_runs: [] }), {
					status: 200,
				});
			}
			if (
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions") ||
				/\/pulls\/\d+$/.test(url)
			) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, githubFetch());
				if (listed !== null) {
					return listed;
				}
				const read = repoReadResponse(input, init);
				if (read !== null) {
					return read;
				}
				return new Response(
					JSON.stringify({
						data: {
							repository: {
								pullRequest: { closingIssuesReferences: { nodes: [] } },
							},
						},
					}),
					{ status: 200 },
				);
			}
			return emptyProjectFields(input, init) ?? unrecorded(input);
		},
	});
}

export const storedPageId = "project-flow-stored";

export function embeddedStored(html: string): unknown {
	const match = html.match(
		new RegExp(
			`<script id="${storedPageId}" type="application/json">([\\s\\S]*?)</script>`,
		),
	);
	expect(match?.[1]).toBeString();
	return JSON.parse(match?.[1] ?? "");
}

export function embeddedForRoute(html: string, page: string): unknown {
	const stored = embeddedStored(html);
	if (page !== "/") {
		return stored;
	}
	expect(stored).toHaveProperty("overview");
	expect(stored).toHaveProperty("settings");
	return (stored as { overview: unknown }).overview;
}
