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

		test("a run on a box gives its workflow, parameters, model and backend choices and options through the hub", async () => {
			const app = await serveRuns(
				{ ...hub, [settingsPath]: runSettings },
				[41],
			);
			try {
				const response = await settingsOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					workflow: "workcell",
					parameters: [
						{ name: "through", value: "review" },
						{ name: "max_rounds", value: 3 },
						{ name: "draft", value: false },
						{ name: "note", value: "[REDACTED]" },
					],
					parametersError: null,
					choices: [
						{
							node: "implement",
							mode: "headless",
							launcher: null,
							harness: "claude",
							model: "opus",
							effort: "high",
							error: null,
						},
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
					],
					options: {
						repo: "acme/widget",
						ticket: "41",
						author: "lev",
						keepWorktree: true,
						sent: true,
						source: "acme-github",
						rule: "ready-for-agent",
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
