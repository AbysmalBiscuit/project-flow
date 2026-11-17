import * as stylex from "@stylexjs/stylex";
import { MarkerType, type Viewport } from "@xyflow/react";

import { board } from "./board-styles.ts";
import type {
	RunAgent,
	RunCheckpoint,
	RunGraph as Graph,
	RunGraphEdge,
	RunGraphNodeState,
} from "./domain.ts";
import {
	diagramStageScale,
	runStageScale,
	stageFrameId,
	type WorkflowLayout,
} from "./graph-workflow.ts";
import type { FrameNode, RouteEdge, StageNode } from "./run-graph-nodes.tsx";
import type { StageFacts } from "./run-stage.tsx";
import { runStageStateLabel } from "./run-terms.ts";
import { measure, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const textHeight = 18;
const textCharWidth = 6.6;

/** The size of an edge text in the meta font, close enough for ELK to keep room for it. */
export function textSize(text: string) {
	return { width: text.length * textCharWidth + 8, height: textHeight };
}

/** The seed stages and their direct neighbours. A workflow graph loops, so a transitive chain would hold every stage. */
type StageFocus = { seeds: ReadonlySet<string>; lit: ReadonlySet<string> };

export function stageFocus(
	seeds: ReadonlySet<string>,
	edges: readonly RunGraphEdge[],
): StageFocus {
	const lit = new Set(seeds);
	for (const edge of edges) {
		if (seeds.has(edge.from)) {
			lit.add(edge.to);
		}
		if (seeds.has(edge.to)) {
			lit.add(edge.from);
		}
	}
	return { seeds, lit };
}

export function flowOf(
	graph: Graph,
	laid: WorkflowLayout,
	factsOf: (stage: StageFacts["stage"]) => StageFacts,
	open: ReadonlySet<string>,
	toggle: (id: string) => void,
	roles: boolean,
	calls: ReadonlyMap<string, string>,
	openGraph: (graph: string) => void,
	focus: StageFocus | null,
) {
	const callerOf = (id: string) => id.split("/")[0] ?? id;
	const kept = (id: string) => focus === null || focus.lit.has(callerOf(id));
	const seeded = (id: string) => focus?.seeds.has(callerOf(id)) === true;
	const frames: FrameNode[] = [...laid.frames].map(([caller, rect]) => ({
		id: stageFrameId(caller),
		type: "frame",
		position: { x: rect.x, y: rect.y },
		width: rect.width,
		height: rect.height,
		zIndex: -1,
		className: clsx(
			board.moves,
			focus !== null && !kept(caller) && board.faded,
		),
		data: {},
	}));
	const stages: StageNode[] = graph.nodes.flatMap((node) => {
		const stageNode = (
			stage: StageFacts["stage"],
			child: StageNode["data"]["child"],
			shape: string,
			kind: string,
			role: string | undefined,
		): StageNode[] => {
			const at = laid.stages.get(stage.id);
			return at === undefined
				? []
				: [
						{
							id: stage.id,
							type: "stage",
							position: at,
							...(roles ? diagramStageScale : runStageScale).size,
							className: clsx(board.moves, !kept(stage.id) && board.faded),
							data: {
								facts: factsOf(stage),
								shape,
								kind,
								child,
								role: roles ? { name: role } : null,
								opens: (() => {
									const graph = calls.get(stage.id);
									return graph === undefined
										? null
										: { graph, open: () => openGraph(graph) };
								})(),
							},
						},
					];
		};
		const child =
			node.child === undefined || node.child.length === 0
				? null
				: { open: open.has(node.id), toggle: () => toggle(node.id) };
		return [
			...stageNode(node, child, node.shape, node.kind, node.role),
			...(node.child ?? []).flatMap((stage) =>
				stageNode(stage, null, "box", "", undefined),
			),
		];
	});
	const frameOf = new Set(laid.frames.keys());
	const ends = (id: string) => (frameOf.has(id) ? stageFrameId(id) : id);
	const edges: RouteEdge[] = laid.edges.map((edge) => {
		const faded = focus !== null && !(seeded(edge.from) || seeded(edge.to));
		return {
			id: edge.id,
			type: "route",
			source: ends(edge.from),
			target: ends(edge.to),
			className: clsx(board.fades, faded && board.faded),
			markerEnd: { type: MarkerType.ArrowClosed },
			data: {
				points: edge.points,
				faded,
				...(edge.text === undefined ? {} : { text: edge.text }),
				...(edge.condition === undefined ? {} : { condition: edge.condition }),
			},
		};
	});
	return { nodes: [...frames, ...stages], edges };
}

export const states = Object.keys(runStageStateLabel).filter(
	(state): state is RunGraphNodeState =>
		Object.hasOwn(runStageStateLabel, state),
);

export const paneId = "run-graph";

export type RunState = {
	checkpoint: RunCheckpoint;
	agents: readonly RunAgent[];
	onPick: (stage: string) => void;
};

/** The diagram pane takes the shape of the laid graph, so the whole graph fills its width. */
export const fitted = stylex.create({
	shape: (width: number, height: number) => ({
		aspectRatio: `${width} / ${height}`,
		// A definite width keeps the minimum height from widening the pane through the ratio.
		boxSizing: "border-box",
		width: "100%",
		height: "auto",
		minHeight: measure.workflowDiagramMin,
		maxHeight: `min(calc(${height}px + 2 * ${space.xl}), ${measure.runGraph})`,
	}),
});

/** The share of the pane that the opening view fills. */
const paneFill = 0.92;

/** The box around the laid diagram: its stages, edge routes and edge texts. */
export function laidBounds(laid: WorkflowLayout) {
	const { width, height } = diagramStageScale.size;
	const points = [
		...[...laid.stages.values()].flatMap((point) => [
			point,
			{ x: point.x + width, y: point.y + height },
		]),
		...laid.edges.flatMap((edge) => [
			...edge.points,
			...(edge.text === undefined
				? []
				: [
						edge.text,
						{
							x: edge.text.x + edge.text.width,
							y: edge.text.y + edge.text.height,
						},
					]),
		]),
	];
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const left = Math.min(...xs);
	const top = Math.min(...ys);
	return {
		left,
		top,
		width: Math.max(...xs) - left,
		height: Math.max(...ys) - top,
	};
}

/** The whole diagram, centred in the pane, at zoom 1 or less. */
export function openingView(
	bounds: ReturnType<typeof laidBounds>,
	pane: { width: number; height: number },
): Viewport {
	const zoom = Math.min(
		1,
		(pane.width * paneFill) / bounds.width,
		(pane.height * paneFill) / bounds.height,
	);
	return {
		x: (pane.width - bounds.width * zoom) / 2 - bounds.left * zoom,
		y: (pane.height - bounds.height * zoom) / 2 - bounds.top * zoom,
		zoom,
	};
}

/** The graph files that the stages of a diagram call, by stage id, the action that opens one, and the action on a click on a stage. */
export type DiagramCalls = {
	calls: ReadonlyMap<string, string>;
	onOpen: (graph: string) => void;
	onPick: (stage: string) => void;
};

export const noCalls: DiagramCalls = {
	calls: new Map(),
	onOpen: () => {},
	onPick: () => {},
};
