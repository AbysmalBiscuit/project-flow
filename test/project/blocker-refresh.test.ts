import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../../src/domain.ts";
import recordedClosedBlockers from "../fixtures/github-closed-blockers.json";
import { githubRepo, issue, withApp } from "../project-harness.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	recordedDiscovery,
	unrecorded,
} from "../support/github.ts";
import { settledOverview } from "../support/reads.ts";
import { githubIssueNode, repoReadIssues } from "../support/repo-read.ts";

describe("GET /api/projects/:name", () => {
	test("a recorded closed native blocker drops off the project response", async () => {
		type RecordedIssue = Omit<
			(typeof recordedClosedBlockers.issues)[number],
			"stateReason" | "closedAt"
		> & {
			stateReason: string | null;
			closedAt: string | null;
		};
		const recorded: RecordedIssue[] = structuredClone(
			recordedClosedBlockers.issues,
		);
		let closed = false;
		const nodes = (): RecordedIssue[] => {
			if (!closed) {
				return structuredClone(recorded);
			}
			return structuredClone(recorded).map((node) => {
				if (node.number !== 216 && node.number !== 245 && node.number !== 246) {
					return node;
				}
				if (node.number === 216) {
					return {
						...node,
						state: "CLOSED",
						stateReason: "COMPLETED",
						closedAt: "2026-08-18T13:00:00Z",
						updatedAt: "2026-08-18T13:00:00Z",
					};
				}
				return {
					...node,
					updatedAt: "2026-08-18T13:00:00Z",
					blockedBy: {
						...node.blockedBy,
						nodes: node.blockedBy.nodes.map((blocker) =>
							blocker.number === 216
								? { ...blocker, state: "CLOSED" }
								: blocker,
						),
					},
				};
			});
		};
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					const sent = JSON.parse(body) as {
						variables?: {
							owner?: string;
							name?: string;
							since?: string | null;
						};
					};
					const owner = sent.variables?.owner ?? "acme";
					const name = sent.variables?.name ?? "widget";
					if (`${owner}/${name}` !== githubRepo) {
						return unrecorded(input);
					}
					const listed =
						sent.variables?.since === undefined || sent.variables.since === null
							? nodes()
							: nodes().filter((node) => [216, 245, 246].includes(node.number));
					return new Response(
						JSON.stringify(repoReadIssues(owner, name, listed)),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query BlockerStates")
				) {
					const asked = [...body.matchAll(/issue\(number: (\d+)\)/g)].map(
						(match) => Number(match[1]),
					);
					const repository: Record<string, unknown> = {};
					const byNumber = new Map(
						nodes().map((node) => [node.number, node.blockedBy]),
					);
					for (const [index, number] of asked.entries()) {
						const blockedBy = byNumber.get(number);
						if (blockedBy === undefined) {
							continue;
						}
						repository[`i${index}`] = { blockedBy };
					}
					return new Response(JSON.stringify({ data: { repository } }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				if (url === "https://api.github.com/user") {
					return Response.json({ login: "lev" });
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const projectUrl = new URL(
					`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
					base,
				);
				const before = (await (
					await fetch(projectUrl)
				).json()) as ProjectReport;
				expect(
					before.tickets.find((item) => item.key === `${githubRepo}#245`)
						?.blockers,
				).toEqual([`${githubRepo}#216`]);
				closed = true;
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await settledOverview(
					base,
					async (url) =>
						(await (await fetch(new URL("/api/overview", url))).json()) as {
							polling?: true;
						},
				);
				const report = (await (
					await fetch(projectUrl)
				).json()) as ProjectReport;
				const onlyClosed = report.tickets.find(
					(item) => item.key === `${githubRepo}#245`,
				);
				expect(onlyClosed?.blockers).toEqual([]);
				expect(onlyClosed?.blocked).toBeUndefined();
				expect(onlyClosed?.chips ?? []).not.toContain("Blocked");
				expect(onlyClosed?.links).toEqual([
					{ key: `${githubRepo}#216`, done: true },
				]);
				const both = report.tickets.find(
					(item) => item.key === `${githubRepo}#246`,
				);
				expect(both?.blockers).toEqual([`${githubRepo}#188`]);
				expect(both?.blocked).toBe(true);
				expect(both?.chips).toContain("Blocked");
				expect(both?.links?.map((link) => link.key)).toEqual([
					`${githubRepo}#216`,
					`${githubRepo}#188`,
				]);
				const summary = report.sections.find(
					(section) => section.id === "summary",
				);
				expect(summary?.text).toContain("1 blocked");
				const filtered = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						pinned: [{ tracker: "github", repo: githubRepo }],
						projectViews: {
							[githubRepo]: { blockedOnly: true },
						},
					}),
				});
				expect(filtered.status).toBe(200);
				const held = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(held.tickets.map((item) => item.key)).toEqual([
					`${githubRepo}#246`,
				]);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}`, base),
				);
				expect(blank.status).toBe(404);
				const spaced = await fetch(
					new URL(`/api/projects/${encodeURIComponent("  ")}`, base),
				);
				expect(spaced.status).toBe(404);
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("a closed blocker refresh keeps the fresh ticket fields", async () => {
		const blocker = (state: "OPEN" | "CLOSED") =>
			issue(
				216,
				"Closed native blocker",
				state === "CLOSED"
					? { state: "closed", state_reason: "completed" }
					: {},
				githubRepo,
			);
		const waiting = (title: string, updatedAt: string) =>
			issue(245, title, { updated_at: updatedAt }, githubRepo);
		const relation = (state: "OPEN" | "CLOSED") => ({
			number: 216,
			title: "Closed native blocker",
			state,
			repository: { nameWithOwner: githubRepo },
		});
		const pageInfo = { hasNextPage: false, endCursor: null };
		let closed = false;
		const nodes = () => [
			{
				...githubIssueNode(
					waiting(
						closed ? "Draw the closed board" : "Draw the board",
						closed ? "2026-08-18T13:00:00.000Z" : "2026-08-18T12:00:00.000Z",
					),
				),
				blockedBy: {
					nodes: [relation(closed ? "CLOSED" : "OPEN")],
					pageInfo,
				},
			},
			githubIssueNode(blocker(closed ? "CLOSED" : "OPEN")),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					const sent = JSON.parse(body) as {
						variables?: {
							owner?: string;
							name?: string;
							since?: string | null;
						};
					};
					const owner = sent.variables?.owner ?? "acme";
					const name = sent.variables?.name ?? "widget";
					if (`${owner}/${name}` !== githubRepo) {
						return unrecorded(input);
					}
					const listed =
						sent.variables?.since === undefined || sent.variables.since === null
							? nodes()
							: nodes().filter(
									(node) => node.number === 245 || node.number === 216,
								);
					return new Response(
						JSON.stringify(repoReadIssues(owner, name, listed)),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query BlockerStates")
				) {
					const sent = JSON.parse(body) as {
						query?: string;
						variables?: Record<string, string | null>;
					};
					const aliases = [
						...(sent.query ?? "").matchAll(/i(\d+): issue\(number: (\d+)\)/g),
					];
					const repository: Record<string, unknown> = {};
					for (const match of aliases) {
						const index = match[1];
						const number = Number(match[2]);
						if (index === undefined || number !== 245) {
							continue;
						}
						repository[`i${index}`] = {
							blockedBy: {
								nodes: [relation(closed ? "CLOSED" : "OPEN")],
								pageInfo,
							},
						};
					}
					return new Response(JSON.stringify({ data: { repository } }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				if (url === "https://api.github.com/user") {
					return Response.json({ login: "lev" });
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const projectUrl = new URL(
					`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
					base,
				);
				const before = (await (
					await fetch(projectUrl)
				).json()) as ProjectReport;
				expect(
					before.tickets.find((item) => item.key === `${githubRepo}#245`)
						?.title,
				).toBe("Draw the board");
				closed = true;
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await settledOverview(
					base,
					async (url) =>
						(await (await fetch(new URL("/api/overview", url))).json()) as {
							polling?: true;
						},
				);
				const report = (await (
					await fetch(projectUrl)
				).json()) as ProjectReport;
				const card = report.tickets.find(
					(item) => item.key === `${githubRepo}#245`,
				);
				expect(card?.title).toBe("Draw the closed board");
				expect(card?.updatedAt).toBe("2026-08-18T13:00:00.000Z");
				expect(card?.blockers).toEqual([]);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}`, base),
				);
				expect(blank.status).toBe(404);
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("a failed blocker refresh reaches the poll error", async () => {
		const relation = {
			number: 216,
			title: "Native blocker",
			state: "OPEN",
			repository: { nameWithOwner: githubRepo },
		};
		const pageInfo = { hasNextPage: false, endCursor: null };
		const nodes = [
			{
				...githubIssueNode(issue(245, "Draw the board", {}, githubRepo)),
				blockedBy: { nodes: [relation], pageInfo },
			},
			githubIssueNode(issue(216, "Native blocker", {}, githubRepo)),
		];
		let failRefresh = false;
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query BlockerStates")
				) {
					if (failRefresh) {
						return new Response("blocker states unavailable", { status: 500 });
					}
					return new Response(
						JSON.stringify({
							data: {
								repository: {
									i0: { blockedBy: { nodes: [relation], pageInfo } },
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					const sent = JSON.parse(body) as {
						variables?: { owner?: string; name?: string };
					};
					const owner = sent.variables?.owner ?? "acme";
					const name = sent.variables?.name ?? "widget";
					return new Response(
						JSON.stringify(repoReadIssues(owner, name, nodes)),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				if (url === "https://api.github.com/user") {
					return Response.json({ login: "lev" });
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const overviewUrl = new URL("/api/overview", base);
				const before = (await (await fetch(overviewUrl)).json()) as {
					error: string | null;
					projects: { error: string | null }[];
				};
				expect(before.error).toBeNull();
				expect(before.projects[0]?.error).toBeNull();
				failRefresh = true;
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const after = await settledOverview(
					base,
					async () =>
						(await (await fetch(overviewUrl)).json()) as typeof before & {
							polling?: true;
						},
				);
				expect(after.projects[0]?.error).toContain("GitHub read repo failed");
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("")}`, base),
				);
				expect(blank.status).toBe(404);
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("a blocker on a later page stays in the refresh", async () => {
		const pageInfo = (hasNextPage: boolean, endCursor: string | null) => ({
			hasNextPage,
			endCursor,
		});
		const relation = (number: number, title: string) => ({
			number,
			title,
			state: "OPEN",
			repository: { nameWithOwner: githubRepo },
		});
		const nodes = [
			{
				...githubIssueNode(issue(245, "Draw the board", {}, githubRepo)),
				blockedBy: {
					nodes: [relation(216, "First page blocker")],
					pageInfo: pageInfo(false, null),
				},
			},
			githubIssueNode(issue(216, "First page blocker", {}, githubRepo)),
			githubIssueNode(issue(188, "Later page blocker", {}, githubRepo)),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					const sent = JSON.parse(body) as {
						variables?: {
							owner?: string;
							name?: string;
							since?: string | null;
						};
					};
					const owner = sent.variables?.owner ?? "acme";
					const name = sent.variables?.name ?? "widget";
					const listed =
						sent.variables?.since === undefined || sent.variables.since === null
							? nodes
							: [];
					return new Response(
						JSON.stringify(repoReadIssues(owner, name, listed)),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query BlockerStates")
				) {
					const asked = [...body.matchAll(/issue\(number: (\d+)\)/g)].map(
						(match) => Number(match[1]),
					);
					const sent = JSON.parse(body) as {
						variables?: Record<string, string | null>;
					};
					const repository: Record<string, unknown> = {};
					for (const [index, number] of asked.entries()) {
						if (number !== 245) {
							continue;
						}
						const after = sent.variables?.[`after${index}`];
						repository[`i${index}`] =
							after === "cursor-2"
								? {
										blockedBy: {
											nodes: [relation(188, "Later page blocker")],
											pageInfo: pageInfo(false, null),
										},
									}
								: {
										blockedBy: {
											nodes: [relation(216, "First page blocker")],
											pageInfo: pageInfo(true, "cursor-2"),
										},
									};
					}
					return new Response(JSON.stringify({ data: { repository } }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				if (url === "https://api.github.com/user") {
					return Response.json({ login: "lev" });
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const projectUrl = new URL(
					`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
					base,
				);
				const before = (await (
					await fetch(projectUrl)
				).json()) as ProjectReport;
				expect(
					before.tickets.find((item) => item.key === `${githubRepo}#245`)
						?.blockers,
				).toEqual([`${githubRepo}#216`]);
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await settledOverview(
					base,
					async (url) =>
						(await (await fetch(new URL("/api/overview", url))).json()) as {
							polling?: true;
						},
				);
				const report = (await (
					await fetch(projectUrl)
				).json()) as ProjectReport;
				expect(
					report.tickets.find((item) => item.key === `${githubRepo}#245`)
						?.blockers,
				).toEqual([`${githubRepo}#216`, `${githubRepo}#188`]);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}`, base),
				);
				expect(blank.status).toBe(404);
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("a reopened blocker stays open over a held closed reference", async () => {
		const gate = (state: "open" | "closed") =>
			issue(
				216,
				"Native blocker",
				state === "closed"
					? { state: "closed", state_reason: "completed" }
					: { state: "open", state_reason: "reopened" },
				githubRepo,
			);
		const waiting = issue(245, "Draw the board", {}, githubRepo);
		const relation = (state: "OPEN" | "CLOSED") => ({
			number: 216,
			title: "Native blocker",
			state,
			repository: { nameWithOwner: githubRepo },
		});
		const pageInfo = { hasNextPage: false, endCursor: null };
		let reopened = false;
		const nodes = () => [
			{
				...githubIssueNode(waiting),
				blockedBy: {
					nodes: [relation("CLOSED")],
					pageInfo,
				},
			},
			githubIssueNode(gate(reopened ? "open" : "closed")),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					const sent = JSON.parse(body) as {
						variables?: {
							owner?: string;
							name?: string;
							since?: string | null;
						};
					};
					const owner = sent.variables?.owner ?? "acme";
					const name = sent.variables?.name ?? "widget";
					if (`${owner}/${name}` !== githubRepo) {
						return unrecorded(input);
					}
					const listed =
						sent.variables?.since === undefined || sent.variables.since === null
							? nodes()
							: nodes().filter((node) => node.number === 216);
					return new Response(
						JSON.stringify(repoReadIssues(owner, name, listed)),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query BlockerStates")
				) {
					const asked = [...body.matchAll(/issue\(number: (\d+)\)/g)].map(
						(match) => Number(match[1]),
					);
					const repository: Record<string, unknown> = {};
					for (const [index, number] of asked.entries()) {
						if (number !== 245) {
							continue;
						}
						repository[`i${index}`] = {
							blockedBy: {
								nodes: [relation("CLOSED")],
								pageInfo,
							},
						};
					}
					return new Response(JSON.stringify({ data: { repository } }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				if (url === "https://api.github.com/user") {
					return Response.json({ login: "lev" });
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const projectUrl = new URL(
					`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
					base,
				);
				const before = (await (
					await fetch(projectUrl)
				).json()) as ProjectReport;
				expect(
					before.tickets.find((item) => item.key === `${githubRepo}#245`)
						?.blockers,
				).toEqual([]);
				reopened = true;
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await settledOverview(
					base,
					async (url) =>
						(await (await fetch(new URL("/api/overview", url))).json()) as {
							polling?: true;
						},
				);
				const report = (await (
					await fetch(projectUrl)
				).json()) as ProjectReport;
				const card = report.tickets.find(
					(item) => item.key === `${githubRepo}#245`,
				);
				expect(card?.blockers).toEqual([`${githubRepo}#216`]);
				expect(card?.blocked).toBe(true);
				expect(
					card?.links?.find((link) => link.key === `${githubRepo}#216`)?.done,
				).toBe(false);
				const heldClosed = report.graphLinks.find(
					(link) =>
						link.from.key === `${githubRepo}#216` &&
						link.to.key === `${githubRepo}#245`,
				);
				expect(heldClosed?.done).toBe(false);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}`, base),
				);
				expect(blank.status).toBe(404);
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});
});
