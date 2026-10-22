import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectViewSettings } from "../src/configuration.ts";
import type { ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { savedProjectView } from "../src/view-settings.ts";
import recordedClosedBlockers from "./fixtures/github-closed-blockers.json";
import {
	githubFetch,
	githubRepo,
	issue,
	linearIssue,
	linearSlug,
	otherRepo,
	page,
	withApp,
} from "./project-harness.ts";
import {
	emptyProjectFields,
	githubIssueNode,
	recordedDiscovery,
	repoReadIssues,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

describe("GET /api/projects/:name", () => {
	test("each ticket lists its blockers, outside blockers and the open tickets it blocks", async () => {
		const gate = issue(8, "Open the gate", { body: "Blocks: #2" }, githubRepo);
		const drawn = issue(2, "feat(ux): draw the nodes", {
			body: `Blocked by: #8\nBlocked by: ${otherRepo}#9`,
		});
		const held = issue(
			11,
			"Hold the platform",
			{ body: `Blocked by: ${githubRepo}#2` },
			otherRepo,
		);
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch(
				[issue(1, "Ship the map"), drawn, gate],
				[issue(9, "Platform gate", {}, otherRepo), held],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const drawnView = report.tickets.find(
					(item) => item.key === `${githubRepo}#2`,
				);
				expect(drawnView?.blockers).toEqual([
					`${githubRepo}#8`,
					`${otherRepo}#9`,
				]);
				expect(drawnView?.outsideBlockers).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#9`,
						title: "Platform gate",
					},
				]);
				expect(drawnView?.blocks).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#11`,
						title: "Hold the platform",
					},
				]);
				const local = report.tickets.find(
					(item) => item.key === `${githubRepo}#8`,
				);
				expect(local?.outsideBlockers ?? []).toEqual([]);
				expect(local?.blocks).toEqual([
					{
						tracker: "github",
						project: githubRepo,
						key: `${githubRepo}#2`,
						title: "feat(ux): draw the nodes",
					},
				]);
				const empty = report.tickets.find(
					(item) => item.key === `${githubRepo}#1`,
				);
				expect(empty?.blockers).toEqual([]);
				expect(empty?.outsideBlockers ?? []).toEqual([]);
				expect(empty?.blocks ?? []).toEqual([]);
				const spacedBody = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(otherRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					spacedBody.tickets.find((item) => item.key === `${otherRepo}#11`)
						?.blockers,
				).toEqual([`${githubRepo}#2`]);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}`, base),
				);
				expect(blank.status).toBe(404);
			},
		);
	});

	test("a closed blocker stays on the graph and off the blocked count", async () => {
		const done = issue(
			8,
			"Open the gate",
			{ state: "closed", state_reason: "completed" },
			githubRepo,
		);
		const waiting = issue(2, "feat(ux): draw the nodes", {
			body: `Blocked by: #8\nBlocked by: #8\nBlocked by: ${otherRepo}#9\nBlocked by: ${otherRepo}#11\nBlocked by:   `,
		});
		const openGate = issue(1, "Ship the map", {
			body: `Blocked by: ${otherRepo}#11`,
		});
		const closedOutside = issue(
			9,
			"Platform gate",
			{ state: "closed", state_reason: "completed" },
			otherRepo,
		);
		const openOutside = issue(11, "Hold the platform", {}, otherRepo);
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch([openGate, waiting, done], [closedOutside, openOutside]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(
							`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
							base,
						),
					)
				).json()) as ProjectReport;
				const drawn = report.tickets.find(
					(item) => item.key === `${githubRepo}#2`,
				);
				expect(drawn?.links).toEqual([
					{
						key: `${githubRepo}#8`,
						done: true,
					},
					{
						key: `${otherRepo}#9`,
						done: true,
						outside: {
							tracker: "github",
							project: otherRepo,
							key: `${otherRepo}#9`,
							title: "Platform gate",
						},
					},
					{
						key: `${otherRepo}#11`,
						done: false,
						outside: {
							tracker: "github",
							project: otherRepo,
							key: `${otherRepo}#11`,
							title: "Hold the platform",
						},
					},
				]);
				expect(drawn?.blockers).toEqual([`${otherRepo}#11`]);
				expect(drawn?.blocked).toBe(true);
				expect(drawn?.outsideBlockers).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#11`,
						title: "Hold the platform",
					},
				]);
				const summary = report.sections.find(
					(section) => section.id === "summary",
				);
				expect(summary?.text).toContain("2 blocked");
				const closedOnly = report.tickets.find(
					(item) => item.key === `${githubRepo}#8`,
				);
				expect(closedOnly?.blocked).toBeUndefined();
				expect(closedOnly?.blockers).toEqual([]);
				const filtered = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						pinned: [
							{ tracker: "github", repo: githubRepo },
							{ tracker: "github", repo: otherRepo },
						],
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
					`${githubRepo}#1`,
					`${githubRepo}#2`,
				]);
				const onlyClosed = held.tickets.find(
					(item) => item.key === `${githubRepo}#2`,
				);
				expect(onlyClosed?.links?.map((link) => link.key)).toEqual([
					`${githubRepo}#8`,
					`${otherRepo}#9`,
					`${otherRepo}#11`,
				]);
				expect(onlyClosed?.blockers).toEqual([`${otherRepo}#11`]);
			},
		);
	});

	test("the project report lists a shown edge from a done local ticket", async () => {
		const done = issue(
			8,
			"Open the gate",
			{
				state: "closed",
				state_reason: "completed",
				body: `Blocks: ${otherRepo}#11`,
			},
			githubRepo,
		);
		const open = issue(2, "feat(ux): draw the nodes");
		const outside = issue(11, "Hold the platform", {}, otherRepo);
		const closedOnly = issue(
			12,
			"Old history",
			{ state: "closed", state_reason: "completed" },
			otherRepo,
		);
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch([open, done], [outside, closedOnly]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(
							`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
							base,
						),
					)
				).json()) as ProjectReport;
				expect(report.graphLinks).toEqual([
					{
						from: {
							project: githubRepo,
							key: `${githubRepo}#8`,
							tracker: "github",
							title: "Open the gate",
							state: "done",
						},
						to: {
							project: otherRepo,
							key: `${otherRepo}#11`,
							tracker: "github",
							title: "Hold the platform",
							state: "backlog",
						},
						done: true,
					},
				]);
				expect(report.graphTickets.map((item) => item.key)).toEqual([
					`${githubRepo}#2`,
					`${githubRepo}#8`,
				]);
				const filtered = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(filtered.tickets.map((item) => item.key)).toEqual([
					`${githubRepo}#2`,
				]);
				expect(filtered.graphLinks).toEqual(report.graphLinks);
				expect(filtered.graphTickets.map((item) => item.key)).toContain(
					`${githubRepo}#8`,
				);
				expect(report.graphTickets.map((item) => item.key)).toContain(
					`${githubRepo}#8`,
				);
			},
		);
	});

	test("the graph data carries the state of a done ticket that only a closed link brings in", async () => {
		const done = issue(
			8,
			"Open the gate",
			{ state: "closed", state_reason: "completed" },
			githubRepo,
		);
		const open = issue(2, "feat(ux): draw the nodes", {
			body: "Blocked by: #8",
		});
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			githubFetch([open, done], []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(report.tickets.map((item) => item.key)).toEqual([
					`${githubRepo}#2`,
				]);
				const drawn = report.graphTickets.find(
					(item) => item.key === `${githubRepo}#8`,
				);
				expect(drawn?.state).toBe("done");
				const link = report.graphLinks.find(
					(item) => item.from.key === `${githubRepo}#8`,
				);
				expect(link?.done).toBe(true);
				expect(link?.from.state).toBe("done");
				expect(link?.to.state).toBe("backlog");
			},
		);
	});

	test("a recorded closed native blocker drops off the project response", async () => {
		type RecordedIssue = (typeof recordedClosedBlockers.issues)[number];
		const recorded = structuredClone(recordedClosedBlockers.issues);
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
				let report: ProjectReport | null = null;
				for (let attempt = 0; attempt < 50; attempt += 1) {
					const overview = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as { polling?: true };
					if (overview.polling !== true) {
						report = (await (await fetch(projectUrl)).json()) as ProjectReport;
						break;
					}
					await Bun.sleep(20);
				}
				if (report === null) {
					throw new Error("the poll did not settle");
				}
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
							: nodes().filter((node) => node.number === 245);
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
				let report: ProjectReport | null = null;
				for (let attempt = 0; attempt < 50; attempt += 1) {
					const overview = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as { polling?: true };
					if (overview.polling !== true) {
						report = (await (await fetch(projectUrl)).json()) as ProjectReport;
						break;
					}
					await Bun.sleep(20);
				}
				if (report === null) {
					throw new Error("the poll did not settle");
				}
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
				let after: typeof before | null = null;
				for (let attempt = 0; attempt < 50; attempt += 1) {
					const overview = (await (
						await fetch(overviewUrl)
					).json()) as typeof before & {
						polling?: true;
					};
					if (overview.polling !== true) {
						after = overview;
						break;
					}
					await Bun.sleep(20);
				}
				if (after === null) {
					throw new Error("the poll did not settle");
				}
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
				let report: ProjectReport | null = null;
				for (let attempt = 0; attempt < 50; attempt += 1) {
					const overview = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as { polling?: true };
					if (overview.polling !== true) {
						report = (await (await fetch(projectUrl)).json()) as ProjectReport;
						break;
					}
					await Bun.sleep(20);
				}
				if (report === null) {
					throw new Error("the poll did not settle");
				}
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
				let report: ProjectReport | null = null;
				for (let attempt = 0; attempt < 50; attempt += 1) {
					const overview = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as { polling?: true };
					if (overview.polling !== true) {
						report = (await (await fetch(projectUrl)).json()) as ProjectReport;
						break;
					}
					await Bun.sleep(20);
				}
				if (report === null) {
					throw new Error("the poll did not settle");
				}
				const card = report.tickets.find(
					(item) => item.key === `${githubRepo}#245`,
				);
				expect(card?.blockers).toEqual([`${githubRepo}#216`]);
				expect(card?.blocked).toBe(true);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}`, base),
				);
				expect(blank.status).toBe(404);
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("an open ticket blocked only by a closed blocker is not blocked", async () => {
		const done = issue(
			8,
			"Open the gate",
			{ state: "closed", state_reason: "completed" },
			githubRepo,
		);
		const waiting = issue(2, "feat(ux): draw the nodes", {
			body: "Blocked by: #8\nBlocked by: #8\nBlocked by:   ",
		});
		const clear = issue(1, "Ship the map");
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			githubFetch([clear, waiting, done], []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(
							`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
							base,
						),
					)
				).json()) as ProjectReport;
				const drawn = report.tickets.find(
					(item) => item.key === `${githubRepo}#2`,
				);
				expect(drawn?.links).toEqual([{ key: `${githubRepo}#8`, done: true }]);
				expect(drawn?.blocked).toBeUndefined();
				expect(drawn?.blockers).toEqual([]);
				expect(drawn?.chips ?? []).not.toContain("Blocked");
				const summary = report.sections.find(
					(section) => section.id === "summary",
				);
				expect(summary?.text).toContain("0 blocked");
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
				expect(held.tickets.map((item) => item.key)).toEqual([]);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}`, base),
				);
				expect(blank.status).toBe(404);
			},
		);
	});

	test("A Blocks B yields A.blocks and B.blockers across projects", async () => {
		const otherSlug = "platform-gate";
		const gate = {
			...issue(8, "Open the gate", {}, githubRepo),
			issue_dependencies_summary: {
				blocked_by: 0,
				blocking: 1,
				total_blocked_by: 0,
				total_blocking: 1,
			},
		};
		const held = issue(11, "Hold the platform", {}, otherRepo);
		const closed = {
			...issue(
				12,
				"Closed gate",
				{ state: "closed", state_reason: "completed" },
				githubRepo,
			),
			issue_dependencies_summary: {
				blocked_by: 0,
				blocking: 1,
				total_blocked_by: 0,
				total_blocking: 1,
			},
		};
		const named = issue(
			13,
			"Named blocked by",
			{ body: `Blocked by: ${githubRepo}#8` },
			otherRepo,
		);
		const closedHeld = issue(
			14,
			"Already shipped",
			{ state: "closed", state_reason: "completed" },
			otherRepo,
		);
		const linearGate = {
			...linearIssue("WID-8", "", "started"),
			title: "Open the gate",
			inverseRelations: {
				nodes: [
					{
						type: "blockedBy",
						issue: {
							identifier: "PLAT-11",
							title: "Hold the platform",
							state: { type: "started" },
							project: { name: "Platform gate", slugId: otherSlug },
						},
					},
					{
						type: "blockedBy",
						issue: {
							identifier: "PLAT-14",
							title: "Already shipped",
							state: { type: "completed" },
							project: { name: "Platform gate", slugId: otherSlug },
						},
					},
				],
			},
		};
		const linearClosed = {
			...linearIssue("WID-12", "Blocks: PLAT-11", "completed"),
			title: "Closed gate",
		};
		const linearHeld = {
			...linearIssue("PLAT-11", "", "started"),
			title: "Hold the platform",
		};
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
					{ tracker: "linear", project: linearSlug },
					{ tracker: "linear", project: otherSlug },
				],
			}),
			async (input, init) => {
				const url = urlOf(input);
				if (url === "https://api.linear.app/graphql") {
					const body = typeof init?.body === "string" ? init.body : "";
					const query = JSON.parse(body) as {
						query?: string;
						variables?: { pin?: string };
					};
					if (query.query?.includes("MemberProjects")) {
						return Response.json({
							data: {
								viewer: { id: "viewer-ada" },
								projects: {
									nodes: [
										{
											id: "project-widget",
											name: linearSlug,
											slugId: linearSlug,
											updatedAt: "2026-08-18T12:00:00.000Z",
										},
										{
											id: "project-platform",
											name: otherSlug,
											slugId: otherSlug,
											updatedAt: "2026-08-18T12:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						});
					}
					if (query.query?.includes("viewer")) {
						return Response.json({ data: { viewer: { id: "viewer-ada" } } });
					}
					if (query.query?.includes("ProjectByPin")) {
						const pin = query.variables?.pin;
						const project =
							pin === linearSlug
								? {
										id: "project-widget",
										name: linearSlug,
										slugId: linearSlug,
									}
								: pin === otherSlug
									? {
											id: "project-platform",
											name: otherSlug,
											slugId: otherSlug,
										}
									: null;
						return Response.json({
							data: { projects: { nodes: project === null ? [] : [project] } },
						});
					}
					if (query.query?.includes("ProjectIssues")) {
						const nodes = body.includes("project-platform")
							? [linearHeld]
							: [linearGate, linearClosed];
						return Response.json({
							data: {
								issues: {
									nodes,
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						});
					}
					return Response.json({ data: {} });
				}
				const blocking = `https://api.github.com/repos/${githubRepo}/issues/8/dependencies/blocking?per_page=100&page=1`;
				const closedBlocking = `https://api.github.com/repos/${githubRepo}/issues/12/dependencies/blocking?per_page=100&page=1`;
				if (url === blocking) {
					return page([
						{
							number: 11,
							state: "open",
							title: "Hold the platform",
							repository_url: `https://api.github.com/repos/${otherRepo}`,
						},
						{
							number: 14,
							state: "closed",
							title: "Already shipped",
							repository_url: `https://api.github.com/repos/${otherRepo}`,
						},
						{
							number: 11,
							state: "open",
							title: "Hold the platform",
							repository_url: `https://api.github.com/repos/${otherRepo}`,
						},
					]);
				}
				if (url === closedBlocking) {
					return page([
						{
							number: 11,
							state: "open",
							title: "Hold the platform",
							repository_url: `https://api.github.com/repos/${otherRepo}`,
						},
					]);
				}
				return githubFetch(
					[issue(1, "Ship the map"), gate, closed],
					[held, named, closedHeld],
				)(input, init);
			},
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
			async (base) => {
				const source = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const gateView = source.tickets.find(
					(item) => item.key === `${githubRepo}#8`,
				);
				expect(gateView?.blockers).toEqual([]);
				expect(gateView?.blocks).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#11`,
						title: "Hold the platform",
					},
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#13`,
						title: "Named blocked by",
					},
				]);
				expect(
					source.tickets.find((item) => item.key === `${githubRepo}#12`)
						?.blocks ?? [],
				).toEqual([]);

				const other = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(otherRepo)}`, base),
					)
				).json()) as ProjectReport;
				const heldView = other.tickets.find(
					(item) => item.key === `${otherRepo}#11`,
				);
				expect(heldView?.blockers).toEqual([`${githubRepo}#8`]);
				expect(heldView?.outsideBlockers).toEqual([
					{
						tracker: "github",
						project: githubRepo,
						key: `${githubRepo}#8`,
						title: "Open the gate",
					},
				]);
				expect(heldView?.blocks ?? []).toEqual([]);
				expect(
					other.tickets.find((item) => item.key === `${otherRepo}#13`)
						?.blockers,
				).toEqual([`${githubRepo}#8`]);
				const repeated = await fetch(
					new URL(`/api/projects/${encodeURIComponent("  ")}`, base),
				);
				expect(repeated.status).toBe(404);
				const linear = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(linearSlug)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					linear.tickets.find((item) => item.key === "WID-8")?.blocks,
				).toEqual([
					{
						tracker: "linear",
						project: otherSlug,
						key: "PLAT-11",
						title: "Hold the platform",
					},
				]);
				expect(
					linear.tickets.find((item) => item.key === "WID-12")?.blocks ?? [],
				).toEqual([]);
				const platform = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(otherSlug)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					platform.tickets.find((item) => item.key === "PLAT-11")?.blockers,
				).toEqual(["WID-8"]);
				expect(
					platform.tickets.find((item) => item.key === "PLAT-11")
						?.outsideBlockers,
				).toEqual([
					{
						tracker: "linear",
						project: linearSlug,
						key: "WID-8",
						title: "Open the gate",
					},
				]);
			},
		);
	});

	test("the Blocks field lists each open ticket the row blocks, in this project and in others", async () => {
		const gate = issue(
			8,
			"Open the gate",
			{ body: "Blocks: #2, #3" },
			githubRepo,
		);
		const drawn = issue(2, "feat(ux): draw the nodes");
		const closed = issue(3, "Already shipped", {
			state: "closed",
			state_reason: "completed",
		});
		const held = issue(
			11,
			"Hold the platform",
			{ body: `Blocked by: ${githubRepo}#8` },
			otherRepo,
		);
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch([gate, drawn, closed], [held]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.find((item) => item.key === `${githubRepo}#8`)?.blocks,
				).toEqual([
					{
						tracker: "github",
						project: githubRepo,
						key: `${githubRepo}#2`,
						title: "feat(ux): draw the nodes",
					},
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#11`,
						title: "Hold the platform",
					},
				]);
				expect(
					report.tickets.find((item) => item.key === `${githubRepo}#2`)
						?.blocks ?? [],
				).toEqual([]);
			},
		);
	});

	test("a project view that never set groupBy still opens the graph grouped by workstream", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
			projectViews: {
				[githubRepo]: { openView: "board" },
			},
		});
		await withApp(
			config,
			githubFetch([issue(1, "Ship the map")]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, ProjectViewSettings>;
				};
				expect(current.projectViews[githubRepo]?.groupBy).toBeUndefined();
				expect(
					savedProjectView(current.projectViews, githubRepo).groupBy,
				).toBeUndefined();
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							...current.projectViews,
							[githubRepo]: {
								...current.projectViews[githubRepo],
								lastView: "graph",
							},
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<string, ProjectViewSettings>;
				};
				expect(written.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(written.projectViews[githubRepo]?.openView).toBe("board");
				expect(written.projectViews[githubRepo]?.groupBy).toBeUndefined();
				expect(
					savedProjectView(written.projectViews, githubRepo).groupBy,
				).toBeUndefined();
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...written,
						projectViews: {
							...written.projectViews,
							[githubRepo]: {
								...written.projectViews[githubRepo],
								groupBy: "   ",
							},
						},
					}),
				});
				expect(blank.status).toBe(400);
				const kept = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(kept.projectViews[githubRepo]?.groupBy).toBeUndefined();
			},
		);
	});

	test("a saved groupBy of none stays none after a Graph-tab save", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
			projectViews: {
				"*": { openView: "board" },
				[githubRepo]: { groupBy: "none", search: "" },
			},
		});
		await withApp(
			config,
			githubFetch([issue(1, "Ship the map")]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, ProjectViewSettings>;
				};
				expect(current.projectViews[githubRepo]?.groupBy).toBe("none");
				expect(current.projectViews["*"]?.groupBy).toBeUndefined();
				expect(savedProjectView(current.projectViews, githubRepo).groupBy).toBe(
					"none",
				);
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							...current.projectViews,
							[githubRepo]: {
								...current.projectViews[githubRepo],
								lastView: "graph",
							},
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<
						string,
						{ groupBy?: string; openView?: string; lastView?: string }
					>;
				};
				expect(written.projectViews[githubRepo]?.groupBy).toBe("none");
				expect(written.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(written.projectViews[githubRepo]?.openView).toBeUndefined();
				expect(written.projectViews["*"]?.groupBy).toBeUndefined();
			},
		);
	});

	test("a group choice writes the project view settings and survives a restart", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
		});
		const issues = [
			issue(1, "Ship the map", {
				labels: [{ name: "epic" }],
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
			issue(2, "feat(ux): draw the nodes", {
				parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/1`,
				assignee: { login: "bea" },
				assignees: [{ login: "bea" }],
			}),
			issue(3, "Write the copy", {
				milestone: { title: "October" },
			}),
			issue(4, "Share the map", {
				assignees: [{ login: "Ana" }, { login: "Ben" }],
			}),
			issue(5, "Leave the draft", {}),
		];
		const reportOf = async (base: string) =>
			(await (
				await fetch(
					new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
				)
			).json()) as ProjectReport;
		let path = "";
		let cleanup = async () => {};
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		try {
			const temp = await tempConfig(config);
			path = temp.path;
			cleanup = temp.cleanup;
			const start = (check: (base: string) => Promise<void>): Promise<void> => {
				let startChecks: (base: string) => void = () => {};
				const checks = new Promise<void>((resolve, reject) => {
					startChecks = (line) => {
						check(line).then(resolve).catch(reject);
					};
				});
				return run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo({
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: githubFetch(issues, []),
						readGhToken: async () => null,
						databasePath: join(root, "store.sqlite"),
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					}),
				).then((result) => {
					expect(result.stderr).toBe("");
					expect(result.exitCode).toBe(0);
				});
			};
			await start(async (base) => {
				const open = await reportOf(base);
				expect(
					open.tickets.find((ticket) => ticket.key === `${githubRepo}#2`),
				).toMatchObject({ workstream: "Ship the map", theme: "ux" });
				expect(
					open.tickets.find((ticket) => ticket.key === `${githubRepo}#3`),
				).toMatchObject({
					workstream: "October",
					theme: "no scope",
				});
				expect(
					open.tickets.find((ticket) => ticket.key === `${githubRepo}#3`)
						?.assignees,
				).toBeUndefined();
				const shared = open.tickets.find(
					(ticket) => ticket.key === `${githubRepo}#4`,
				)?.assignees;
				expect(shared).toContain("Ana");
				expect(shared).toContain("Ben");
				expect(shared?.some((name) => name.trim() === "")).toBe(false);
				expect(
					open.tickets.find((ticket) => ticket.key === `${githubRepo}#5`)
						?.assignees,
				).toBeUndefined();
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(current.projectViews).toEqual({});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: { groupBy: "workstream" },
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(written.projectViews[githubRepo]?.groupBy).toBe("workstream");
				const rejected = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: { groupBy: "lane" },
						},
					}),
				});
				expect(rejected.status).toBe(400);
				const named = (await rejected.json()) as { error: string };
				expect(named.error).toContain("groupBy");
				const kept = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(kept.projectViews[githubRepo]?.groupBy).toBe("workstream");
			});
			await start(async (base) => {
				const again = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(again.projectViews[githubRepo]?.groupBy).toBe("workstream");
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...again,
						projectViews: {
							[githubRepo]: { groupBy: "   " },
						},
					}),
				});
				expect(blank.status).toBe(400);
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a filter change writes the project view settings and survives a restart", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
		});
		const issues = [
			issue(1, "Ship the map", {
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
			issue(2, "Draw the legend", {
				assignee: { login: "bea" },
				assignees: [{ login: "bea" }],
			}),
			issue(3, "Old done work", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
				updated_at: "2026-08-01T12:00:00.000Z",
			}),
			issue(4, "Recent done work", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "cy" },
				assignees: [{ login: "cy" }],
				updated_at: "2026-08-17T12:00:00.000Z",
			}),
			issue(5, "Dropped the draft", {
				state: "closed",
				state_reason: "not_planned",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
		];
		const keys = async (base: string) => {
			const report = (await (
				await fetch(
					new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
				)
			).json()) as ProjectReport;
			return {
				lanes: report.lanes.map((lane) => lane.name),
				tickets: report.tickets.flatMap((ticket) =>
					ticket.key === null ? [] : [ticket.key],
				),
			};
		};
		let path = "";
		let cleanup = async () => {};
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const temp = await tempConfig(config);
			path = temp.path;
			cleanup = temp.cleanup;
			const start = (check: (base: string) => Promise<void>): Promise<void> => {
				let startChecks: (base: string) => void = () => {};
				const checks = new Promise<void>((resolve, reject) => {
					startChecks = (line) => {
						check(line).then(resolve).catch(reject);
					};
				});
				return run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo({
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: githubFetch(issues, []),
						readGhToken: async () => null,
						databasePath: join(root, "store.sqlite"),
						now: () => new Date("2026-08-18T12:00:00.000Z"),
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					}),
				).then((result) => {
					expect(result.stderr).toBe("");
					expect(result.exitCode).toBe(0);
				});
			};
			await start(async (base) => {
				const open = await keys(base);
				expect(open.lanes).toContain("Done");
				expect(open.lanes).toContain("Dropped");
				expect(open.tickets).toEqual([
					`${githubRepo}#1`,
					`${githubRepo}#2`,
					`${githubRepo}#4`,
				]);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, Record<string, unknown>>;
				};
				expect(current.projectViews).toEqual({});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: {
								shownLanes: ["Backlog", "Done"],
								maxAgeDays: { Done: 2, Backlog: 0 },
								needsYouOnly: false,
								blockedOnly: false,
								assignees: ["ada", "cy"],
								search: "done",
								openView: "table",
								graphDirection: "top-to-bottom",
								groupBy: "none",
							},
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<string, unknown>;
				};
				expect(written.projectViews[githubRepo]).toEqual({
					shownLanes: ["Backlog", "Done"],
					maxAgeDays: { Done: 2, Backlog: 0 },
					needsYouOnly: false,
					blockedOnly: false,
					assignees: ["ada", "cy"],
					search: "done",
					openView: "table",
					graphDirection: "top-to-bottom",
					groupBy: "none",
				});
				const filtered = await keys(base);
				expect(filtered.tickets).toEqual([`${githubRepo}#4`]);
			});
			await start(async (base) => {
				const again = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, unknown>;
				};
				expect(again.projectViews[githubRepo]).toEqual({
					shownLanes: ["Backlog", "Done"],
					maxAgeDays: { Done: 2, Backlog: 0 },
					needsYouOnly: false,
					blockedOnly: false,
					assignees: ["ada", "cy"],
					search: "done",
					openView: "table",
					graphDirection: "top-to-bottom",
					groupBy: "none",
				});
				const filtered = await keys(base);
				expect(filtered.tickets).toEqual([`${githubRepo}#4`]);
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("the board hides a lane, drops tickets older than the lane max age, and filters by several assignees and by search", async () => {
		const calls: string[] = [];
		const issues = [
			issue(1, "Ship the map", {
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }, { login: "bea" }],
			}),
			issue(2, "Draw the legend", {
				assignee: { login: "bea" },
				assignees: [{ login: "bea" }],
			}),
			issue(3, "Hold the copy", {
				assignee: { login: "cy" },
				assignees: [{ login: "cy" }],
			}),
			issue(4, "Recent done map", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
				updated_at: "2026-08-17T12:00:00.000Z",
			}),
			issue(6, "Old done map", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
				updated_at: "2026-08-10T12:00:00.000Z",
			}),
			issue(7, "Dropped map", {
				state: "closed",
				state_reason: "not_planned",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				projectViews: {
					[githubRepo]: {
						shownLanes: ["Backlog", "Done"],
						maxAgeDays: { Done: 3 },
						assignees: ["Ada", "Bea"],
						search: " map",
					},
				},
			}),
			githubFetch(issues, [], calls),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(report.lanes.map((lane) => lane.name)).toContain("Backlog");
				expect(report.lanes.map((lane) => lane.name)).toContain("Dropped");
				expect(
					report.tickets.flatMap((ticket) =>
						ticket.key === null ? [] : [ticket.key],
					),
				).toEqual([`${githubRepo}#1`, `${githubRepo}#4`]);
				const settings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<
						string,
						{
							assignees: string[];
							search: string;
							maxAgeDays: Record<string, number>;
						}
					>;
				};
				const saved = settings.projectViews[githubRepo];
				expect(saved?.assignees).toEqual(["Ada", "Bea"]);
				expect(saved?.search).toBe(" map");
				expect(saved?.maxAgeDays).toEqual({ Done: 3 });
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Record<string, unknown>;
				const blankSearch = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: {
								shownLanes: ["Backlog"],
								assignees: ["", "  "],
								search: "   ",
								maxAgeDays: { Done: 0 },
							},
						},
					}),
				});
				expect(blankSearch.status).toBe(200);
				const cleared = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(cleared.lanes.map((lane) => lane.name)).toContain("Dropped");
				expect(
					cleared.tickets.flatMap((ticket) =>
						ticket.key === null ? [] : [ticket.key],
					),
				).toEqual([`${githubRepo}#1`, `${githubRepo}#2`, `${githubRepo}#3`]);
				const rejected = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: { openView: "kanban", maxAgeDays: { Done: -1 } },
						},
					}),
				});
				expect(rejected.status).toBe(400);
				const named = (await rejected.json()) as { error: string };
				expect(named.error).toContain("projectViews");
				const left = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { search: string }>;
				};
				expect(left.projectViews[githubRepo]?.search).toBe("   ");
				const hidden = (await (
					await fetch(
						new URL(
							`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
							base,
						),
					)
				).json()) as ProjectReport;
				expect(
					hidden.tickets.flatMap((ticket) =>
						ticket.key === null ? [] : [ticket.key],
					),
				).toEqual([
					`${githubRepo}#1`,
					`${githubRepo}#2`,
					`${githubRepo}#3`,
					`${githubRepo}#4`,
					`${githubRepo}#6`,
					`${githubRepo}#7`,
				]);
				const before = calls.length;
				const events = await fetch(new URL("/api/events", base), {
					headers: { accept: "text/event-stream" },
				});
				const reader = events.body?.getReader();
				expect(reader).toBeDefined();
				const opened = await reader?.read();
				expect(new TextDecoder().decode(opened?.value)).toContain(": open");
				const viewOnly = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...left,
						projectViews: {
							[githubRepo]: { search: "legend" },
						},
					}),
				});
				expect(viewOnly.status).toBe(200);
				expect(calls.length).toBe(before);
				const published = await reader?.read();
				expect(new TextDecoder().decode(published?.value)).toContain(
					"event: overview",
				);
				await reader?.cancel();
				const repeated = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...left,
						projectViews: {
							[githubRepo]: { search: "map  map", assignees: ["  ada  "] },
						},
					}),
				});
				expect(repeated.status).toBe(200);
				const spaced = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					spaced.tickets.flatMap((ticket) =>
						ticket.key === null ? [] : [ticket.key],
					),
				).toEqual([]);
				const failed = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: "not json",
				});
				expect(failed.status).toBe(400);
				const kept = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { search: string }>;
				};
				expect(kept.projectViews[githubRepo]?.search).toBe("map  map");
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("a project report names the filters that hide every ticket", async () => {
		const issues = [
			issue(1, "Ship the map"),
			issue(2, "Draw the legend", { body: `Blocked by: ${githubRepo}#1` }),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				projectViews: {
					[githubRepo]: { needsYouOnly: true, blockedOnly: false, search: "" },
				},
			}),
			githubFetch(issues, []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const hidden = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(hidden.total).toBe(2);
				expect(hidden.tickets).toEqual([]);
				expect(hidden.hiddenBy).toEqual(["needsYouOnly"]);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Record<string, unknown>;
				const both = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: {
								needsYouOnly: true,
								blockedOnly: true,
								search: "missing",
								assignees: ["nobody"],
								shownLanes: ["Backlog"],
								maxAgeDays: { Backlog: 1 },
							},
						},
					}),
				});
				expect(both.status).toBe(200);
				const named = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(named.tickets).toEqual([]);
				expect(named.hiddenBy).toEqual([
					"lanes",
					"maxAge",
					"needsYouOnly",
					"blockedOnly",
					"assignees",
					"search",
				]);
				const shown = (await (
					await fetch(
						new URL(
							`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
							base,
						),
					)
				).json()) as ProjectReport;
				expect(shown.hiddenBy).toBeUndefined();
				expect(shown.tickets.length).toBe(2);
				const cleared = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: {
								needsYouOnly: false,
								blockedOnly: false,
								search: "",
								assignees: [],
							},
						},
					}),
				});
				expect(cleared.status).toBe(200);
				const open = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(open.hiddenBy).toBeUndefined();
				expect(open.tickets.map((ticket) => ticket.key)).toEqual([
					`${githubRepo}#1`,
					`${githubRepo}#2`,
				]);
				const saved = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<
						string,
						{ needsYouOnly: boolean; blockedOnly: boolean; search: string }
					>;
				};
				expect(saved.projectViews[githubRepo]?.needsYouOnly).toBe(false);
				expect(saved.projectViews[githubRepo]?.blockedOnly).toBe(false);
				expect(saved.projectViews[githubRepo]?.search).toBe("");
			},
		);
	});

	test("a project report names the default Done age cap when it hides every ticket", async () => {
		const issues = [
			issue(1, "Old done work", {
				state: "closed",
				state_reason: "completed",
				updated_at: "2026-08-01T12:00:00.000Z",
				closed_at: "2026-08-01T12:00:00.000Z",
			}),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			githubFetch(issues, []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const hidden = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(hidden.total).toBe(1);
				expect(hidden.tickets).toEqual([]);
				expect(hidden.doneTickets.map((ticket) => ticket.key)).toEqual([
					`${githubRepo}#1`,
				]);
				expect(hidden.hiddenBy).toEqual(["maxAge"]);
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("a saved filter keeps each ticket's update time", async () => {
		const calls: string[] = [];
		const issues = [
			issue(1, "Ship the map", { updated_at: "2026-08-18T09:00:00.000Z" }),
			issue(2, "Draw the legend", {
				updated_at: "2026-08-12T09:00:00.000Z",
				assignee: { login: "bea" },
			}),
			issue(3, "Hold the map copy", { updated_at: "2026-08-18T15:00:00.000Z" }),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				projectViews: {
					[githubRepo]: {
						search: "map",
						needsYouOnly: false,
						blockedOnly: false,
					},
				},
			}),
			githubFetch(issues, [], calls),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.map((ticket) => ({
						key: ticket.key,
						updatedAt: ticket.updatedAt,
					})),
				).toEqual([
					{
						key: `${githubRepo}#1`,
						updatedAt: "2026-08-18T09:00:00.000Z",
					},
					{
						key: `${githubRepo}#3`,
						updatedAt: "2026-08-18T15:00:00.000Z",
					},
				]);
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						pinned: [{ tracker: "github", repo: githubRepo }],
						projectViews: {
							[githubRepo]: { search: "   " },
						},
					}),
				});
				expect(blank.status).toBe(200);
				const cleared = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(cleared.tickets.map((ticket) => ticket.updatedAt)).toEqual([
					"2026-08-18T09:00:00.000Z",
					"2026-08-12T09:00:00.000Z",
					"2026-08-18T15:00:00.000Z",
				]);
			},
		);
	});

	test("last opens the saved view, and a pinned view stays pinned", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([issue(1, "Ship the map")]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const settingsUrl = new URL("/api/settings", base);
				const projectUrl = new URL(
					`/api/projects/${encodeURIComponent(githubRepo)}`,
					base,
				);
				const readSettings = async () =>
					(await (await fetch(settingsUrl)).json()) as {
						projectViews: Record<string, ProjectViewSettings>;
					};
				const reopen = async () => {
					const opened = await fetch(projectUrl);
					expect(opened.status).toBe(200);
					const report = (await opened.json()) as ProjectReport;
					expect(report).not.toHaveProperty("openView");
					expect(report.name).toBe(githubRepo);
					return readSettings();
				};

				const current = await readSettings();
				expect(current.projectViews["*"]?.openView).toBeUndefined();
				expect(current.projectViews[githubRepo]?.lastView).toBeUndefined();

				const last = await fetch(settingsUrl, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "last" },
						},
					}),
				});
				expect(last.status).toBe(200);
				const savedLast = await readSettings();
				expect(savedLast.projectViews["*"]?.openView).toBe("last");

				const switched = await fetch(settingsUrl, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...savedLast,
						projectViews: {
							"*": { openView: "last" },
							[githubRepo]: { lastView: "graph" },
						},
					}),
				});
				expect(switched.status).toBe(200);
				const reopened = await reopen();
				expect(reopened.projectViews["*"]?.openView).toBe("last");
				expect(reopened.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(reopened.projectViews[githubRepo]?.openView).toBeUndefined();

				const pinned = await fetch(settingsUrl, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...reopened,
						projectViews: {
							"*": { openView: "board" },
							[githubRepo]: { lastView: "graph" },
						},
					}),
				});
				expect(pinned.status).toBe(200);
				const savedBoard = await reopen();
				expect(savedBoard.projectViews["*"]?.openView).toBe("board");
				expect(savedBoard.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(savedBoard.projectViews[githubRepo]?.openView).toBeUndefined();

				const switchedAgain = await fetch(settingsUrl, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...savedBoard,
						projectViews: {
							"*": { openView: "board" },
							[githubRepo]: { lastView: "graph" },
						},
					}),
				});
				expect(switchedAgain.status).toBe(200);
				const stayed = await reopen();
				expect(stayed.projectViews["*"]?.openView).toBe("board");
				expect(stayed.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(stayed.projectViews[githubRepo]?.openView).toBeUndefined();
			},
		);
	});

	test("a project with no own view uses the star view, and its own entry wins", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Record<string, unknown>;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph" },
						},
					}),
				});
				expect(saved.status).toBe(200);
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(report).not.toHaveProperty("openView");
				const opened = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews?: Record<string, ProjectViewSettings>;
				};
				expect(
					savedProjectView(opened.projectViews ?? {}, githubRepo).openView,
				).toBe("graph");
				const own = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph" },
							[githubRepo]: { openView: "table" },
						},
					}),
				});
				expect(own.status).toBe(200);
				const won = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(won).not.toHaveProperty("openView");
				const ownSettings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews?: Record<string, ProjectViewSettings>;
				};
				expect(
					savedProjectView(ownSettings.projectViews ?? {}, githubRepo).openView,
				).toBe("table");
				const spaced = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph", search: "   " },
						},
					}),
				});
				expect(spaced.status).toBe(200);
				const kept = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(kept).not.toHaveProperty("openView");
				const keptSettings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews?: Record<string, ProjectViewSettings>;
				};
				expect(
					savedProjectView(keptSettings.projectViews ?? {}, githubRepo)
						.openView,
				).toBe("graph");
			},
		);
	});

	test("a missing project is not found, and a blank name is not found", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const missing = await fetch(new URL("/api/projects/missing", base));
				expect(missing.status).toBe(404);
				const blank = await fetch(new URL("/api/projects/%20", base));
				expect(blank.status).toBe(404);
				const spaced = await fetch(
					new URL(`/api/projects/${encodeURIComponent("acme/widget  ")}`, base),
				);
				expect(spaced.status).toBe(404);
				const percent = await fetch(
					new URL(`/api/projects/${encodeURIComponent("100%")}`, base),
				);
				expect(percent.status).toBe(404);
				const pageResponse = await fetch(
					new URL(`/projects/${encodeURIComponent(githubRepo)}`, base),
				);
				expect(pageResponse.status).toBe(200);
				const html = await pageResponse.text();
				expect(html).toContain('id="root"');
				expect(html).not.toContain("Feature map");
			},
		);
	});
});
