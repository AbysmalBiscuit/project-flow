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

const running41 = hubRuns.runs[0]?.id ?? "";
// The recorded settings come from the run of ticket 742. The tests serve them
// for the run of ticket 41, because the app does not check the ticket of the settings.
const settingsPath = `/runs/${running41}/settings`;

async function settingsOf(base: string, runId = running41): Promise<Response> {
	await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
	return settledRead(
		new URL(`/api/factory-runs/${encodeURIComponent(runId)}/settings`, base),
	);
}

const settingsRequests = (requests: FactoryRequest[]) => [
	...new Set(
		requests
			.filter((request) => new URL(request.url).pathname === settingsPath)
			.map((request) => request.url),
	),
];

describe("factory runs", () => {
	describe("the run settings", () => {
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
	});

	describe("the run settings values", () => {
		test("the settings keep number, boolean, list and object parameters, a choice with a launcher or an error, and a sent run", async () => {
			const app = await serveRuns(
				{
					...hub,
					[settingsPath]: {
						...runSettings,
						parameters: {
							max_rounds: 3,
							draft: false,
							labels: ["ready", 2],
							limits: { ci: null },
						},
						choices: {
							review: {
								mode: "headless",
								launcher: "reviewer",
								harness: "codex",
								model: "gpt-5.5",
								effort: null,
								error: null,
							},
							watch: {
								mode: "pane",
								launcher: null,
								harness: null,
								model: null,
								effort: null,
								error: "no launcher offers a harness that is installed",
							},
						},
						options: { ...runSettings.options, sent: true },
					},
				},
				[41],
			);
			try {
				const response = await settingsOf(app.base);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.parameters).toEqual([
					{ name: "max_rounds", value: 3 },
					{ name: "draft", value: false },
					{ name: "labels", value: ["ready", 2] },
					{ name: "limits", value: { ci: null } },
				]);
				expect(body.choices).toEqual([
					{
						node: "review",
						mode: "headless",
						launcher: "reviewer",
						harness: "codex",
						model: "gpt-5.5",
						effort: null,
						error: null,
					},
					{
						node: "watch",
						mode: "pane",
						launcher: null,
						harness: null,
						model: null,
						effort: null,
						error: "no launcher offers a harness that is installed",
					},
				]);
				expect(body.options.sent).toBe(true);
			} finally {
				await app.stop();
			}
		});
	});

	describe("the run settings source", () => {
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
