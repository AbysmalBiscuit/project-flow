import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview, ProjectReport, StatusType } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { doneTicketsForLane } from "../src/lanes.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo } from "./support/app.ts";
import { urlOf } from "./support/fetch.ts";
import {
	head,
	page,
	recordedDiscovery,
	repo,
	unrecorded,
} from "./support/github.ts";
import { linearFake } from "./support/linear.ts";
import { defaultStates } from "./support/states.ts";

const now = "2026-08-18T12:00:00.000Z";

const statusTypes = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
	"dropped",
] as const satisfies readonly StatusType[];

function issue(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: now,
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		...fields,
	};
}

function closed(
	number: number,
	title: string,
	updatedAt: string,
	reason: "completed" | "not_planned" = "completed",
): Record<string, unknown> {
	return issue(number, title, {
		state: "closed",
		state_reason: reason,
		closed_at: updatedAt,
		updated_at: updatedAt,
	});
}

function pull(
	number: number,
	title: string,
	closing: number[],
	branch: string,
	draft = false,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		draft,
		html_url: `https://github.com/${repo}/pull/${number}`,
		head: { ref: branch, sha: head },
		body: closing.map((item) => `Closes #${item}`).join("\n"),
		merged_at: null,
	};
}

const openIssues = [
	issue(1, "Ship the board"),
	issue(2, "Draw the nodes", { body: `Blocked by: ${repo}#1` }),
	issue(3, "Write the copy"),
	issue(4, "Read the review"),
];

const doneIssues = [11, 12, 13, 14, 15, 16].map((number) =>
	closed(
		number,
		`Close item ${number}`,
		number === 16 ? "2026-08-17T12:00:00.000Z" : "2026-08-01T12:00:00.000Z",
	),
);

const everyStatus = [
	issue(1, "Wait in backlog"),
	issue(2, "Build the widget"),
	issue(3, "Review the widget"),
	issue(4, "Merge the widget"),
	closed(5, "Ship the widget", "2026-08-17T12:00:00.000Z"),
	closed(6, "Drop the widget", "2026-08-17T12:00:00.000Z", "not_planned"),
	issue(7, "Hold the widget", { body: `Blocked by: ${repo}#1` }),
];

const pulls = [
	pull(31, "Review it", [3], "review"),
	pull(41, "Merge it", [4], "merge"),
];

function recorded(
	issues: Record<string, unknown>[],
	pullsForRepo: Record<string, unknown>[],
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
			return page(issues);
		}
		if (url.startsWith(`https://api.github.com/repos/${repo}/pulls?`)) {
			if (url.includes("state=closed")) {
				return page([
					{
						number: 1,
						title: "merged",
						state: "closed",
						draft: false,
						html_url: `https://github.com/${repo}/pull/1`,
						head: { ref: "1-merged", sha: head },
						body: "",
						merged_at: "2026-08-01T12:00:00.000Z",
					},
				]);
			}
			return page(pullsForRepo);
		}
		const pullUrl = url.match(/\/pulls\/(\d+)$/);
		if (pullUrl?.[1] !== undefined) {
			const found = pullsForRepo.find(
				(item) => item.number === Number(pullUrl[1]),
			);
			return found === undefined
				? new Response("not recorded", { status: 404 })
				: Response.json(found);
		}
		if (url.includes("/labels?")) {
			return page([
				{ name: "ready", color: "0e8a16" },
				{ name: "factory: running", color: "1d76db" },
				{ name: "factory: in-review", color: "fbca04" },
			]);
		}
		if (url.includes("/branches?")) {
			return page([{ name: "2-feat-build-the-widget" }]);
		}
		if (url === "https://api.github.com/graphql") {
			const body = typeof init?.body === "string" ? init.body : "";
			if (body.includes("closingIssuesReferences")) {
				const number = Number(
					/"number":(\d+)/.exec(body)?.[1] ??
						/"number": (\d+)/.exec(body)?.[1] ??
						"0",
				);
				const found = pullsForRepo.find((item) => item.number === number);
				const closing = String(found?.body ?? "")
					.split("\n")
					.flatMap((line) => {
						const match = /Closes #(\d+)/.exec(line);
						return match?.[1] === undefined
							? []
							: [{ number: Number(match[1]) }];
					});
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: closing } },
						},
					},
				});
			}
			return Response.json({ data: {} });
		}
		if (url.includes("/commits/") && url.includes("/check-runs")) {
			return Response.json({
				check_runs: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			});
		}
		if (url.includes("/pulls/") && url.includes("/reviews")) {
			const number = Number(/\/pulls\/(\d+)\//.exec(url)?.[1] ?? "0");
			if (number === 1 || number === 31) {
				return page([
					{
						user: { login: "grok-code-review[bot]" },
						commit_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
						state: "COMMENTED",
					},
				]);
			}
			if (number === 41) {
				return page([
					{
						user: { login: "grok-code-review[bot]" },
						commit_id: head,
						state: "COMMENTED",
					},
				]);
			}
			return page([]);
		}
		if (
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions")
		) {
			return page([]);
		}
		return unrecorded(input);
	};
}

async function withApp(
	config: string,
	fetchImpl: Fetch,
	check: (base: string) => Promise<void>,
): Promise<void> {
	const { path, cleanup } = await tempConfig(config);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			check(base).then(resolve).catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				now: () => new Date(now),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("done counts", () => {
	test("the card text, the percent and the status counts agree for every status type", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
			recorded(everyStatus, pulls),
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				const card = overview.projects.find((project) => project.name === repo);
				expect(card).toBeDefined();
				if (card === undefined) {
					return;
				}
				const byType = Object.fromEntries(
					statusTypes.map((type) => [
						type,
						card.tickets
							.filter((ticket) => ticket.statusType === type)
							.map((ticket) => ticket.key),
					]),
				);
				expect(byType).toEqual({
					backlog: [`${repo}#1`, `${repo}#7`],
					inProgress: [`${repo}#2`],
					inReview: [`${repo}#3`],
					awaitingMerge: [`${repo}#4`],
					done: [`${repo}#5`],
					dropped: [`${repo}#6`],
				});
				const done = card.statusTypes.done;
				const total = statusTypes.reduce(
					(sum, type) => sum + card.statusTypes[type],
					0,
				);
				expect(card.done).toBe(done);
				expect(card.tickets).toHaveLength(total);
				expect(card.progress).toBe(Math.round((done / total) * 100));
				expect(done).toBeGreaterThan(0);
				expect(total).toBeGreaterThan(done);
			},
		);
	});

	test("the project page summary matches the overview card", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
			recorded([...openIssues, ...doneIssues], []),
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				const card = overview.projects.find((project) => project.name === repo);
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
					)
				).json()) as ProjectReport;
				expect(card).toBeDefined();
				if (card === undefined) {
					return;
				}
				const done = report.tickets.filter(
					(ticket) => ticket.statusType === "done",
				).length;
				expect(report.done).toBe(card.done);
				expect(report.total).toBe(card.tickets.length);
				expect(done).toBe(1);
				expect(card.done).toBe(doneIssues.length);
				const summary = report.sections.find(
					(section) => section.id === "summary",
				);
				expect(summary?.text).toContain(`${card.done} done`);
			},
		);
	});

	test("search, assignee, needs-you and blocked filters apply to done tickets, and the age limit does not", async () => {
		const ada = { assignee: { login: "ada" }, assignees: [{ login: "ada" }] };
		const bea = { assignee: { login: "bea" }, assignees: [{ login: "bea" }] };
		const issues = [
			issue(1, "Ship the widget", ada),
			issue(2, "Draw the legend", bea),
			{ ...closed(11, "Close the widget", "2026-08-17T12:00:00.000Z"), ...ada },
			{ ...closed(12, "Close the legend", "2026-08-17T12:00:00.000Z"), ...bea },
			{
				...closed(13, "Close the old widget", "2026-08-01T12:00:00.000Z"),
				...ada,
			},
			closed(14, "Close the map", "2026-08-17T12:00:00.000Z"),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				projectViews: {
					[repo]: {
						search: "widget",
						assignees: ["Ada"],
						maxAgeDays: { Done: 2 },
					},
				},
			}),
			recorded(issues, []),
			async (base) => {
				const filtered = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
					)
				).json()) as ProjectReport;
				expect(filtered.doneTickets.map((ticket) => ticket.key)).toEqual([
					`${repo}#11`,
					`${repo}#13`,
				]);
				expect(filtered.done).toBe(4);
				expect(filtered.total).toBe(6);
				const needs = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						pinned: [{ tracker: "github", repo }],
						projectViews: {
							[repo]: { needsYouOnly: true, blockedOnly: false, search: "" },
						},
					}),
				});
				expect(needs.status).toBe(200);
				const needed = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
					)
				).json()) as ProjectReport;
				expect(needed.doneTickets).toEqual([]);
				expect(needed.done).toBe(4);
				const blocked = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						pinned: [{ tracker: "github", repo }],
						projectViews: {
							[repo]: { blockedOnly: true, search: "   ", assignees: ["  "] },
						},
					}),
				});
				expect(blocked.status).toBe(200);
				const held = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
					)
				).json()) as ProjectReport;
				expect(held.doneTickets).toEqual([]);
				expect(held.done).toBe(4);
				expect(held.total).toBe(6);
			},
		);
	});

	test("a done ticket on the age boundary stays, an unlimited cap keeps every done ticket, and a blank date stays", async () => {
		const issues = [
			closed(11, "Close on the boundary", "2026-08-16T12:00:00.000Z"),
			closed(12, "Close past the boundary", "2026-08-16T11:59:59.000Z"),
			issue(13, "Close with a blank date", {
				state: "closed",
				state_reason: "completed",
				closed_at: "   ",
				updated_at: "   ",
			}),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				projectViews: { [repo]: { maxAgeDays: { Done: 2 } } },
			}),
			recorded(issues, []),
			async (base) => {
				const bounded = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
					)
				).json()) as ProjectReport;
				expect(bounded.tickets.map((ticket) => ticket.key)).toEqual([
					`${repo}#11`,
					`${repo}#13`,
				]);
				expect(bounded.doneTickets.map((ticket) => ticket.key)).toEqual([
					`${repo}#11`,
					`${repo}#12`,
					`${repo}#13`,
				]);
				expect(bounded.done).toBe(3);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Record<string, unknown>;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: { [repo]: { maxAgeDays: { Done: 0 } } },
					}),
				});
				expect(saved.status).toBe(200);
				const unlimited = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
					)
				).json()) as ProjectReport;
				expect(unlimited.tickets.map((ticket) => ticket.key)).toEqual([
					`${repo}#11`,
					`${repo}#12`,
					`${repo}#13`,
				]);
				expect(unlimited.done).toBe(3);
			},
		);
	});

	test("two Done-type statuses keep each ticket in one lane", async () => {
		const shipped = {
			id: "st-shipped",
			name: "Shipped",
			type: "completed",
			color: "#4cb782",
		};
		const released = {
			id: "st-released",
			name: "Released",
			type: "completed",
			color: "#5e6ad2",
		};
		const backlog = {
			id: "st-backlog",
			name: "Backlog",
			type: "backlog",
			color: "#bec2c8",
		};
		const progress = {
			id: "st-progress",
			name: "In Progress",
			type: "started",
			color: "#f2c94c",
		};
		const review = {
			id: "st-review",
			name: "In Review",
			type: "started",
			color: "#4cb782",
		};
		const merge = {
			id: "st-merge",
			name: "Awaiting merge",
			type: "started",
			color: "#bb87fc",
		};
		const dropped = {
			id: "st-dropped",
			name: "Canceled",
			type: "canceled",
			color: "#95a2b3",
		};
		const states = [
			{ ...backlog, position: 0 },
			{ ...progress, position: 1 },
			{ ...review, position: 2 },
			{ ...merge, position: 3 },
			{ ...shipped, position: 4 },
			{ ...released, position: 5 },
			{ ...dropped, position: 6 },
		];
		function linearIssue(
			identifier: string,
			title: string,
			state: { id: string; name: string; type: string; color: string },
			updatedAt: string,
		): Record<string, unknown> {
			return {
				identifier,
				title,
				description: "",
				updatedAt,
				state,
				history: {
					nodes: [{ createdAt: updatedAt, toState: { id: state.id } }],
				},
				parent: null,
				projectMilestone: null,
				labels: { nodes: [] },
			};
		}
		const project = "Widget launch";
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				projectViews: {
					[project]: { maxAgeDays: { Shipped: 2, Released: 2 } },
				},
				states: [
					...defaultStates.filter((state) => state.id !== "done"),
					{
						id: "shipped",
						label: "Shipped",
						colour: "#7c5cbf",
						categories: ["done"],
					},
					{
						id: "released",
						label: "Released",
						colour: "#5b3f9a",
						categories: ["done"],
					},
				],
				stateMappings: {
					WID: { Shipped: "shipped", Released: "released" },
				},
			}),
			linearFake({
				project: {
					id: "project-widget",
					name: project,
					slugId: "widget-launch",
					teams: {
						nodes: [{ id: "team-widget", key: "WID", name: "Widget" }],
					},
				},
				states,
				issues: [
					linearIssue("WID-1", "Wait", backlog, "2026-08-18T12:00:00.000Z"),
					linearIssue("WID-2", "Build", progress, "2026-08-18T12:00:00.000Z"),
					linearIssue("WID-3", "Review", review, "2026-08-18T12:00:00.000Z"),
					linearIssue("WID-4", "Merge", merge, "2026-08-18T12:00:00.000Z"),
					linearIssue(
						"WID-5",
						"Ship fresh",
						shipped,
						"2026-08-17T12:00:00.000Z",
					),
					linearIssue("WID-6", "Ship old", shipped, "2026-08-01T12:00:00.000Z"),
					linearIssue(
						"WID-7",
						"Release fresh",
						released,
						"2026-08-17T12:00:00.000Z",
					),
					linearIssue(
						"WID-8",
						"Release old",
						released,
						"2026-08-01T12:00:00.000Z",
					),
					linearIssue("WID-9", "Drop", dropped, "2026-08-17T12:00:00.000Z"),
				],
			}),
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				const card = overview.projects.find((item) => item.name === project);
				expect(card?.statusTypes).toEqual({
					backlog: 1,
					inProgress: 1,
					inReview: 1,
					awaitingMerge: 1,
					done: 4,
					dropped: 1,
				});
				expect(card?.done).toBe(4);
				expect(card?.tickets).toHaveLength(9);
				expect(card?.progress).toBe(Math.round((4 / 9) * 100));
				const filtered = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(project)}`, base),
					)
				).json()) as ProjectReport;
				const doneLanes = filtered.lanes.filter(
					(lane) => lane.statusType === "done",
				);
				expect(doneLanes.map((lane) => lane.name)).toEqual([
					"Shipped",
					"Released",
				]);
				const byLane = Object.fromEntries(
					doneLanes.map((lane) => [
						lane.name,
						doneTicketsForLane(filtered, lane.name).map((ticket) => ticket.key),
					]),
				);
				expect(byLane).toEqual({
					Shipped: ["WID-5", "WID-6"],
					Released: ["WID-7", "WID-8"],
				});
				const fresh = Object.fromEntries(
					doneLanes.map((lane) => [
						lane.name,
						filtered.tickets
							.filter((ticket) => ticket.lane === lane.name)
							.map((ticket) => ticket.key),
					]),
				);
				expect(fresh).toEqual({
					Shipped: ["WID-5"],
					Released: ["WID-7"],
				});
				const seen = filtered.doneTickets.map((ticket) => ticket.key);
				expect(new Set(seen).size).toBe(seen.length);
				expect(card).toBeDefined();
				if (card === undefined) {
					return;
				}
				expect(filtered.done).toBe(card.done);
				expect(filtered.total).toBe(card.tickets.length);
				const board = (await (
					await fetch(
						new URL(
							`/api/projects/${encodeURIComponent(project)}?view=all`,
							base,
						),
					)
				).json()) as ProjectReport;
				expect(
					board.tickets
						.filter((ticket) => ticket.statusType === "done")
						.map((ticket) => ticket.key),
				).toEqual(["WID-5", "WID-6", "WID-7", "WID-8"]);
				expect(board.doneTickets.map((ticket) => ticket.key)).toEqual([
					"WID-5",
					"WID-6",
					"WID-7",
					"WID-8",
				]);
				expect(board.done).toBe(4);
				expect(board.total).toBe(9);
			},
		);
	});

	test("done tickets older than the max age stay on the unfiltered board", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				projectViews: { [repo]: { maxAgeDays: { Done: 2 } } },
			}),
			recorded([...openIssues, ...doneIssues], []),
			async (base) => {
				const filtered = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
					)
				).json()) as ProjectReport;
				const hidden = filtered.tickets.filter(
					(ticket) => ticket.statusType === "done",
				);
				expect(
					hidden.map((ticket) => `${ticket.key} ${ticket.enteredStateAt}`),
				).toEqual([`${repo}#16 2026-08-17T12:00:00.000Z`]);
				expect(filtered.doneTickets).toHaveLength(doneIssues.length);
				expect(filtered.doneTickets.length).toBeGreaterThan(5);
				expect(filtered.doneTickets.map((ticket) => ticket.key)).toContain(
					`${repo}#11`,
				);
				const board = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}?view=all`, base),
					)
				).json()) as ProjectReport;
				expect(board.doneTickets.map((ticket) => ticket.key)).toEqual(
					filtered.doneTickets.map((ticket) => ticket.key),
				);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}?view=all`, base),
				);
				expect(blank.status).toBe(404);
				const spaced = await fetch(
					new URL(`/api/projects/${encodeURIComponent("acme/widget  ")}`, base),
				);
				expect(spaced.status).toBe(404);
				const missing = await fetch(new URL("/api/projects/missing", base));
				expect(missing.status).toBe(404);
			},
		);
	});
});
