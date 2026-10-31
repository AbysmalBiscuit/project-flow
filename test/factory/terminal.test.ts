import { describe, expect, test } from "bun:test";

import type { RunCheckpoint } from "../../src/domain.ts";
import hubCheckpoint from "../fixtures/factory-hub-checkpoint.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import runGraphCheckpoint from "../fixtures/factory-run-graph-checkpoint.json";
import runGraph from "../fixtures/factory-run-graph.json";
import { hub } from "../support/factory.ts";
import { checkpointOf, serveRuns } from "./_support.ts";

const runId = hubRuns.runs[0]?.id;
const checkpointPath = `/runs/${runId}/checkpoint`;
const graphPath = `/runs/${runId}/graph`;

async function lastAgentStageOf(
	checkpoint: Record<string, unknown>,
	graph: unknown,
): Promise<string | null> {
	const app = await serveRuns(
		{
			...hub,
			[checkpointPath]: checkpoint,
			...(graph === null ? {} : { [graphPath]: graph }),
		},
		[41],
	);
	try {
		const response = await checkpointOf(app.base);
		expect(response.status).toBe(200);
		return ((await response.json()) as RunCheckpoint).lastAgentStage;
	} finally {
		await app.stop();
	}
}

describe("the last agent stage of a run", () => {
	test("a run that succeeded at its exit gives its last finished stage that ran an agent", async () => {
		expect(
			await lastAgentStageOf(
				{
					...runGraphCheckpoint,
					stack: [],
					current_node: "exit",
					completed_nodes: ["start", "inputs", "implement", "push"],
					status: "success",
				},
				runGraph,
			),
		).toBe("implement");
	});

	test("a run that failed at an agent stage gives that stage", async () => {
		expect(
			await lastAgentStageOf(
				{
					...runGraphCheckpoint,
					stack: [],
					current_node: "verify",
					completed_nodes: ["start", "inputs", "implement", "push", "fan"],
					status: "fail",
				},
				runGraph,
			),
		).toBe("verify");
	});

	test("a run whose last agent stage is in a child graph gives the full path of that child stage", async () => {
		const { stack: _, ...left } = runGraphCheckpoint;
		expect(
			await lastAgentStageOf(
				{
					...left,
					current_node: "exit",
					completed_nodes: [...runGraphCheckpoint.completed_nodes, "post_pr"],
					status: "success",
				},
				runGraph,
			),
		).toBe("post_pr/post_pr");
	});

	test("a factory that serves no graph gives the current stage of an open run, and the last finished stage of a succeeded run", async () => {
		expect(await lastAgentStageOf(hubCheckpoint, null)).toBe("review");
		expect(
			await lastAgentStageOf(
				{ ...hubCheckpoint, current_node: "exit", status: "success" },
				null,
			),
		).toBe("build");
	});
});
