import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";

import type { RunGraph, RunGraphEdge } from "./domain.ts";
import {
	directionOptions,
	frameTree,
	padding,
	placeTree,
	type Point,
	type Rect,
} from "./graph-core.ts";
import type { FlowGap } from "./graph-flow.ts";
import type { NodeSize } from "./graph-sizes.ts";
import type { GraphDirection } from "./view-settings.ts";

export const stageSize = { width: 216, height: 84 };

const stageGap: FlowGap = { along: 300, across: 140 };

/** The gap between a child graph frame's border and its stages. */
export const stageFramePad = 16;

const rootId = "root";

/** The id of the frame around the child graph that the stage `caller` calls. */
export function stageFrameId(caller: string): string {
	return `frame\n${caller}`;
}

/** The text that an edge shows: its label, else its condition. */
export function edgeText(edge: RunGraphEdge): string | undefined {
	return edge.label ?? edge.condition;
}

/** A laid edge: the points of its route, and the place of its text. */
export type LaidEdge = RunGraphEdge & {
	id: string;
	points: Point[];
	text?: Rect & { text: string };
};

export type WorkflowLayout = {
	stages: Map<string, Point>;
	/** The frame of each open child graph, its caller stage at the top. */
	frames: Map<string, Rect>;
	edges: LaidEdge[];
};

/** The callers whose child graph frame is open and holds at least one stage. */
function openCallers(graph: RunGraph, open: ReadonlySet<string>): Set<string> {
	return new Set(
		graph.nodes
			.filter((node) => open.has(node.id) && (node.child?.length ?? 0) > 0)
			.map((node) => node.id),
	);
}

/** Each edge that ELK laid out, below each node of the laid tree. */
function laidEdges(laid: ElkNode): ElkExtendedEdge[] {
	return [
		...(laid.edges ?? []),
		...(laid.children ?? []).flatMap((child) => laidEdges(child)),
	];
}

/**
 * Lays out a run's workflow graph with ELK `layered`, back edges and self-loops kept.
 *
 * The layout has no layer bound. `textSize` sizes the text of each edge. Each
 * caller in `open` frames its child graph stages, with the caller at the top.
 */
export async function layoutWorkflow(
	elk: ELK,
	graph: RunGraph,
	open: ReadonlySet<string>,
	direction: GraphDirection,
	textSize: (text: string) => NodeSize,
): Promise<WorkflowLayout> {
	const framed = openCallers(graph, open);
	// A workflow loops back often. Breaking cycles depth first from the nodes in
	// workflow order keeps each edge out of start pointing along the flow.
	const options = {
		...directionOptions(direction, stageSize, stageGap),
		"elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
		"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
	};
	const holderOf = new Map<string, string>();
	for (const node of graph.nodes) {
		if (!framed.has(node.id)) {
			holderOf.set(node.id, rootId);
			continue;
		}
		holderOf.set(stageFrameId(node.id), rootId);
		for (const stage of node.child ?? []) {
			holderOf.set(stage.id, stageFrameId(node.id));
		}
	}
	const nodeOf = (id: string) => (framed.has(id) ? stageFrameId(id) : id);
	const frames = new Set([...framed].map(stageFrameId));
	const tree = frameTree({
		holderOf,
		optionsOf: (id) =>
			frames.has(id)
				? {
						...options,
						"elk.padding": padding(
							stageFramePad * 2 + stageSize.height,
							stageFramePad,
						),
						"elk.nodeSize.constraints": "MINIMUM_SIZE",
						"elk.nodeSize.minimum": `(${stageSize.width + stageFramePad * 2}, ${stageSize.height})`,
					}
				: undefined,
		sizeOf: () => stageSize,
		edges: graph.edges.map((edge, index) => {
			const text = edgeText(edge);
			return {
				from: nodeOf(edge.from),
				to: nodeOf(edge.to),
				...(text === undefined
					? {}
					: { labels: [{ id: `text${index}`, text, ...textSize(text) }] }),
			};
		}),
		selfLoops: true,
	});
	const laid = await elk.layout({
		id: rootId,
		layoutOptions: { ...options, "elk.json.edgeCoords": "ROOT" },
		children: tree.children(rootId),
		edges: tree.edgesIn(rootId),
	});
	const layout: WorkflowLayout = {
		stages: new Map(),
		frames: new Map(),
		edges: [],
	};
	for (const [id, rect] of placeTree(laid, { x: 0, y: 0 })) {
		const caller = [...framed].find((node) => stageFrameId(node) === id);
		if (caller === undefined) {
			layout.stages.set(id, { x: rect.x, y: rect.y });
			continue;
		}
		layout.frames.set(caller, rect);
		layout.stages.set(caller, {
			x: rect.x + stageFramePad,
			y: rect.y + stageFramePad,
		});
	}
	for (const edge of laidEdges(laid)) {
		const source = graph.edges[Number(edge.id.slice("edge".length))];
		if (source === undefined) {
			continue;
		}
		const points = (edge.sections ?? []).flatMap((section) => [
			section.startPoint,
			...(section.bendPoints ?? []),
			section.endPoint,
		]);
		const label = edge.labels?.[0];
		layout.edges.push({
			...source,
			id: edge.id,
			points,
			...(label?.text === undefined
				? {}
				: {
						text: {
							text: label.text,
							x: label.x ?? 0,
							y: label.y ?? 0,
							width: label.width ?? 0,
							height: label.height ?? 0,
						},
					}),
		});
	}
	return layout;
}
