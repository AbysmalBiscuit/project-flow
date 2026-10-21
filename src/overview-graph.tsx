import {
	Background,
	BackgroundVariant,
	BaseEdge,
	EdgeLabelRenderer,
	type EdgeProps,
	type Edge as FlowEdge,
	type Node as FlowNode,
	Handle,
	MarkerType,
	Position,
	ReactFlow,
} from "@xyflow/react";
import { useMemo } from "react";
import type { CrossProjectBlocker, ProjectCounts } from "./domain.ts";
import { columnDepth, GraphTools } from "./graph-pane.tsx";
import { type GraphRoute, routeEdge } from "./graph-routes.ts";
import { openProject } from "./paths.ts";
import { SegmentedBar, ticketTotal, trackerName } from "./progress-bar.tsx";
import { loadingLabel, overviewControlLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards } from "./ui-styles.ts";

const columnGap = 360;
const rowGap = 168;

type ProjectNodeData = {
	project: ProjectCounts;
	tracker: string;
	done: number;
	total: number;
};

type BlockerEdgeData = {
	ticket: string;
	blocked: string;
	blocker: string;
	tracker: CrossProjectBlocker["tracker"];
	lane: number;
	lanes: number;
};

function depths(
	projects: ProjectCounts[],
	names: Set<string>,
): Map<string, number> {
	const incoming = new Map<string, string[]>();
	for (const project of projects) {
		for (const blocker of project.crossProjectBlockers) {
			if (!names.has(blocker.project) || blocker.project === project.name) {
				continue;
			}
			const sources = incoming.get(project.name) ?? [];
			sources.push(blocker.project);
			incoming.set(project.name, sources);
		}
	}
	return columnDepth(
		projects.map((project) => project.name),
		incoming,
	);
}

function layout(
	projects: ProjectCounts[],
	names: Set<string>,
): Map<string, { x: number; y: number }> {
	const depth = depths(projects, names);
	const columns = new Map<number, string[]>();
	const ordered = [...projects].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
	for (const project of ordered) {
		const column = depth.get(project.name) ?? 0;
		const namesInColumn = columns.get(column) ?? [];
		namesInColumn.push(project.name);
		columns.set(column, namesInColumn);
	}
	const positions = new Map<string, { x: number; y: number }>();
	for (const [column, namesInColumn] of columns) {
		namesInColumn.forEach((name, index) => {
			positions.set(name, { x: column * columnGap, y: index * rowGap });
		});
	}
	return positions;
}

function ProjectNode({ data }: { data: ProjectNodeData }) {
	return (
		<div
			className={clsx(
				cards.graphNode,
				data.project.needsYou > 0 && cards.graphNeedsYou,
			)}
			data-project={data.project.name}
		>
			<Handle type="target" position={Position.Left} />
			<div className={clsx(cards.graphHead)}>
				<p className={clsx(cards.graphTitle)}>{data.project.name}</p>
				{data.project.needsYou > 0 ? (
					<span className={clsx(cards.graphBadge)}>
						{data.project.needsYou === 1
							? overviewControlLabel.needsYouOne
							: `${data.project.needsYou} ${overviewControlLabel.needsYouMany}`}
					</span>
				) : null}
			</div>
			<p className={clsx(cards.graphMeta)}>{data.tracker}</p>
			{data.project.pending === true ? (
				<p className={clsx(cards.loading)}>{loadingLabel}</p>
			) : (
				<>
					<SegmentedBar project={data.project} />
					<p className={clsx(cards.graphCount)}>
						{data.done} of {data.total} done
					</p>
				</>
			)}
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
	markerEnd,
	data,
}: EdgeProps<FlowEdge<BlockerEdgeData>>) {
	const route: GraphRoute = {
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
	};
	const drawn = routeEdge(route, data?.lane ?? 0, data?.lanes ?? 1);
	const ticket = data?.ticket ?? "";
	const blocked = data?.blocked ?? "";
	const blocker = data?.blocker ?? "";
	const tracker = data?.tracker ?? "github";
	return (
		<>
			<BaseEdge
				id={id}
				path={drawn.path}
				{...(markerEnd === undefined ? {} : { markerEnd })}
			/>
			<EdgeLabelRenderer>
				<button
					type="button"
					className={`nopan ${clsx(cards.graphEdge, cards.graphLabel)}`}
					style={{
						transform: `translate(-50%, -50%) translate(${drawn.labelX}px, ${drawn.labelY}px)`,
					}}
					aria-label={`${ticket} ${blocked}`}
					onClick={() => {
						openProject(blocked, ticket, blocker, tracker);
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

function nodeData(project: ProjectCounts): ProjectNodeData {
	return {
		project,
		tracker: trackerName(project.tracker),
		done: project.done,
		total: ticketTotal(project),
	};
}

function graphModel(
	shown: ProjectCounts[],
	catalogue: ProjectCounts[],
): {
	nodes: FlowNode<ProjectNodeData>[];
	edges: FlowEdge<BlockerEdgeData>[];
} {
	const catalogueNames = new Set(catalogue.map((project) => project.name));
	const shownNames = new Set(shown.map((project) => project.name));
	const positions = layout(catalogue, catalogueNames);
	const nodes = shown.map((project) => ({
		id: project.name,
		type: "project",
		position: positions.get(project.name) ?? { x: 0, y: 0 },
		data: nodeData(project),
	}));
	const pending = shown.flatMap((project) =>
		project.crossProjectBlockers.flatMap((blocker) =>
			edgeFor(project.name, blocker, shownNames),
		),
	);
	const lanes = new Map<string, number>();
	for (const edge of pending) {
		const pair = `${edge.source}\0${edge.target}`;
		lanes.set(pair, (lanes.get(pair) ?? 0) + 1);
	}
	const used = new Map<string, number>();
	const edges = pending.flatMap((edge) => {
		if (edge.data === undefined) {
			return [];
		}
		const pair = `${edge.source}\0${edge.target}`;
		const lane = used.get(pair) ?? 0;
		used.set(pair, lane + 1);
		return [
			{
				...edge,
				data: {
					...edge.data,
					lane,
					lanes: lanes.get(pair) ?? 1,
				},
			},
		];
	});
	return { nodes, edges };
}

function edgeFor(
	blocked: string,
	blocker: CrossProjectBlocker,
	shownNames: Set<string>,
): FlowEdge<BlockerEdgeData>[] {
	if (!shownNames.has(blocker.project) || blocker.project === blocked) {
		return [];
	}
	return [
		{
			id: `blocker:${blocked}:${blocker.project}:${blocker.key}`,
			source: blocker.project,
			target: blocked,
			type: "blocker",
			markerEnd: {
				type: MarkerType.ArrowClosed,
				width: 22,
				height: 22,
				markerUnits: "userSpaceOnUse",
			},
			data: {
				ticket: blocker.key,
				blocked,
				blocker: blocker.project,
				tracker: blocker.tracker,
				lane: 0,
				lanes: 1,
			},
		},
	];
}

export function OverviewGraph({
	projects,
	catalogue,
}: {
	projects: ProjectCounts[];
	catalogue: ProjectCounts[];
}) {
	const model = useMemo(
		() => graphModel(projects, catalogue),
		[projects, catalogue],
	);
	const places = model.nodes
		.map((node) => `${node.id}:${node.position.x},${node.position.y}`)
		.join(" ");
	return (
		<div id="overview-graph" className={clsx(cards.graph)}>
			<p id="graph-places" className={clsx(cards.graphProbe)}>
				{places}
			</p>
			<ReactFlow
				nodes={model.nodes}
				edges={model.edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				panOnDrag
				zoomOnScroll
				fitView
				proOptions={{ hideAttribution: true }}
			>
				<Background variant={BackgroundVariant.Dots} gap={18} />
				<GraphTools />
			</ReactFlow>
		</div>
	);
}
