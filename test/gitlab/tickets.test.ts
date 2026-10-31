import { describe, expect, test } from "bun:test";

import type { Overview, ProjectReport, TicketView } from "../../src/domain.ts";
import { withServer } from "../support/app.ts";
import { readWhere, settledOverview } from "../support/reads.ts";
import {
	gitlabEnv,
	type GitlabFake,
	gitlabFake,
	gitlabPin,
	gitlabRepo,
	linearName,
	linearPin,
	linearWithGitlab,
} from "./_support.ts";

const key = (iid: number) => `${gitlabRepo}#${iid}`;

async function reportOf(base: string, name: string): Promise<ProjectReport> {
	return readWhere<ProjectReport>(
		new URL(`/api/projects/${encodeURIComponent(name)}?view=all`, base),
		(report) => report.tickets.length > 0,
	);
}

function viewOf(report: ProjectReport, ticket: string): TicketView {
	const view = report.tickets.find((item) => item.key === ticket);
	if (view === undefined) {
		throw new Error(`missing ticket ${ticket}`);
	}
	return view;
}

function withGitlabRepo(
	fake: GitlabFake,
	checks: (base: string) => Promise<void>,
): Promise<void> {
	return withServer(gitlabFake(fake), 3600, checks, [gitlabPin], gitlabEnv);
}

describe("a tracked GitLab repo", () => {
	test("shows its tickets in their states on the overview", async () => {
		await withGitlabRepo({}, async (base) => {
			const overview = await settledOverview(
				base,
				async (url) =>
					(await (
						await fetch(new URL("/api/overview", url))
					).json()) as Overview,
			);
			const project = overview.projects.find(
				(item) => item.name === gitlabRepo,
			);
			expect(project?.error ?? null).toBeNull();
			expect(project?.tracker).toBe("gitlab");
			const report = await reportOf(base, gitlabRepo);
			const states = Object.fromEntries(
				[...report.tickets, ...report.doneTickets].map((ticket) => [
					ticket.key,
					ticket.state,
				]),
			);
			expect(states).toEqual({
				[key(1)]: "backlog",
				[key(2)]: "backlog",
				[key(3)]: "backlog",
				[key(4)]: "backlog",
				[key(5)]: "backlog",
				[key(6)]: "awaitingMerge",
				[key(7)]: "inProgress",
				[key(8)]: "inProgress",
				[key(9)]: "done",
				[`${gitlabRepo}!3`]: "inReview",
			});
			expect(viewOf(report, key(6)).url).toBe(
				`https://gitlab.com/${gitlabRepo}/-/work_items/6`,
			);
		});
	});

	test("groups its tickets by milestone as workstreams", async () => {
		await withGitlabRepo({}, async (base) => {
			const report = await reportOf(base, gitlabRepo);
			const workstreams = Object.fromEntries(
				report.tickets.map((ticket) => [ticket.key, ticket.workstream]),
			);
			for (const iid of [1, 2, 3, 4, 5, 6]) {
				expect(workstreams[key(iid)]).toBe("Workstream A");
			}
			for (const iid of [7, 8]) {
				expect(workstreams[key(iid)]).not.toBe("Workstream A");
			}
		});
	});

	test("frames its sub-tickets under their parent ticket", async () => {
		await withGitlabRepo({}, async (base) => {
			const report = await reportOf(base, gitlabRepo);
			expect(viewOf(report, key(2)).parent).toBe(key(1));
			expect(viewOf(report, key(3)).parent).toBe(key(1));
			expect(viewOf(report, key(1)).subTickets).toBe(2);
		});
	});

	test("shows a GitLab blocker link from either end", async () => {
		await withGitlabRepo(
			{ linkTypes: { 5: { 4: "is_blocked_by" }, 4: { 5: "blocks" } } },
			async (base) => {
				const report = await reportOf(base, gitlabRepo);
				expect(viewOf(report, key(5)).blockers).toEqual([key(4)]);
				expect(viewOf(report, key(4)).blockers).toEqual([]);
				expect(report.graphLinks).toContainEqual(
					expect.objectContaining({
						from: expect.objectContaining({ key: key(4), tracker: "gitlab" }),
						to: expect.objectContaining({ key: key(5), tracker: "gitlab" }),
					}),
				);
			},
		);
	});

	test("reads a relates_to link as no blocker", async () => {
		await withGitlabRepo({}, async (base) => {
			const report = await reportOf(base, gitlabRepo);
			expect(viewOf(report, key(5)).blockers).toEqual([]);
		});
	});
});

describe("a tracked GitLab repo in a subgroup", () => {
	const nested = "AbysmalBiscuit/tools/project-flow-scratch";

	test("a PR that closes a ticket by its subgroup key links the ticket", async () => {
		await withServer(
			gitlabFake({
				repo: nested,
				open: {
					1: {
						description: `Closes ${nested}#6`,
						source_branch: "linked-change",
					},
				},
			}),
			3600,
			async (base) => {
				const report = await reportOf(base, nested);
				expect(viewOf(report, `${nested}#6`)).toMatchObject({
					state: "awaitingMerge",
					pullUrl: `https://gitlab.com/${gitlabRepo}/-/merge_requests/1`,
				});
			},
			[{ tracker: "gitlab", repo: nested }],
			gitlabEnv,
		);
	});
});

describe("a GitLab ticket across trackers", () => {
	const blockedLinear = (description: string) => ({
		id: "issue-1",
		identifier: "WID-1",
		title: "Linear ticket 1",
		description,
		updatedAt: "2026-10-01T00:00:00.000Z",
		state: { type: "unstarted" },
		attachments: { nodes: [] },
	});

	test.each([
		["a GitLab key with #", `${gitlabRepo}#4`],
		["a GitLab ticket URL", `https://gitlab.com/${gitlabRepo}/-/issues/4`],
	])(
		"%s in a Linear ticket resolves to the GitLab ticket",
		async (_, named) => {
			await withServer(
				linearWithGitlab([blockedLinear(`Blocked by: ${named}`)], gitlabFake()),
				3600,
				async (base) => {
					const report = await reportOf(base, linearName);
					const ticket = viewOf(report, "WID-1");
					expect(ticket.blockedBy).toEqual([
						{
							tracker: "gitlab",
							project: gitlabRepo,
							key: key(4),
							title: "fix(app): blocker ticket",
						},
					]);
				},
				[linearPin, gitlabPin],
				gitlabEnv,
			);
		},
	);
});
