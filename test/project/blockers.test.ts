import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../../src/domain.ts";
import {
	githubFetch,
	githubRepo,
	issue,
	linearIssue,
	linearSlug,
	otherRepo,
	page,
	withApp,
} from "../project-harness.ts";
import { urlOf } from "../support/fetch.ts";

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

	test("each ticket names its blockers with key, title and project", async () => {
		const gate = issue(8, "  Open the gate  ", {}, githubRepo);
		const drawn = issue(2, "feat(ux): draw the nodes", {
			body: `Blocked by: #8\nBlocked by: ${otherRepo}#9\nBlocked by: ${otherRepo}#10`,
		});
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch(
				[issue(1, "Ship the map"), drawn, gate],
				[
					issue(9, "Platform gate", {}, otherRepo),
					issue(10, "   ", {}, otherRepo),
				],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const byKey = (key: string) =>
					report.tickets.find((item) => item.key === key);
				expect(byKey(`${githubRepo}#2`)?.blockedBy).toEqual([
					{
						tracker: "github",
						project: githubRepo,
						key: `${githubRepo}#8`,
						title: "Open the gate",
					},
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#9`,
						title: "Platform gate",
					},
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#10`,
						title: `${otherRepo}#10`,
					},
				]);
				expect(byKey(`${githubRepo}#8`)?.blocks).toEqual([
					{
						tracker: "github",
						project: githubRepo,
						key: `${githubRepo}#2`,
						title: "feat(ux): draw the nodes",
					},
				]);
				expect(byKey(`${githubRepo}#1`)?.blockedBy).toEqual([]);
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
					`${githubRepo}#40`,
				]);
				const filtered = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(filtered.tickets.map((item) => item.key)).toEqual([
					`${githubRepo}#2`,
					`${githubRepo}#8`,
					`${githubRepo}#40`,
				]);
				expect(filtered.graphLinks).toEqual(report.graphLinks);
				expect(filtered.graphTickets.map((item) => item.key)).toContain(
					`${githubRepo}#8`,
				);
				expect(report.graphTickets.map((item) => item.key)).toContain(
					`${githubRepo}#8`,
				);
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("the graph data carries the state of a done ticket that a closed link brings in", async () => {
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
					`${githubRepo}#8`,
					`${githubRepo}#40`,
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
});
