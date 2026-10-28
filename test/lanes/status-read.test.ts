import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { unrecorded } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { settledOverview } from "../support/reads.ts";
import {
	flight,
	linearIssue,
	linearSlug,
	linearTeam,
	type OverviewBody,
	placed,
	projectFetch,
	projectItem,
	projectOf,
	withApp,
} from "./_support.ts";

describe("tracker lanes", () => {
	test("a Linear team status error names the tracker message", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: async (input, init) => {
						const body = typeof init?.body === "string" ? init.body : "";
						if (body.includes("TeamStates")) {
							return Response.json({
								data: null,
								errors: [{ message: "Team not found" }],
							});
						}
						return linearFake({
							project: {
								id: "project-widget",
								name: "Widget launch",
								slugId: linearSlug,
								teams: { nodes: [linearTeam] },
							},
						})(input, init);
					},
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Team not found");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank started Linear status stays in progress", async () => {
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
					linearIssue("WID-4", "Name the lane", {
						id: "st-blank",
						name: "   ",
						type: "started",
						color: "#F2C94C",
					}),
				],
				states: [
					{
						id: "st-blank",
						name: "   ",
						type: "started",
						position: 0,
						color: "#F2C94C",
					},
				],
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(report.statuses.find((lane) => lane.id === "st-blank")).toEqual({
					id: "st-blank",
					name: "   ",
					colour: "#F2C94C",
					statusType: "inProgress",
				});
				expect(flight(report)).toEqual([
					placed("WID-4", "Name the lane", "   ", "inProgress"),
				]);
			},
		);
	});

	test("a failing status read keeps the stored lanes and reports the error", async () => {
		let fields = 0;
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
				pollIntervalSeconds: 3600,
			}),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("ProjectFields")
				) {
					fields += 1;
					if (fields > 1) {
						return unrecorded(input);
					}
				}
				return projectFetch([
					projectItem(7, "Draw the nodes", {
						name: "In progress",
						color: "YELLOW",
					}),
				])(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toContain(
					"In progress",
				);
				const refreshed = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refreshed.status).toBe(204);
				const overview = await settledOverview(base, async (address) => {
					const response = await fetch(new URL("/api/overview", address));
					expect(response.status).toBe(200);
					return (await response.json()) as OverviewBody & { polling?: true };
				});
				const project = overview.projects.find(
					(item) => item.name === "Widget board",
				);
				expect(project?.error).toContain("HTTP 404");
				const stored = await projectOf(base, "Widget board");
				expect(stored.statuses.map((lane) => lane.name)).toEqual(
					report.statuses.map((lane) => lane.name),
				);
				expect(stored.statuses.map((lane) => lane.name)).not.toEqual([
					"Backlog",
					"In progress",
					"In review",
					"Awaiting merge",
					"Done",
					"Dropped",
				]);
			},
		);
	});

	test("a project with no Status field uses the app lanes", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("ProjectFields")
				) {
					return Response.json({
						data: {
							node: {
								fields: {
									nodes: [{}],
								},
							},
						},
					});
				}
				return projectFetch([
					projectItem(12, "Blank status", { name: "  ", color: "" }),
				])(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Backlog",
					"In progress",
					"In review",
					"Awaiting merge",
					"Done",
					"Dropped",
				]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(
					overview.projects.find((item) => item.name === "Widget board")?.error,
				).toBeNull();
			},
		);
	});
});
