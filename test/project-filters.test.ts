import { describe, expect, test } from "bun:test";
import type { ProjectReport } from "../src/domain.ts";
import { eventsOf, quietReader } from "./events.ts";
import { githubFetch, githubRepo, issue, withApp } from "./project-harness.ts";

describe("GET /api/projects/:name filters", () => {
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
				if (reader === undefined) {
					throw new Error("event stream has no body");
				}
				const quiet = quietReader(reader);
				expect(await quiet.untilIdle()).toContain(": open");
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
				const published = eventsOf(await quiet.untilIdle());
				expect(published.map((event) => event.event)).toEqual(["views"]);
				await reader.cancel();
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

	test("the filtered graph leaves out a linked done ticket older than the lane max age until the cap clears", async () => {
		const issues = [
			issue(2, "feat(ux): draw the nodes", {
				body: "Blocked by: #8\nBlocked by: #9",
				updated_at: "2026-08-18T09:00:00.000Z",
			}),
			issue(8, "Open the old gate", {
				state: "closed",
				state_reason: "completed",
				updated_at: "2026-08-10T12:00:00.000Z",
				closed_at: "2026-08-10T12:00:00.000Z",
			}),
			issue(9, "Open the new gate", {
				state: "closed",
				state_reason: "completed",
				updated_at: "2026-08-17T12:00:00.000Z",
				closed_at: "2026-08-17T12:00:00.000Z",
			}),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
			githubFetch(issues, []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const graphOf = async (maxAgeDays: Record<string, number>) => {
					const current = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Record<string, unknown>;
					const saved = await fetch(new URL("/api/settings", base), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							...current,
							projectViews: { [githubRepo]: { maxAgeDays } },
						}),
					});
					expect(saved.status).toBe(200);
					const report = (await (
						await fetch(
							new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
						)
					).json()) as ProjectReport;
					return {
						tickets: report.graphTickets.map((ticket) => ticket.key),
						links: report.graphLinks.map(
							(link) => `${link.from.key} -> ${link.to.key}`,
						),
					};
				};
				const capped = {
					tickets: [`${githubRepo}#2`, `${githubRepo}#9`],
					links: [`${githubRepo}#9 -> ${githubRepo}#2`],
				};
				expect(await graphOf({})).toEqual(capped);
				expect(await graphOf({ Done: 3 })).toEqual(capped);
				expect(await graphOf({ Done: 0 })).toEqual({
					tickets: [`${githubRepo}#2`, `${githubRepo}#8`, `${githubRepo}#9`],
					links: [
						`${githubRepo}#8 -> ${githubRepo}#2`,
						`${githubRepo}#9 -> ${githubRepo}#2`,
					],
				});
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});
});
