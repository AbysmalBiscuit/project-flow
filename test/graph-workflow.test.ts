import { afterAll, describe, expect, test } from "bun:test";

import ELK from "elkjs/lib/elk-api.js";

import type { RunGraph } from "../src/domain.ts";
import type { Point, Rect } from "../src/graph-core.ts";
import {
	type LaidEdge,
	layoutWorkflow,
	stageSize,
} from "../src/graph-workflow.ts";
import type { GraphDirection } from "../src/view-settings.ts";

const elk = new ELK({
	workerFactory: () =>
		new Worker(require.resolve("elkjs/lib/elk-worker.min.js")),
});
afterAll(() => elk.terminateWorker());

// The run graph that the API gives for the recorded PrePr run, inside the
// child graph of its `post_pr` stage.
const graph = (await Bun.file(
	new URL("./fixtures/run-graph-report.json", import.meta.url),
).json()) as RunGraph;

const textSize = (text: string) => ({ width: text.length * 7, height: 16 });

const layout = (direction: GraphDirection, open: string[] = ["post_pr"]) =>
	layoutWorkflow(elk, graph, new Set(open), direction, textSize);

const rectOf = (at: Point | undefined): Rect => ({
	x: at?.x ?? Number.NaN,
	y: at?.y ?? Number.NaN,
	...stageSize,
});

const overlaps = (left: Rect, right: Rect) =>
	left.x < right.x + right.width &&
	right.x < left.x + left.width &&
	left.y < right.y + right.height &&
	right.y < left.y + left.height;

const inside = (inner: Rect, outer: Rect) =>
	inner.x >= outer.x &&
	inner.y >= outer.y &&
	inner.x + inner.width <= outer.x + outer.width &&
	inner.y + inner.height <= outer.y + outer.height;

/** True when `point` lies on the border of `rect`, give or take one unit. */
const onBorder = (point: Point | undefined, rect: Rect) =>
	point !== undefined &&
	point.x >= rect.x - 1 &&
	point.x <= rect.x + rect.width + 1 &&
	point.y >= rect.y - 1 &&
	point.y <= rect.y + rect.height + 1;

const edgeOf = (edges: LaidEdge[], from: string, to: string) =>
	edges.find((edge) => edge.from === from && edge.to === to);

describe("workflow layout of the recorded run graph", () => {
	test("places each stage of each node shape once, with no two stages over each other", async () => {
		const { stages } = await layout("top-to-bottom");
		expect(new Set(graph.nodes.map((node) => node.shape))).toEqual(
			new Set([
				"Mdiamond",
				"Msquare",
				"parallelogram",
				"hexagon",
				"box",
				"component",
				"tripleoctagon",
			]),
		);
		const child = graph.nodes.flatMap((node) => node.child ?? []);
		expect([...stages.keys()].toSorted()).toEqual(
			[...graph.nodes, ...child].map((stage) => stage.id).toSorted(),
		);
		const rects = [...stages.values()].map(rectOf);
		const crossing = rects.flatMap((left, index) =>
			rects.slice(index + 1).filter((right) => overlaps(left, right)),
		);
		expect(crossing).toEqual([]);
	});

	test("routes a back edge from its stage to an earlier stage", async () => {
		const { stages, edges } = await layout("top-to-bottom");
		const back = edgeOf(edges, "handoff_missing", "inputs");
		const from = rectOf(stages.get("handoff_missing"));
		const to = rectOf(stages.get("inputs"));
		expect(to.y).toBeLessThan(from.y);
		expect(back?.points.length).toBeGreaterThanOrEqual(2);
		expect(onBorder(back?.points[0], from)).toBe(true);
		expect(onBorder(back?.points.at(-1), to)).toBe(true);
	});

	test("routes a self-loop out of its stage and back into it", async () => {
		const { stages, edges } = await layout("top-to-bottom");
		const loop = edgeOf(edges, "handoff_operator", "handoff_operator");
		const stage = rectOf(stages.get("handoff_operator"));
		expect(loop?.points.length).toBeGreaterThan(2);
		expect(onBorder(loop?.points[0], stage)).toBe(true);
		expect(onBorder(loop?.points.at(-1), stage)).toBe(true);
		expect(loop?.points.some((point) => !onBorder(point, stage))).toBe(true);
	});

	test("places the label of each conditional edge as its text, else its condition", async () => {
		const { edges } = await layout("top-to-bottom");
		const conditional = edges.filter((edge) => edge.condition !== undefined);
		expect(conditional).toHaveLength(
			graph.edges.filter((edge) => edge.condition !== undefined).length,
		);
		for (const edge of conditional) {
			const text = edge.label ?? edge.condition ?? "";
			expect(edge.text).toMatchObject({ text, ...textSize(text) });
		}
		expect(edgeOf(edges, "inputs", "draft")?.text?.text).toBe(
			"preferred_label=draft",
		);
		expect(edgeOf(edges, "push", "fan")?.text?.text).toBe("pushed");
		expect(edgeOf(edges, "handoff_missing", "inputs")?.text?.text).toBe(
			"retry",
		);
		expect(edgeOf(edges, "fan", "verify")?.text).toBeUndefined();
	});

	test("frames the child graph stages of an open caller under the caller", async () => {
		const { stages, frames, edges } = await layout("top-to-bottom");
		const frame = frames.get("post_pr");
		if (frame === undefined) {
			throw new Error("the open caller has no frame");
		}
		const caller = rectOf(stages.get("post_pr"));
		expect(inside(caller, frame)).toBe(true);
		for (const id of ["post_pr/start", "post_pr/draft_pr", "post_pr/post_pr"]) {
			const stage = rectOf(stages.get(id));
			expect(inside(stage, frame)).toBe(true);
			expect(stage.y).toBeGreaterThan(caller.y + caller.height);
		}
		expect(
			onBorder(edgeOf(edges, "receive", "post_pr")?.points.at(-1), frame),
		).toBe(true);
	});

	test("draws a closed caller as one stage with no frame", async () => {
		const { stages, frames } = await layout("top-to-bottom", []);
		expect(frames.size).toBe(0);
		expect(stages.has("post_pr")).toBe(true);
		expect(stages.has("post_pr/draft_pr")).toBe(false);
	});

	test("turns the flow down or right with the direction", async () => {
		const down = await layout("top-to-bottom");
		const right = await layout("left-to-right");
		const step = (laid: typeof down) => {
			const start = laid.stages.get("start");
			const inputs = laid.stages.get("inputs");
			return {
				x: (inputs?.x ?? 0) - (start?.x ?? 0),
				y: (inputs?.y ?? 0) - (start?.y ?? 0),
			};
		};
		expect(step(down).y).toBeGreaterThan(0);
		expect(step(right).x).toBeGreaterThan(0);
	});
});
