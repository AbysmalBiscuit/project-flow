import { describe, expect, test } from "bun:test";

import type { RunDetail } from "../../src/domain.ts";
import hubEvents from "../fixtures/factory-hub-events.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import runArtifact from "../fixtures/factory-run-artifact.json";
import runArtifacts from "../fixtures/factory-run-artifacts.json";
import runGraph from "../fixtures/factory-run-graph.json";
import runSandbox from "../fixtures/factory-run-sandbox.json";
import runSource from "../fixtures/factory-run-source.json";
import {
	daemon,
	EventFeed,
	type FactoryRequest,
	hub,
	hubUrl,
	laptopSocket,
} from "../support/factory.ts";
import { readWhere, settledRead } from "../support/reads.ts";
import { boxRow, factoryRunOf, overviewWhere, serveRuns } from "./_support.ts";

describe("factory runs", () => {
	describe("the run artifacts", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const listPath = `/runs/${running41}/artifacts`;
		const responsePath = `${listPath}/plan%40v1.a1/response.md`;
		const verdictPath = `${listPath}/review%40v1.a1/child/verdict%40v1.a1/artifacts/verdict.json`;
		const verdict = {
			...runArtifacts.artifacts[5],
			encoding: "utf-8",
			content: '{"verdict":"ship","findings":[]}',
		};

		async function artifactRead(base: string, path: string): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return settledRead(
				new URL(
					`/api/factory-runs/${encodeURIComponent(running41)}${path}`,
					base,
				),
			);
		}

		const listOf = (base: string) => artifactRead(base, "/artifacts");

		const artifactOf = (base: string, folder: string, name: string) =>
			artifactRead(
				base,
				`/artifact?${new URLSearchParams({ folder, name }).toString()}`,
			);

		/** Each artifact URL that the app read, once: a stale read reads again in the background. */
		const artifactRequests = (requests: FactoryRequest[]) => [
			...new Set(
				requests
					.filter((request) =>
						new URL(request.url).pathname.startsWith(listPath),
					)
					.map((request) => request.url),
			),
		];

		test("a run on a box lists its artifacts through the hub, each with its stage folder, stage, name, type and size", async () => {
			const app = await serveRuns({ ...hub, [listPath]: runArtifacts }, [41]);
			try {
				const response = await listOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					artifacts: runArtifacts.artifacts.map((artifact) => ({
						folder: artifact.stage,
						stage: artifact.node_path,
						name: artifact.name,
						type: artifact.type,
						size: artifact.size,
					})),
				});
				expect(artifactRequests(app.requests)).toEqual([
					`${hubUrl}${listPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run on a box gives the content of one artifact through the hub", async () => {
			const app = await serveRuns(
				{ ...hub, [responsePath]: runArtifact, [verdictPath]: verdict },
				[41],
			);
			try {
				const response = await artifactOf(
					app.base,
					"plan@v1.a1",
					"response.md",
				);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					folder: "plan@v1.a1",
					stage: "plan",
					name: "response.md",
					type: "text/markdown",
					size: runArtifact.size,
					encoding: "utf-8",
					content: runArtifact.content,
				});
				const nested = await artifactOf(
					app.base,
					"review@v1.a1/child/verdict@v1.a1",
					"artifacts/verdict.json",
				);
				expect(await nested.json()).toMatchObject({
					stage: "review/verdict",
					content: verdict.content,
				});
				expect(artifactRequests(app.requests)).toEqual([
					`${hubUrl}${responsePath}`,
					`${hubUrl}${verdictPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run that a hub and its box report reads its artifacts from the hub, and the box gets no read", async () => {
			const [row41] = hubRuns.runs;
			if (row41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				{ ...hub, [listPath]: runArtifacts, [responsePath]: runArtifact },
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(row41, "running")] },
					[listPath]: runArtifacts,
					[responsePath]: runArtifact,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect((await listOf(app.base)).status).toBe(200);
				expect(
					(await artifactOf(app.base, "plan@v1.a1", "response.md")).status,
				).toBe(200);
				expect(artifactRequests(app.requests)).toEqual([
					`${hubUrl}${listPath}`,
					`${hubUrl}${responsePath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 on the artifact list reports the artifacts as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await listOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		test("an artifact that the factory does not hold answers 404", async () => {
			const app = await serveRuns({ ...hub, [listPath]: runArtifacts }, [41]);
			try {
				const response = await artifactOf(app.base, "plan@v1.a1", "nope.md");
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				for (const path of [
					"/api/factory-runs/no-such-run/artifacts",
					"/api/factory-runs/no-such-run/artifact?folder=plan%40v1.a1&name=response.md",
				]) {
					const response = await settledRead(new URL(path, app.base));
					expect(response.status).toBe(404);
					expect(await response.json()).toEqual({ missing: true });
				}
			} finally {
				await app.stop();
			}
		});
	});

	describe("the run sandbox", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const sandboxPath = `/runs/${running41}/sandbox`;

		async function sandboxOf(base: string): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return settledRead(
				new URL(
					`/api/factory-runs/${encodeURIComponent(running41)}/sandbox`,
					base,
				),
			);
		}

		/** Each sandbox URL that the app read, once: a stale read reads again in the background. */
		const sandboxRequests = (requests: FactoryRequest[]) => [
			...new Set(
				requests
					.filter((request) => new URL(request.url).pathname === sandboxPath)
					.map((request) => request.url),
			),
		];

		test("a run on a box gives its host, worktree, branch, base and workspace state through the hub", async () => {
			const app = await serveRuns({ ...hub, [sandboxPath]: runSandbox }, [41]);
			try {
				const response = await sandboxOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual(runSandbox);
				expect(sandboxRequests(app.requests)).toEqual([
					`${hubUrl}${sandboxPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run whose worktree is gone gives the removed state", async () => {
			const removed = {
				...runSandbox,
				branch: null,
				head: null,
				base: null,
				ahead: null,
				state: "removed",
				changes: [],
			};
			const app = await serveRuns({ ...hub, [sandboxPath]: removed }, [41]);
			try {
				expect(await (await sandboxOf(app.base)).json()).toEqual(removed);
			} finally {
				await app.stop();
			}
		});

		test("a run that a hub and its box report reads its sandbox from the hub, and the box gets no read", async () => {
			const [row41] = hubRuns.runs;
			if (row41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				{ ...hub, [sandboxPath]: runSandbox },
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(row41, "running")] },
					[sandboxPath]: runSandbox,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect((await sandboxOf(app.base)).status).toBe(200);
				expect(sandboxRequests(app.requests)).toEqual([
					`${hubUrl}${sandboxPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 reports the sandbox as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await sandboxOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const response = await settledRead(
					new URL("/api/factory-runs/no-such-run/sandbox", app.base),
				);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});
	});

	describe("the workflow source", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const sourcePath = `/runs/${running41}/source`;

		async function sourceOf(
			base: string,
			runId = running41,
		): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return settledRead(
				new URL(`/api/factory-runs/${encodeURIComponent(runId)}/source`, base),
			);
		}

		const sourceRequests = (requests: FactoryRequest[]) => [
			...new Set(
				requests
					.filter((request) => new URL(request.url).pathname === sourcePath)
					.map((request) => request.url),
			),
		];

		test("a run on a box gives the entry graph and each child graph that it calls through the hub", async () => {
			const app = await serveRuns({ ...hub, [sourcePath]: runSource }, [41]);
			try {
				const response = await sourceOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					entry: "pre_pr.dot",
					graphs: [
						{
							path: "pre_pr.dot",
							text: runSource.graphs["pre_pr.dot"],
						},
						{
							path: "steps/review.dot",
							text: runSource.graphs["steps/review.dot"],
						},
					],
				});
				expect(sourceRequests(app.requests)).toEqual([
					`${hubUrl}${sourcePath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run that a hub and its box report reads its source from the hub, and the box gets no read", async () => {
			const [row41] = hubRuns.runs;
			if (row41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				{ ...hub, [sourcePath]: runSource },
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(row41, "running")] },
					[sourcePath]: runSource,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect((await sourceOf(app.base)).status).toBe(200);
				expect(sourceRequests(app.requests)).toEqual([
					`${hubUrl}${sourcePath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 on the source reports the source as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await sourceOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		test("a run that has not loaded its package, or that no factory reports, answers 404", async () => {
			const app = await serveRuns(
				{
					...hub,
					[sourcePath]: Response.json(
						{ error: "the run has not loaded its package" },
						{ status: 409 },
					),
				},
				[41],
			);
			try {
				for (const runId of [running41, "no-such-run"]) {
					const response = await sourceOf(app.base, runId);
					expect(response.status).toBe(404);
					expect(await response.json()).toEqual({ missing: true });
				}
			} finally {
				await app.stop();
			}
		});
	});

	describe("the run detail", () => {
		const [running41, , , failed39] = hubRuns.runs;
		if (running41 === undefined || failed39 === undefined) {
			throw new Error("the hub runs fixture lost a run");
		}

		function detailOf(base: string, id: string): Promise<Response> {
			return fetch(
				new URL(`/api/factory-runs/${encodeURIComponent(id)}`, base),
			);
		}

		/** The first read answers without the workflow, and a later read has it from the graph read. */
		function workflowDetailOf(base: string, id: string): Promise<RunDetail> {
			return readWhere<RunDetail>(
				new URL(`/api/factory-runs/${encodeURIComponent(id)}`, base),
				(body) => body.workflow !== undefined,
			);
		}

		test("a run on a box gives its facts, failure reason and workflow through the hub", async () => {
			const graphPath = `/runs/${failed39.id}/graph`;
			const app = await serveRuns({ ...hub, [graphPath]: runGraph }, [39]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 39) !== undefined,
				);
				expect(await workflowDetailOf(app.base, failed39.id)).toMatchObject({
					id: failed39.id,
					key: "39",
					repo: "acme/widget",
					statusKind: "failed",
					box: "box-a",
					factory: "work hub",
					startedAt: "2026-10-25T12:00:09+00:00",
					endedAt: "2026-10-25T12:30:00+00:00",
					failureReason: "stage review failed",
					workflow: runGraph.name,
				});
				expect(
					app.requests
						.filter((request) => request.url.endsWith("/graph"))
						.map((request) => request.url),
				).toEqual([`${hubUrl}${graphPath}`]);
			} finally {
				await app.stop();
			}
		});

		test("a run on a standalone factory gives its facts and workflow from that factory", async () => {
			const laptopRun = {
				...boxRow(running41, "running"),
				id: "20261025-141800-f7a8",
				ticket: "43",
			};
			const app = await serveRuns(
				hub,
				[43],
				{},
				{
					...daemon,
					"/runs": { runs: [laptopRun] },
					[`/runs/${laptopRun.id}/graph`]: runGraph,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 43) !== undefined,
				);
				const detail = await workflowDetailOf(app.base, laptopRun.id);
				expect(detail).toMatchObject({
					id: laptopRun.id,
					key: "43",
					statusKind: "running",
					box: "laptop",
					factory: "laptop",
					workflow: runGraph.name,
				});
				expect(detail).not.toHaveProperty("failureReason");
				expect(
					app.requests
						.filter((request) => request.url.endsWith("/graph"))
						.map((request) => request.unix),
				).toEqual([laptopSocket]);
			} finally {
				await app.stop();
			}
		});

		test("the run detail gives the last event of the run from the event stream", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, "/events": feed }, [41]);
			try {
				await feed.connected(1);
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const [planStarted] = hubEvents;
				feed.send(planStarted);
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.stage === "plan",
				);
				const response = await detailOf(app.base, running41.id);
				expect(await response.json()).toMatchObject({
					stage: "plan",
					lastEvent: {
						event: "stage.started",
						stage: "plan",
						at: "2026-10-25T14:21:03.512+00:00",
					},
				});
			} finally {
				await app.stop();
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const response = await detailOf(app.base, "no-such-run");
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});
	});
});
