import { describe, expect, test } from "bun:test";

import type { Fetch } from "../../src/fetch.ts";
import { goodPoll, withServer } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	recordedDiscovery,
	recordedOrEmpty,
	unrecorded,
} from "../support/github.ts";
import {
	type OverviewBody,
	readOverview,
	settledOverview,
	type ShownTicket,
} from "../support/reads.ts";
import { repoReadIssues } from "../support/repo-read.ts";
import { counts } from "./_support.ts";

const linearProject = "widget-launch";

function linearTicket(number: number): ShownTicket {
	return {
		key: `WID-${number}`,
		title: "",
		state: "backlog",
		blockers: [],
		lane: "Backlog",
		statusType: "backlog",
		enteredStateAt: "2026-04-01T00:00:00.000Z",
		updatedAt: "2026-04-01T00:00:00.000Z",
	};
}

function linearIssue(id: string): Record<string, unknown> {
	return {
		identifier: `WID-${id}`,
		updatedAt: "2026-04-01T00:00:00.000Z",
		state: { type: "backlog" },
		attachments: { nodes: [] },
	};
}

function linearPage(nodes: Record<string, unknown>[]): string {
	return JSON.stringify({
		data: {
			issues: {
				nodes,
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	});
}

type IssueFilter = {
	project?: { id?: { eq?: string } };
	updatedAt?: { gte?: string };
	or?: {
		updatedAt?: { gte?: string };
		comments?: { updatedAt?: { gte?: string } };
	}[];
};

function linearIssueFilter(body: string): IssueFilter | null {
	const parsed = JSON.parse(body) as {
		query?: string;
		variables?: { filter?: IssueFilter; since?: string | null };
	};
	if (!parsed.query?.includes("ProjectIssues")) {
		return null;
	}
	return parsed.variables?.filter ?? null;
}

function linearListSince(body: string): string | null {
	const filter = linearIssueFilter(body);
	return (
		filter?.updatedAt?.gte ??
		filter?.or?.find((branch) => branch.updatedAt?.gte !== undefined)?.updatedAt
			?.gte ??
		null
	);
}

function linearPinFetch(requests: string[]): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (url === "https://api.linear.app/graphql") {
			const body =
				typeof init?.body === "string" ? init.body : JSON.stringify(init?.body);
			const parsed = JSON.parse(body) as { query?: string };
			if (parsed.query?.includes("viewer")) {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			if (parsed.query?.includes("ProjectByPin")) {
				return new Response(
					JSON.stringify({
						data: {
							projects: {
								nodes: [
									{
										id: "project-1",
										name: linearProject,
										slugId: linearProject,
									},
								],
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			const filter = linearIssueFilter(body);
			if (filter !== null) {
				requests.push(body);
			}
			if (filter !== null && requests.length === 2) {
				return new Response("recorded failure", { status: 500 });
			}
			return new Response(linearPage([linearIssue("1")]), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return unrecorded(input);
	};
}

describe("live updates", () => {
	test("a ticket that left a Linear project leaves its card after the next full poll", async () => {
		const requests: string[] = [];
		let polls = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				const body =
					typeof init?.body === "string"
						? init.body
						: JSON.stringify(init?.body);
				const parsed = JSON.parse(body) as { query?: string };
				if (parsed.query?.includes("viewer")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (parsed.query?.includes("ProjectByPin")) {
					return new Response(
						JSON.stringify({
							data: {
								projects: {
									nodes: [
										{
											id: "project-1",
											name: linearProject,
											slugId: linearProject,
										},
									],
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				requests.push(body);
				polls += 1;
				const nodes =
					polls === 1
						? [linearIssue("1"), linearIssue("2")]
						: [linearIssue("2")];
				return new Response(linearPage(nodes), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base, advance) => {
				const first = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(first.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
					"WID-2",
				]);
				advance(10 * 60 * 1000);
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				const body = await settledOverview(base, readOverview);
				expect(requests).toHaveLength(2);
				expect(requests.map(linearListSince)).toEqual([null, null]);
				const filters = requests
					.map(linearIssueFilter)
					.filter((filter) => filter !== null);
				expect(filters[1]?.updatedAt).toBeUndefined();
				expect(body.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-2",
				]);
				expect(body.error).toBeNull();
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

	test("a full Linear poll omits updatedAt and a later poll filters on it", async () => {
		const requests: string[] = [];
		await withServer(
			linearPinFetch(requests),
			3600,
			async (base) => {
				const first = await fetch(new URL("/api/overview", base));
				const firstBody = (await first.json()) as OverviewBody;
				expect(firstBody.projects).toEqual([
					counts(linearProject, 1, 0, "linear", [linearTicket(1)]),
				]);
				expect(firstBody.error).toBeNull();
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				await settledOverview(base, readOverview);
				const filters = requests
					.map(linearIssueFilter)
					.filter((filter) => filter !== null);
				expect(filters[0]).toEqual({
					project: { id: { eq: "project-1" } },
				});
				expect(filters[0]?.updatedAt).toBeUndefined();
				expect(filters[1]).toEqual({
					project: { id: { eq: "project-1" } },
					or: [
						{ updatedAt: { gte: goodPoll } },
						{ comments: { updatedAt: { gte: goodPoll } } },
					],
				});
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

	test("a failed Linear incremental poll is requested again with the same since", async () => {
		const requests: string[] = [];
		await withServer(
			linearPinFetch(requests),
			3600,
			async (base) => {
				const failed = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(failed.status).toBe(204);
				const failedBody = await settledOverview(base, readOverview);
				expect(failedBody.projects).toEqual([
					counts(
						linearProject,
						1,
						0,
						"linear",
						[linearTicket(1)],
						goodPoll,
						failedBody.projects[0]?.error ?? null,
					),
				]);
				expect(failedBody.projects[0]?.error).toContain("HTTP 500");
				expect(failedBody.error).toBeNull();
				expect(failedBody.fetchedAt).toBe(goodPoll);
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				const body = await settledOverview(base, readOverview);
				const lists = requests.map(linearListSince);
				expect(lists).toEqual([null, goodPoll, goodPoll]);
				expect(body.projects).toEqual([
					counts(
						linearProject,
						1,
						0,
						"linear",
						[linearTicket(1)],
						"2026-04-01T12:00:02.000Z",
					),
				]);
				expect(body.error).toBeNull();
				expect(body.fetchedAt).toBe("2026-04-01T12:00:02.000Z");
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

	test("a found Linear project stays after an incremental poll with no changes", async () => {
		const requests: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body =
				typeof init?.body === "string" ? init.body : JSON.stringify(init?.body);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("MemberProjects")) {
					return new Response(
						JSON.stringify({
							data: {
								viewer: { id: "lev" },
								projects: {
									nodes: [
										{
											id: "project-1",
											name: "Widget launch",
											slugId: linearProject,
											updatedAt: "2026-04-01T00:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (body.includes("viewer")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (body.includes("ProjectByPin")) {
					return new Response(
						JSON.stringify({
							data: {
								projects: {
									nodes: [
										{
											id: "project-1",
											name: "Widget launch",
											slugId: linearProject,
										},
									],
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				const filter = linearIssueFilter(body);
				if (filter !== null) {
					requests.push(body);
					const nodes = requests.length === 1 ? [linearIssue("1")] : [];
					return new Response(linearPage(nodes), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const first = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(first.projects.map((project) => project.name)).toEqual([
					"Widget launch",
				]);
				expect(first.projects[0]?.tracker).toBe("linear");
				expect(first.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
				]);
				expect(first.error).toBeNull();
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const body = await settledOverview(base, readOverview);
				expect(requests.map(linearListSince)).toEqual([null, goodPoll]);
				expect(body.projects.map((project) => project.name)).toEqual([
					"Widget launch",
				]);
				expect(body.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
				]);
				expect(body.error).toBeNull();
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

	test("a Linear progress comment edited in place reaches the next incremental poll", async () => {
		const requests: string[] = [];
		const createdAt = "2026-04-01T08:00:00.000Z";
		const firstEdit = "2026-04-01T10:04:00.000Z";
		const editedAt = "2026-04-01T12:05:10.000Z";
		const progress = (stage: string): Record<string, unknown> => ({
			id: "comment-progress",
			body: `**Workcell progress**\n\n- stage ${stage}: implementing`,
			createdAt,
			updatedAt: stage === "1" ? firstEdit : editedAt,
			user: { displayName: "workcell" },
			reactions: [],
		});
		const issue = (stage: string): Record<string, unknown> => ({
			...linearIssue("1"),
			title: "Live run",
			// Assume a comment edit leaves the issue updatedAt.
			updatedAt: createdAt,
			comments: {
				nodes: [progress(stage)],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		});
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				const body =
					typeof init?.body === "string"
						? init.body
						: JSON.stringify(init?.body);
				const parsed = JSON.parse(body) as { query?: string };
				if (parsed.query?.includes("viewer")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (parsed.query?.includes("ProjectByPin")) {
					return new Response(
						JSON.stringify({
							data: {
								projects: {
									nodes: [
										{
											id: "project-1",
											name: linearProject,
											slugId: linearProject,
										},
									],
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				const filter = linearIssueFilter(body);
				if (filter === null) {
					return new Response("not recorded", { status: 404 });
				}
				requests.push(body);
				const since = linearListSince(body);
				const nodes =
					filter.or?.some((branch) => branch.comments !== undefined) === true
						? [issue("4")]
						: since === null
							? [issue("1")]
							: [];
				return new Response(linearPage(nodes), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base, advance) => {
				const firstOverview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const first = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(linearProject)}`, base),
					)
				).json()) as { tickets: ShownTicket[] };
				expect(first.tickets[0]).toMatchObject({
					key: "WID-1",
					state: "inProgress",
					run: { status: "running", stage: "stage 1" },
				});
				expect(first.tickets[0]?.chips ?? []).not.toContain("Run failed");
				expect(firstOverview.error).toBeNull();
				advance(5 * 60 * 1000);
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const body = await settledOverview(base, readOverview);
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(linearProject)}`, base),
					)
				).json()) as { tickets: ShownTicket[] };
				const ticket = report.tickets[0];
				expect(ticket).toMatchObject({
					key: "WID-1",
					state: "inProgress",
					run: { status: "running", stage: "stage 4" },
				});
				expect(ticket?.chips ?? []).not.toContain("Run failed");
				expect(body.projects[0]?.tickets[0]?.state).toBe("inProgress");
				const needsYou = (await (
					await fetch(new URL("/api/needs-you", base))
				).json()) as { key: string; reason: string }[];
				expect(needsYou.filter((row) => row.key === "WID-1")).toEqual([]);
				expect(body.error).toBeNull();
				expect(requests.map(linearListSince)).toEqual([null, goodPoll]);
				const commentFilters = requests
					.map(linearIssueFilter)
					.filter((filter) =>
						filter?.or?.some((branch) => branch.comments !== undefined),
					);
				expect(commentFilters).toHaveLength(1);
				expect(commentFilters[0]?.updatedAt).toBeUndefined();
				expect(commentFilters[0]?.or).toEqual([
					{ updatedAt: { gte: goodPoll } },
					{ comments: { updatedAt: { gte: goodPoll } } },
				]);
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

	test("an incremental Linear poll keeps stored PRs of untouched tickets", async () => {
		const requests: string[] = [];
		let polls = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.includes("/pulls?state=closed") || url.includes("/labels?")) {
				return new Response("[]", {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url === "https://api.github.com/graphql") {
				const sent = typeof init?.body === "string" ? init.body : "";
				if (sent.includes("query RepoRead")) {
					return new Response(
						JSON.stringify(
							repoReadIssues("acme", "widget", [], {
								pulls: [
									{
										number: 7,
										title: "Stored pull",
										url: "https://github.com/acme/widget/pull/7",
										isDraft: true,
										body: "closes acme/widget#1",
										state: "OPEN",
										mergedAt: null,
										headRefName: "wid-1",
										headRefOid: "sha-7",
										closingIssuesReferences: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										reviews: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										comments: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										reactions: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
									},
								],
							}),
						),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
			}
			if (url.startsWith("https://api.github.com/repos/acme/widget/pulls/7")) {
				requests.push(url);
				return new Response(
					JSON.stringify({
						number: 7,
						title: "Stored pull",
						html_url: "https://github.com/acme/widget/pull/7",
						draft: true,
						body: "closes acme/widget#1",
						head: { ref: "wid-1", sha: "sha-7" },
						state: "open",
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				const body =
					typeof init?.body === "string"
						? init.body
						: JSON.stringify(init?.body);
				const parsed = JSON.parse(body) as { query?: string };
				if (parsed.query?.includes("viewer")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (parsed.query?.includes("ProjectByPin")) {
					return new Response(
						JSON.stringify({
							data: {
								projects: {
									nodes: [
										{
											id: "project-1",
											name: linearProject,
											slugId: linearProject,
										},
									],
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				requests.push(body);
				polls += 1;
				const nodes =
					polls === 1
						? [
								{
									...linearIssue("1"),
									title: "Linear ticket 1",
									attachments: {
										nodes: [
											{
												url: "https://github.com/acme/widget/pull/7",
												title: "Stored pull",
												sourceType: "github",
											},
										],
									},
								},
								linearIssue("2"),
							]
						: [linearIssue("2")];
				return new Response(linearPage(nodes), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const first = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(
					first.projects[0]?.tickets.map((ticket) => ticket.state),
				).toEqual(["inProgress", "backlog"]);
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const body = await settledOverview(base, readOverview);
				expect(body.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
					"WID-2",
				]);
				expect(body.projects[0]?.tickets.map((ticket) => ticket.state)).toEqual(
					["inProgress", "backlog"],
				);
				expect(requests.filter((url) => url.includes("/pulls/7"))).toHaveLength(
					1,
				);
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});
});
