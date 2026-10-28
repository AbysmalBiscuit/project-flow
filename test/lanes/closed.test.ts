import { describe, expect, test } from "bun:test";

import recordedRepoRead from "../fixtures/github-repo-read.json";
import { urlOf } from "../support/fetch.ts";
import {
	recordedDiscovery,
	repo as githubRepo,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import {
	githubIssue,
	linearIssue,
	linearSlug,
	linearStates,
	linearTeam,
	type OverviewBody,
	plainRepo,
	projectOf,
	recordedFactoryLabelPage,
	repoFetch,
	withApp,
} from "./_support.ts";

describe("tracker lanes", () => {
	test("a closed factory ticket sits in Done", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			async (input, init) => {
				const url = urlOf(input);
				if (
					url.startsWith(`https://api.github.com/repos/${githubRepo}/labels?`)
				) {
					return recordedFactoryLabelPage();
				}
				return repoFetch({
					[githubRepo]: [
						githubIssue(4, "Ship the job", githubRepo, {
							state: "closed",
							state_reason: "completed",
							labels: [{ name: "ready" }],
						}),
					],
				})(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const project = overview.projects.find(
					(item) => item.name === githubRepo,
				);
				const ticket = project?.tickets.find(
					(item) => item.key === "acme/widget#4",
				);
				expect(ticket?.status ?? ticket?.lane).toBe("Done");
				expect(ticket?.statusType).toBe("done");
				expect(project?.statusTypes?.done).toBe(1);
				expect(project?.statusTypes?.backlog).toBe(0);
			},
		);
	});

	test("a closed ticket with no matching status sits in Done", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			async (input, init) => {
				const url = urlOf(input);
				if (
					url.startsWith(`https://api.github.com/repos/${githubRepo}/labels?`)
				) {
					return recordedFactoryLabelPage();
				}
				return repoFetch({
					[githubRepo]: [
						githubIssue(5, "Closed without a done label", githubRepo, {
							state: "closed",
							state_reason: "completed",
						}),
					],
				})(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const ticket = overview.projects
					.find((item) => item.name === githubRepo)
					?.tickets.find((item) => item.key === "acme/widget#5");
				expect(ticket?.status ?? ticket?.lane).toBe("Done");
				expect(ticket?.statusType).toBe("done");
			},
		);
	});

	test("a closed Linear ticket in Released sits in Done", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
					teams: { nodes: [linearTeam] },
				},
				issues: [
					linearIssue("WID-20", "Released the list", {
						id: "st-released",
						name: "Released",
						type: "completed",
						color: "#4CB782",
					}),
				],
				states: [
					...linearStates,
					{
						id: "st-released",
						name: "Released",
						type: "completed",
						position: 5.5,
						color: "#4CB782",
					},
				],
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(report.statuses.map((lane) => lane.name)).toContain("Released");
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const ticket = overview.projects
					.find((item) => item.name === "Widget launch")
					?.tickets.find((item) => item.key === "WID-20");
				expect(ticket?.status ?? ticket?.lane).toBe("Released");
				expect(ticket?.statusType).toBe("done");
			},
		);
	});

	test("an uppercase NOT_PLANNED reason from a recorded GraphQL payload sits in Dropped", async () => {
		const recorded = structuredClone(recordedRepoRead) as {
			data: {
				repository: {
					nameWithOwner: string;
					issues: { nodes: Record<string, unknown>[] };
					openPullRequests: { nodes: unknown[] };
					mergedPullRequests: { nodes: unknown[] };
				};
			};
		};
		const issue = recorded.data.repository.issues.nodes[0];
		if (issue !== undefined) {
			issue.number = 12;
			issue.title = "Not planned";
			issue.state = "CLOSED";
			issue.stateReason = "NOT_PLANNED";
		}
		recorded.data.repository.nameWithOwner = plainRepo;
		recorded.data.repository.issues.nodes = issue === undefined ? [] : [issue];
		recorded.data.repository.openPullRequests.nodes = [];
		recorded.data.repository.mergedPullRequests.nodes = [];
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: plainRepo }] }),
			async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					urlOf(input) === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					return Response.json(recorded);
				}
				if (urlOf(input) === "https://api.github.com/user") {
					return Response.json({ login: "lev" });
				}
				return unrecorded(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const project = overview.projects.find(
					(item) => item.name === plainRepo,
				);
				expect(
					project?.tickets.find((item) => item.key === "acme/plain#12"),
				).toEqual(
					expect.objectContaining({ lane: "Dropped", statusType: "dropped" }),
				);
				expect(project?.statusTypes?.dropped).toBe(1);
				expect(project?.statusTypes?.done).toBe(0);
			},
		);
	});
});
