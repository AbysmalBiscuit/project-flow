import {
	BaseEdge,
	EdgeLabelRenderer,
	type EdgeProps,
	type Edge as FlowEdge,
	type Node as FlowNode,
	getBezierPath,
	Handle,
	Position,
	ReactFlow,
	useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { CrossProjectBlocker, ProjectCounts } from "./domain.ts";
import { overviewControlLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards, shell } from "./ui-styles.ts";

const positionsKey = "project-flow-overview-graph";

function slug(value: string): string {
	const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	return cleaned.replace(/^-|-$/g, "") || "item";
}
const column = 280;
const row = 140;

type ProjectNodeData = {
	name: string;
	progress: number;
	needsYou: boolean;
};

type BlockerEdgeData = {
	ticket: string;
	project: string;
};

type SavedPositions = Record<string, { x: number; y: number }>;

function readPositions(): SavedPositions {
	try {
		const raw = localStorage.getItem(positionsKey);
		if (raw === null) {
			return {};
		}
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") {
			return {};
		}
		const saved: SavedPositions = {};
		for (const [id, value] of Object.entries(parsed)) {
			if (
				value !== null &&
				typeof value === "object" &&
				"x" in value &&
				"y" in value &&
				typeof value.x === "number" &&
				typeof value.y === "number"
			) {
				saved[id] = { x: value.x, y: value.y };
			}
		}
		return saved;
	} catch {
		return {};
	}
}

function writePositions(nodes: FlowNode<ProjectNodeData>[]): void {
	const saved: SavedPositions = {};
	for (const node of nodes) {
		saved[node.id] = node.position;
	}
	localStorage.setItem(positionsKey, JSON.stringify(saved));
}

function layout(index: number): { x: number; y: number } {
	return { x: (index % 3) * column, y: Math.floor(index / 3) * row };
}

function nodeId(name: string): string {
	return `project:${name}`;
}

function ProjectNode({ data }: { data: ProjectNodeData }) {
	return (
		<div
			className={clsx(cards.graphNode, data.needsYou && cards.graphNeedsYou)}
		>
			<Handle type="target" position={Position.Left} />
			<p className={clsx(cards.graphTitle)}>{data.name}</p>
			<div
				className={clsx(cards.graphBar)}
				role="progressbar"
				aria-valuenow={data.progress}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={data.name}
			>
				<div
					className={clsx(cards.graphFill)}
					style={{ width: `${data.progress}%` }}
				/>
			</div>
			<Handle type="source" position={Position.Right} />
		</div>
	);
}

function BlockerEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	data,
	markerEnd,
}: EdgeProps<FlowEdge<BlockerEdgeData>>) {
	const [path, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
	});
	const ticket = data?.ticket ?? "";
	const project = data?.project ?? "";
	return (
		<>
			<BaseEdge
				id={id}
				path={path}
				{...(markerEnd === undefined ? {} : { markerEnd })}
			/>
			<EdgeLabelRenderer>
				<button
					type="button"
					id={`edge-${slug(ticket)}`}
					className={`nopan ${clsx(cards.graphEdge)}`}
					style={{
						position: "absolute",
						transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
						pointerEvents: "all",
					}}
					aria-label={`${ticket} ${project}`}
					onClick={() => {
						window.location.assign(
							`/projects/${encodeURIComponent(project)}?ticket=${encodeURIComponent(ticket)}`,
						);
					}}
				>
					{ticket}
				</button>
			</EdgeLabelRenderer>
		</>
	);
}

const nodeTypes = { project: ProjectNode };
const edgeTypes = { blocker: BlockerEdge };

function graphModel(projects: ProjectCounts[]): {
	nodes: FlowNode<ProjectNodeData>[];
	edges: FlowEdge<BlockerEdgeData>[];
} {
	const names = new Set(projects.map((project) => project.name));
	const saved = readPositions();
	const nodes = projects.map((project, index) => ({
		id: nodeId(project.name),
		type: "project",
		position: saved[nodeId(project.name)] ?? layout(index),
		data: {
			name: project.name,
			progress: project.progress,
			needsYou: project.needsYou > 0,
		},
	}));
	const edges = projects.flatMap((project) =>
		project.crossProjectBlockers.flatMap((blocker) =>
			edgeFor(project.name, blocker, names),
		),
	);
	return { nodes, edges };
}

function edgeFor(
	from: string,
	blocker: CrossProjectBlocker,
	names: Set<string>,
): FlowEdge<BlockerEdgeData>[] {
	if (!names.has(blocker.project)) {
		return [];
	}
	return [
		{
			id: `blocker:${from}:${blocker.key}`,
			source: nodeId(blocker.project),
			target: nodeId(from),
			type: "blocker",
			data: { ticket: blocker.key, project: from },
		},
	];
}

function GraphTools() {
	const flow = useReactFlow();
	return (
		<div className={clsx(cards.graphTools)}>
			<button
				type="button"
				className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
				aria-label={overviewControlLabel.zoomIn}
				onClick={() => flow.zoomIn()}
			>
				{overviewControlLabel.zoomIn}
			</button>
			<button
				type="button"
				className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
				aria-label={overviewControlLabel.zoomOut}
				onClick={() => flow.zoomOut()}
			>
				{overviewControlLabel.zoomOut}
			</button>
			<button
				type="button"
				className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
				aria-label={overviewControlLabel.fit}
				onClick={() => {
					void flow.fitView();
				}}
			>
				{overviewControlLabel.fit}
			</button>
		</div>
	);
}

export function OverviewGraph({ projects }: { projects: ProjectCounts[] }) {
	const model = useMemo(() => graphModel(projects), [projects]);
	const [nodes, setNodes] = useState(model.nodes);
	const [edges, setEdges] = useState(model.edges);
	useEffect(() => {
		setNodes(model.nodes);
		setEdges(model.edges);
	}, [model]);
	const onDragStop = (
		_event: unknown,
		_node: FlowNode,
		dragged: FlowNode[],
	) => {
		setNodes((current) => {
			const next = current.map((item) => {
				const moved = dragged.find((node) => node.id === item.id);
				return moved === undefined
					? item
					: { ...item, position: moved.position };
			});
			writePositions(next);
			return next;
		});
	};
	return (
		<div id="overview-graph" className={clsx(cards.graph)}>
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				onNodeDragStop={onDragStop}
				nodesDraggable
				nodesConnectable={false}
				elementsSelectable
				fitView
				proOptions={{ hideAttribution: true }}
			>
				<GraphTools />
			</ReactFlow>
		</div>
	);
}
