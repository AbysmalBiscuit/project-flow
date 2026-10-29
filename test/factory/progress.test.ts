import { describe, expect, test } from "bun:test";

import type { RunCheckpoint } from "../../src/domain.ts";
import hubCheckpoint from "../fixtures/factory-hub-checkpoint.json";
import hubEvents from "../fixtures/factory-hub-events.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import runEvents from "../fixtures/factory-run-events.json";
import runGraphCheckpoint from "../fixtures/factory-run-graph-checkpoint.json";
import runGraph from "../fixtures/factory-run-graph.json";
import runTurns from "../fixtures/factory-run-turns.json";
import runWorkers from "../fixtures/factory-run-workers.json";
import {
	daemon,
	EventFeed,
	type FactoryRequest,
	hub,
	hubUrl,
	laptopSocket,
} from "../support/factory.ts";
import { openEventStream, readWhere, settledRead } from "../support/reads.ts";
import {
	boxRow,
	factoryRunOf,
	overviewEventWhere,
	overviewWhere,
	runPollMs,
	serveRuns,
} from "./_support.ts";

describe("factory runs", () => {
	describe("the run checkpoint", () => {
		const checkpointPath = `/runs/${hubRuns.runs[0]?.id}/checkpoint`;

		async function checkpointOf(base: string): Promise<Response> {
			const body = await overviewWhere(
				base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			const id = factoryRunOf(body, 41)?.id ?? "";
			return settledRead(
				new URL(`/api/factory-runs/${encodeURIComponent(id)}/checkpoint`, base),
			);
		}

		test("the ticket's run carries the current stage, completed stages, retries, visits and run context of its recorded checkpoint, and no graph from a factory that serves none", async () => {
			const app = await serveRuns(
				{ ...hub, [checkpointPath]: hubCheckpoint },
				[41],
			);
			try {
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					stage: "review",
					completedStages: ["start", "plan", "build", "review", "build"],
					retries: { build: 1 },
					visits: { start: 1, plan: 1, build: 2, review: 2 },
					context: { outcome: "changes_requested" },
					usageNotServed: true,
					graph: null,
				});
			} finally {
				await app.stop();
			}
		});

		test("the run carries the nodes and edges of its recorded graph, with the shape of each node, the condition of each edge and the state of each node from the checkpoint", async () => {
			const graphPath = `/runs/${hubRuns.runs[0]?.id}/graph`;
			const app = await serveRuns(
				{
					...hub,
					[checkpointPath]: {
						...runGraphCheckpoint,
						node_retries: { push: 1 },
					},
					[graphPath]: runGraph,
				},
				[41],
			);
			try {
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(200);
				const { stage, graph } = (await response.json()) as RunCheckpoint;
				expect(stage).toBe("post_pr/post_pr");
				expect(graph?.nodes.map((node) => node.id)).toEqual(
					runGraph.nodes.map((node) => node.id),
				);
				const nodeOf = (id: string) =>
					graph?.nodes.find((node) => node.id === id);
				expect(nodeOf("post_pr")).toEqual({
					id: "post_pr",
					label: "Post PR",
					shape: "box",
					kind: "codergen",
					state: "current",
					visits: 0,
					retries: 0,
					child: [
						{
							id: "post_pr/start",
							label: "start",
							state: "completed",
							visits: 1,
							retries: 0,
						},
						{
							id: "post_pr/draft_pr",
							label: "draft_pr",
							state: "completed",
							visits: 1,
							retries: 0,
						},
						{
							id: "post_pr/post_pr",
							label: "post_pr",
							state: "current",
							visits: 2,
							retries: 0,
						},
					],
				});
				expect(nodeOf("report")).toMatchObject({ child: [] });
				expect(
					Object.fromEntries(
						(graph?.nodes ?? []).map((node) => [node.shape, node.kind]),
					),
				).toEqual({
					Mdiamond: "start",
					Msquare: "exit",
					parallelogram: "tool",
					hexagon: "wait.human",
					box: "codergen",
					component: "parallel",
					tripleoctagon: "parallel.fan_in",
				});
				expect(nodeOf("fan")).toMatchObject({ visits: 2 });
				expect(nodeOf("review")).toMatchObject({ state: "completed" });
				expect(nodeOf("push")).toMatchObject({
					state: "completed",
					retries: 1,
				});
				expect(nodeOf("report")).toMatchObject({ state: "ahead" });
				expect(nodeOf("exit")).toMatchObject({ state: "ahead" });
				expect(graph?.edges).toHaveLength(runGraph.edges.length);
				expect(graph?.edges).toContainEqual({
					from: "push",
					to: "fan",
					label: "pushed",
					condition: "outcome=success",
				});
				expect(graph?.edges).toContainEqual({
					from: "handoff_operator",
					to: "handoff_operator",
					label: "remind",
					condition: "preferred_label=remind",
				});
				expect(graph?.edges).toContainEqual({
					from: "join",
					to: "check",
					condition: "context.through!=implement",
				});
				expect(graph?.edges).toContainEqual({ from: "fan", to: "verify" });
			} finally {
				await app.stop();
			}
		});

		test("a stage that called a child graph keeps the child stages that the call completed after the run leaves it", async () => {
			const graphPath = `/runs/${hubRuns.runs[0]?.id}/graph`;
			const { stack: _, ...left } = runGraphCheckpoint;
			const app = await serveRuns(
				{
					...hub,
					[checkpointPath]: {
						...left,
						current_node: "exit",
						completed_nodes: [...runGraphCheckpoint.completed_nodes, "post_pr"],
						status: "success",
					},
					[graphPath]: runGraph,
				},
				[41],
			);
			try {
				const { stage, graph } = (await (
					await checkpointOf(app.base)
				).json()) as RunCheckpoint;
				expect(stage).toBe("exit");
				const nodeOf = (id: string) =>
					graph?.nodes.find((node) => node.id === id);
				expect(nodeOf("post_pr")).toMatchObject({
					state: "completed",
					child: [
						{
							id: "post_pr/start",
							label: "start",
							state: "completed",
							visits: 1,
							retries: 0,
						},
						{
							id: "post_pr/draft_pr",
							label: "draft_pr",
							state: "completed",
							visits: 1,
							retries: 0,
						},
						{
							id: "post_pr/post_pr",
							label: "post_pr",
							state: "completed",
							visits: 1,
							retries: 0,
						},
					],
				});
				expect(nodeOf("conceptual")).toMatchObject({
					state: "completed",
					child: [],
				});
			} finally {
				await app.stop();
			}
		});

		test("a stage that calls its child graph again keeps the child stages of the earlier call and counts the visits of both calls", async () => {
			const graphPath = `/runs/${hubRuns.runs[0]?.id}/graph`;
			const review = ["push", "fan", "verify", "review", "conceptual", "join"];
			const app = await serveRuns(
				{
					...hub,
					[checkpointPath]: {
						...runGraphCheckpoint,
						current_node: "summary",
						stack: [{ node: "report" }],
						completed_nodes: [
							"start",
							"inputs",
							"implement",
							...review,
							"start",
							"verdict",
							"summary",
							"report",
							...review,
							"start",
						],
						status: "running",
					},
					[graphPath]: runGraph,
				},
				[41],
			);
			try {
				const { stage, graph } = (await (
					await checkpointOf(app.base)
				).json()) as RunCheckpoint;
				expect(stage).toBe("report/summary");
				expect(
					graph?.nodes.find((node) => node.id === "report")?.child,
				).toEqual([
					{
						id: "report/start",
						label: "start",
						state: "completed",
						visits: 2,
						retries: 0,
					},
					{
						id: "report/verdict",
						label: "verdict",
						state: "completed",
						visits: 1,
						retries: 0,
					},
					{
						id: "report/summary",
						label: "summary",
						state: "current",
						visits: 2,
						retries: 0,
					},
				]);
			} finally {
				await app.stop();
			}
		});

		test("a failed checkpoint marks the stage where the run failed", async () => {
			const graphPath = `/runs/${hubRuns.runs[0]?.id}/graph`;
			const app = await serveRuns(
				{
					...hub,
					[checkpointPath]: { ...runGraphCheckpoint, status: "fail" },
					[graphPath]: runGraph,
				},
				[41],
			);
			try {
				const { graph } = (await (
					await checkpointOf(app.base)
				).json()) as RunCheckpoint;
				const postPr = graph?.nodes.find((node) => node.id === "post_pr");
				expect(postPr?.state).toBe("failed");
				expect(postPr?.child?.at(-1)).toMatchObject({
					id: "post_pr/post_pr",
					state: "failed",
				});
			} finally {
				await app.stop();
			}
		});

		test("a run that the hub and its box report reads the checkpoint and its run context from the box, and the hub gets no read", async () => {
			const [running41] = hubRuns.runs;
			if (running41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				{ ...hub, [checkpointPath]: hubCheckpoint },
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(running41, "running")] },
					[checkpointPath]: {
						...hubCheckpoint,
						context_values: { outcome: "from the box" },
					},
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toMatchObject({
					stage: "review",
					context: { outcome: "from the box" },
				});
				expect(
					new Set(
						app.requests
							.filter(
								(request) => new URL(request.url).pathname === checkpointPath,
							)
							.map((request) => request.unix ?? new URL(request.url).origin),
					),
				).toEqual(new Set([laptopSocket]));
			} finally {
				await app.stop();
			}
		});

		test("a run whose factory answers the checkpoint read with 404 reports it as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		describe("the run usage", () => {
			const turnsPath = `/runs/${hubRuns.runs[0]?.id}/turns`;

			test("the run checkpoint read gives the tokens, cost, time and tool counts of each stage and of the run from its recorded turns", async () => {
				const app = await serveRuns(
					{ ...hub, [checkpointPath]: hubCheckpoint, [turnsPath]: runTurns },
					[41],
				);
				try {
					const response = await checkpointOf(app.base);
					expect(response.status).toBe(200);
					const detail = (await response.json()) as RunCheckpoint;
					expect(detail.usage).toEqual({
						stages: {
							plan: {
								inputTokens: 41200,
								outputTokens: 1830,
								costUsd: 0.3125,
								durationS: 94.5,
								tools: { Read: 6, Bash: 2 },
							},
							build: {
								inputTokens: 245500,
								outputTokens: 12570,
								costUsd: 2,
								durationS: 813.5,
								tools: { Read: 11, Edit: 10, Bash: 13 },
							},
							review: {
								inputTokens: 24000,
								outputTokens: 700,
								costUsd: 0,
								durationS: 48,
								tools: { command_execution: 3 },
							},
						},
						total: {
							inputTokens: 310700,
							outputTokens: 15100,
							costUsd: 2.3125,
							durationS: 956,
							tools: { Read: 17, Bash: 15, Edit: 10, command_execution: 3 },
						},
					});
				} finally {
					await app.stop();
				}
			});

			test("a run that only the hub reports reads its turns from the hub", async () => {
				const app = await serveRuns(
					{ ...hub, [checkpointPath]: hubCheckpoint, [turnsPath]: runTurns },
					[41],
				);
				try {
					const detail = (await (
						await checkpointOf(app.base)
					).json()) as RunCheckpoint;
					expect(detail.usage?.total.costUsd).toBe(2.3125);
					expect(
						new Set(
							app.requests
								.filter((request) => request.url.endsWith("/turns"))
								.map((request) => request.url),
						),
					).toEqual(new Set([`${hubUrl}${turnsPath}`]));
				} finally {
					await app.stop();
				}
			});

			test("a factory that answers the turns read with 404 gives the run checkpoint with no usage, and reports the usage as not served", async () => {
				const app = await serveRuns(
					{ ...hub, [checkpointPath]: hubCheckpoint },
					[41],
				);
				try {
					const response = await checkpointOf(app.base);
					expect(response.status).toBe(200);
					const detail = (await response.json()) as RunCheckpoint;
					expect(detail.stage).toBe("review");
					expect(detail).not.toHaveProperty("usage");
					expect(detail.usageNotServed).toBe(true);
				} finally {
					await app.stop();
				}
			});
		});
	});

	describe("the run agents", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const workersPath = `/runs/${running41}/workers`;

		function workerReads(requests: FactoryRequest[]): number {
			return requests.filter(
				(request) => new URL(request.url).pathname === workersPath,
			).length;
		}

		async function agentsOf(base: string, runId: string): Promise<Response> {
			return settledRead(
				new URL(`/api/factory-runs/${encodeURIComponent(runId)}/agents`, base),
			);
		}

		test("the run detail gives the tool, last message and turn of each running agent and of the current stage", async () => {
			const feed = new EventFeed();
			const app = await serveRuns(
				{ ...hub, "/events": feed, [workersPath]: runWorkers },
				[41],
			);
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				await stream.ready;
				const [stageStarted] = hubEvents;
				feed.send({
					...stageStarted,
					item: { ...stageStarted?.item, node_path: "report/report" },
				});
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.stage === "report/report",
				);
				const response = await agentsOf(app.base, running41);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					agents: [
						{
							stage: "fix",
							tool: "Bash",
							lastMessage: "LABEL: fixed",
							turn: "running",
						},
						{
							stage: "report/report",
							tool: null,
							lastMessage:
								"When round 3 ends, the run reaches the final report node again and I write and publish the report then.",
							turn: "ended",
						},
					],
				});
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("the app reads /workers only when a client asks for the agents of a live run", async () => {
			const app = await serveRuns({ ...hub, [workersPath]: runWorkers }, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				expect(workerReads(app.requests)).toBe(0);
				await agentsOf(app.base, running41);
				expect(workerReads(app.requests)).toBeGreaterThan(0);
			} finally {
				await app.stop();
			}
		});

		test("a run that ends gives no agents and reads /workers no more", async () => {
			const app = await serveRuns({ ...hub, [workersPath]: runWorkers }, [41]);
			const stream = openEventStream(app.base);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				expect(
					(
						(await (await agentsOf(app.base, running41)).json()) as {
							agents: unknown[];
						}
					).agents,
				).toHaveLength(1);
				const [running, ...rest] = hubRuns.runs;
				app.factories[hubUrl] = {
					...hub,
					[workersPath]: runWorkers,
					"/runs": {
						runs: [{ ...running, status: { kind: "succeeded" } }, ...rest],
					},
				};
				app.advance(runPollMs);
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "succeeded",
				);
				await readWhere<{ agents: unknown[] }>(
					new URL(
						`/api/factory-runs/${encodeURIComponent(running41)}/agents`,
						app.base,
					),
					(body) => body.agents.length === 0,
				);
				const reads = workerReads(app.requests);
				const response = await agentsOf(app.base, running41);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ agents: [] });
				expect(workerReads(app.requests)).toBe(reads);
			} finally {
				stream.close();
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
				const response = await agentsOf(app.base, "no-such-run");
				expect(response.status).toBe(404);
			} finally {
				await app.stop();
			}
		});
	});

	describe("the run events", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const eventsPath = `/runs/${running41}/events`;

		type Sent = { id?: string; event?: string; data: unknown };

		/** Each SSE event of an API stream, without its comment lines. */
		function sentOf(text: string): Sent[] {
			return text
				.split("\n\n")
				.map((block) => {
					const fields = new Map(
						block
							.split("\n")
							.filter((line) => !line.startsWith(":") && line.includes(":"))
							.map((line) => {
								const at = line.indexOf(":");
								return [line.slice(0, at), line.slice(at + 1).trim()];
							}),
					);
					const data = fields.get("data");
					if (data === undefined) {
						return null;
					}
					const id = fields.get("id");
					const event = fields.get("event");
					return {
						...(id === undefined ? {} : { id }),
						...(event === undefined ? {} : { event }),
						data: JSON.parse(data),
					};
				})
				.filter((sent) => sent !== null);
		}

		function shown(frame: (typeof runEvents)[number]): Sent {
			return {
				id: frame.id,
				data: {
					id: frame.id,
					event: frame.item.event,
					stage: frame.item.node_path,
					at: frame.recorded_at,
					data: frame.item.data,
				},
			};
		}

		async function eventsOf(
			base: string,
			headers: Record<string, string> = {},
		): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return fetch(
				new URL(
					`/api/factory-runs/${encodeURIComponent(running41)}/events`,
					base,
				),
				{ headers },
			);
		}

		async function untilSent(
			read: ReadableStreamDefaultReader<Uint8Array>,
			accept: (sent: Sent[]) => boolean,
		): Promise<Sent[]> {
			const decoder = new TextDecoder();
			let text = "";
			while (!accept(sentOf(text))) {
				const chunk = await read.read();
				if (chunk.done) {
					break;
				}
				text += decoder.decode(chunk.value, { stream: true });
			}
			return sentOf(text);
		}

		test("a run on a box streams every event of the run through the hub, then its new events, then the end of the run", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, [eventsPath]: feed }, [41]);
			try {
				const response = await eventsOf(app.base);
				expect(response.status).toBe(200);
				expect(response.headers.get("content-type")).toBe("text/event-stream");
				const read = response.body?.getReader();
				if (read === undefined) {
					throw new Error("the event stream has no body");
				}
				await feed.connected(1);
				for (const frame of runEvents) {
					feed.send(frame);
				}
				const replay = await untilSent(
					read,
					(sent) => sent.length === runEvents.length,
				);
				expect(replay).toEqual(runEvents.map(shown));
				const [, , , , , , turnEnded] = runEvents;
				if (turnEnded === undefined) {
					throw new Error("the run events fixture lost an event");
				}
				const live = {
					...turnEnded,
					seq: 8,
					id: "7c3a9d8e6f5b4a4c5d0e9f8a7b6c5d08",
					recorded_at: "2026-10-25T14:21:03.512+00:00",
					item: {
						event: "stage.completed",
						node_path: "plan",
						data: { name: "plan", index: 1, duration: 1193.0 },
					},
				};
				feed.send(live);
				feed.drop();
				expect(await untilSent(read, () => false)).toEqual([
					shown(live),
					{ event: "end", data: { reason: "ended" } },
				]);
				expect(
					app.requests
						.filter((request) => new URL(request.url).pathname === eventsPath)
						.map((request) => request.url),
				).toEqual([`${hubUrl}${eventsPath}`]);
			} finally {
				await app.stop();
			}
		});

		test("a Last-Event-ID sent to the app reaches the hub, so the stream starts after that event", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, [eventsPath]: feed }, [41]);
			const [, , seen] = runEvents;
			if (seen === undefined) {
				throw new Error("the run events fixture lost an event");
			}
			try {
				const response = await eventsOf(app.base, {
					"last-event-id": seen.id,
				});
				await feed.connected(1);
				expect(
					app.requests
						.filter((request) => new URL(request.url).pathname === eventsPath)
						.map((request) => request.lastEventId),
				).toEqual([seen.id]);
				const rest = runEvents.slice(3);
				for (const frame of rest) {
					feed.send(frame);
				}
				feed.drop();
				expect(await response.text().then(sentOf)).toEqual([
					...rest.map(shown),
					{ event: "end", data: { reason: "ended" } },
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 on the run events ends the stream as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await eventsOf(app.base);
				expect(response.status).toBe(200);
				expect(sentOf(await response.text())).toEqual([
					{ event: "end", data: { reason: "not served" } },
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that does not answer ends the stream as unreachable", async () => {
			const app = await serveRuns(
				{
					...hub,
					[eventsPath]: () => new Response("bad gateway", { status: 502 }),
				},
				[41],
			);
			try {
				const response = await eventsOf(app.base);
				expect(sentOf(await response.text())).toEqual([
					{ event: "end", data: { reason: "unreachable" } },
				]);
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
				const response = await fetch(
					new URL("/api/factory-runs/no-such-run/events", app.base),
				);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});
	});
});
