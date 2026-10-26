import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
	type Edge,
	Handle,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
} from "@xyflow/react";
import { useMemo } from "react";

import type {
	RunGraph as Graph,
	RunGraphNode,
	ShownFactoryRun,
} from "./domain.ts";
import { elk } from "./graph-laid.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { runGraphHelp, runGraphLabel, stageRetriesLabel } from "./terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const stageWidth = 168;
const stageHeight = 44;

type Placed = ReadonlyMap<string, { x: number; y: number }>;

type StageNode = Node<{ stage: RunGraphNode }, "stage">;

const styles = stylex.create({
	pane: {
		height: measure.runGraph,
		margin: `0 0 ${space.md}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
		"--xy-edge-stroke": colours.graphEdge,
		"--xy-edge-stroke-width": measure.hairline,
		"--xy-background-color": colours.raised,
	},
	stage: {
		display: "flex",
		flexDirection: "column",
		justifyContent: "center",
		boxSizing: "border-box",
		width: "100%",
		height: "100%",
		paddingInline: space.sm,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderRadius: radius.sm,
		color: colours.ink,
		fontSize: type.meta,
		lineHeight: type.line,
	},
	current: {
		borderWidth: measure.focus,
		borderColor: colours.accent,
		backgroundColor: colours.chip,
		color: colours.chipInk,
		fontWeight: type.weight,
	},
	completed: {
		borderColor: colours.lineStrong,
		backgroundColor: colours.surfaceMuted,
	},
	ahead: {
		borderStyle: "dashed",
		borderColor: colours.lineStrong,
		backgroundColor: colours.raised,
		color: colours.inkSoft,
	},
	label: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	retries: {
		color: colours.warnInk,
		fontWeight: type.weight,
	},
	handle: {
		opacity: 0,
	},
});

function Stage({ data: { stage } }: NodeProps<StageNode>) {
	return (
		<div
			className={clsx(styles.stage, styles[stage.state])}
			title={stage.label}
			data-stage={stage.id}
			data-stage-state={stage.state}
			data-stage-retries={stage.retries}
		>
			<Handle
				type="target"
				position={Position.Top}
				className={clsx(styles.handle)}
			/>
			<span className={clsx(styles.label)}>{stage.label}</span>
			{stage.retries === 0 ? null : (
				<span className={clsx(styles.retries)}>
					{stageRetriesLabel(stage.retries)}
				</span>
			)}
			<Handle
				type="source"
				position={Position.Bottom}
				className={clsx(styles.handle)}
			/>
		</div>
	);
}

const nodeTypes = { stage: Stage };

/** The edges between two stages of the graph. A loop on one stage is left out. */
function drawnEdges(graph: Graph) {
	const ids = new Set(graph.nodes.map((node) => node.id));
	return graph.edges.filter(
		(edge) => edge.from !== edge.to && ids.has(edge.from) && ids.has(edge.to),
	);
}

async function layout(graph: Graph): Promise<Placed> {
	const laid = await elk().layout({
		id: "run",
		layoutOptions: { "elk.algorithm": "layered", "elk.direction": "DOWN" },
		children: graph.nodes.map((node) => ({
			id: node.id,
			width: stageWidth,
			height: stageHeight,
		})),
		edges: drawnEdges(graph).map((edge, index) => ({
			id: `${index}`,
			sources: [edge.from],
			targets: [edge.to],
		})),
	});
	return new Map(
		(laid.children ?? []).map((child) => [
			child.id,
			{ x: child.x ?? 0, y: child.y ?? 0 },
		]),
	);
}

/** Lays out the graph top to bottom. The checkpoint changes the marks, so only a new shape lays it out again. */
function usePlaced(graph: Graph): Placed | undefined {
	const shape = JSON.stringify([
		graph.nodes.map((node) => node.id),
		drawnEdges(graph).map((edge) => [edge.from, edge.to]),
	]);
	return useQuery({
		queryKey: ["runGraphLayout", shape],
		queryFn: () => layout(graph),
		staleTime: Number.POSITIVE_INFINITY,
	}).data;
}

function flowOf(graph: Graph, placed: Placed) {
	const nodes: StageNode[] = graph.nodes.map((stage) => ({
		id: stage.id,
		type: "stage",
		position: placed.get(stage.id) ?? { x: 0, y: 0 },
		width: stageWidth,
		height: stageHeight,
		data: { stage },
	}));
	const drawn = drawnEdges(graph);
	const edges: Edge[] = drawn.map((edge, index) => ({
		id: `${index}`,
		source: edge.from,
		target: edge.to,
	}));
	const current = graph.nodes.find((stage) => stage.state === "current");
	return { nodes, edges, current };
}

function GraphPane({ graph }: { graph: Graph }) {
	const placed = usePlaced(graph);
	const flow = useMemo(
		() => (placed === undefined ? null : flowOf(graph, placed)),
		[graph, placed],
	);
	return (
		<figure
			className={clsx(styles.pane)}
			aria-label={runGraphLabel}
			title={runGraphHelp}
		>
			{flow === null ? null : (
				// The project page wraps the side panel in the ticket graph's provider, and a ReactFlow under a provider uses its store.
				<ReactFlowProvider>
					<ReactFlow
						nodes={flow.nodes}
						edges={flow.edges}
						nodeTypes={nodeTypes}
						nodesDraggable={false}
						nodesConnectable={false}
						nodesFocusable={false}
						elementsSelectable={false}
						zoomOnDoubleClick={false}
						fitView
						// The whole graph is too small to read in the panel, so the view opens on the current stage.
						fitViewOptions={{
							maxZoom: 0.75,
							...(flow.current === undefined
								? {}
								: { nodes: [{ id: flow.current.id }] }),
						}}
						minZoom={0.1}
						proOptions={{ hideAttribution: true }}
					/>
				</ReactFlowProvider>
			)}
		</figure>
	);
}

/** The run's workflow graph, with the current, completed and retried stages marked from the run checkpoint. */
export function RunGraph({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	const graph = typeof data === "object" ? data.graph : null;
	if (graph === null) {
		return null;
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runGraphLabel}</h3>
			<GraphPane graph={graph} />
		</>
	);
}
