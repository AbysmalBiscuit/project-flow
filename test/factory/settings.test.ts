import { describe, expect, test } from "bun:test";

import hubRuns from "../fixtures/factory-hub-runs.json";
import runSettings from "../fixtures/factory-run-settings.json";
import {
	daemon,
	type FactoryRequest,
	hub,
	hubUrl,
} from "../support/factory.ts";
import { settledRead } from "../support/reads.ts";
import { boxRow, factoryRunOf, overviewWhere, serveRuns } from "./_support.ts";

describe("factory runs", () => {
	describe("the run settings", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const settingsPath = `/runs/${running41}/settings`;

		async function settingsOf(
			base: string,
			runId = running41,
		): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return settledRead(
				new URL(
					`/api/factory-runs/${encodeURIComponent(runId)}/settings`,
					base,
				),
			);
		}

		const settingsRequests = (requests: FactoryRequest[]) => [
			...new Set(
				requests
					.filter((request) => new URL(request.url).pathname === settingsPath)
					.map((request) => request.url),
			),
		];

		test("a run on a box gives its workflow package, parameters, model and backend choices and options through the hub", async () => {
			const app = await serveRuns(
				{ ...hub, [settingsPath]: runSettings },
				[41],
			);
			try {
				const response = await settingsOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					workflowPackage: "standard",
					parameters: [
						{
							name: "goal",
							value:
								"Build the ticket until its Done when holds, then open its pull request and land it",
						},
						{ name: "merge_auto", value: "yes" },
						{ name: "merge_review", value: "off" },
						{ name: "merge_rebase", value: "never" },
						{ name: "through", value: "review" },
						{ name: "base", value: "" },
						{ name: "extra", value: "" },
						{ name: "rankdir", value: "LR" },
					],
					parametersError: null,
					choices: [
						"draft",
						"implement",
						"apply",
						"repush",
						"verify",
						"review",
						"conceptual",
						"receive",
						"reverify",
						"post_pr",
						"report",
					].map((node) => ({
						node,
						mode: "headless",
						launcher: null,
						harness: "claude",
						model: "opus",
						effort: "medium",
						error: null,
					})),
					options: {
						repo: "AbysmalBiscuit/project-flow",
						ticket: "742",
						author: "Lev Velykoivanenko",
						keepWorktree: true,
						sent: false,
						source: "project-flow",
						rule: "build",
					},
				});
				expect(settingsRequests(app.requests)).toEqual([
					`${hubUrl}${settingsPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run that a hub and its box report reads its settings from the hub, and the box gets no read", async () => {
			const [row41] = hubRuns.runs;
			if (row41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				{ ...hub, [settingsPath]: runSettings },
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(row41, "running")] },
					[settingsPath]: runSettings,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect((await settingsOf(app.base)).status).toBe(200);
				expect(settingsRequests(app.requests)).toEqual([
					`${hubUrl}${settingsPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 on the settings reports the settings as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await settingsOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		test("a factory that cannot read the credentials of the run, or a run that no factory reports, answers 404", async () => {
			const app = await serveRuns(
				{
					...hub,
					[settingsPath]: Response.json(
						{ error: "cannot read the credentials of the run" },
						{ status: 500 },
					),
				},
				[41],
			);
			try {
				for (const runId of [running41, "no-such-run"]) {
					const response = await settingsOf(app.base, runId);
					expect(response.status).toBe(404);
					expect(await response.json()).toEqual({ missing: true });
				}
			} finally {
				await app.stop();
			}
		});
	});
});
