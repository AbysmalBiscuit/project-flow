import {
	Background,
	BackgroundVariant,
	BaseEdge,
	EdgeLabelRenderer,
	type EdgeProps,
	type Edge as FlowEdge,
	type Node as FlowNode,
	getSmoothStepPath,
	Handle,
	MarkerType,
	Position,
	ReactFlow,
	useReactFlow,
	useViewport,
} from "@xyflow/react";
import { useMemo, useState } from "react";
import type { CrossProjectBlocker, ProjectCounts } from "./domain.ts";
import { openProject } from "./paths.ts";
import { SegmentedBar, ticketTotal, trackerName } from "./progress-bar.tsx";
import { overviewControlLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards } from "./ui-styles.ts";

const columnGap = 320;
const rowGap = 150;

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
	labelOffset: number;
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
	const depth = new Map<string, number>();
	const visit = (name: string, seen: Set<string>): number => {
		const known = depth.get(name);
		if (known !== undefined) {
			return known;
		}
		if (seen.has(name)) {
			return 0;
		}
		seen.add(name);
		const sources = incoming.get(name) ?? [];
		const next =
			sources.length === 0
				? 0
				: Math.max(...sources.map((source) => visit(source, seen))) + 1;
		depth.set(name, next);
		return next;
	};
	for (const project of projects) {
		visit(project.name, new Set());
	}
	return depth;
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
			<SegmentedBar project={data.project} />
			<p className={clsx(cards.graphCount)}>
				{data.done} of {data.total} done
			</p>
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
}: EdgeProps<FlowEdge<BlockerEdgeData>>) {
	const [path, labelX, labelY] = getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		borderRadius: 0,
	});
	const ticket = data?.ticket ?? "";
	const blocked = data?.blocked ?? "";
	const blocker = data?.blocker ?? "";
	const tracker = data?.tracker ?? "github";
	const labelOffset = data?.labelOffset ?? 0;
	return (
		<>
			<BaseEdge id={id} path={path} />
			<EdgeLabelRenderer>
				<button
					type="button"
					className={`nopan ${clsx(cards.graphEdge, cards.graphLabel)}`}
					style={{
						transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + labelOffset}px)`,
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
	const pairIndex = new Map<string, number>();
	const edges = shown.flatMap((project) =>
		project.crossProjectBlockers.flatMap((blocker) => {
			const pair = `${blocker.project}\0${project.name}`;
			const index = pairIndex.get(pair) ?? 0;
			pairIndex.set(pair, index + 1);
			return edgeFor(project.name, blocker, shownNames, index);
		}),
	);
	return { nodes, edges };
}

const labelStep = 18;

function edgeFor(
	blocked: string,
	blocker: CrossProjectBlocker,
	shownNames: Set<string>,
	index: number,
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
			markerEnd: { type: MarkerType.ArrowClosed },
			data: {
				ticket: blocker.key,
				blocked,
				blocker: blocker.project,
				tracker: blocker.tracker,
				labelOffset: index * labelStep,
			},
		},
	];
}

function viewportText(x: number, y: number, zoom: number): string {
	const shownX = Math.round(x);
	const shownY = Math.round(y);
	const shownZoom = Math.round(zoom * 1000) / 1000;
	return `zoom ${shownZoom} at ${shownX},${shownY}`;
}

function panText(step: number): string {
	return `panned ${step}`;
}

function GraphProbe() {
	const viewport = useViewport();
	const flow = useReactFlow();
	const [shift, setShift] = useState(0);
	return (
		<>
			<p id="graph-viewport" className={clsx(cards.graphProbe)}>
				{viewportText(viewport.x, viewport.y, viewport.zoom)}
			</p>
			<p id="graph-pan-result" className={clsx(cards.graphProbe)}>
				{shift === 0 ? "" : panText(shift)}
			</p>
			<input
				id="graph-pan"
				className={clsx(cards.graphProbe)}
				aria-label="Pan the graph"
				onChange={(event) => {
					const step = Number(event.target.value);
					if (!Number.isFinite(step) || step === 0) {
						return;
					}
					const before = flow.getViewport().x;
					void flow
						.setViewport({
							...flow.getViewport(),
							x: before + step,
						})
						.then(() => {
							setShift(Math.round(flow.getViewport().x - before));
						});
				}}
			/>
		</>
	);
}

export function GraphZoom() {
	const flow = useReactFlow();
	return (
		<>
			<button
				type="button"
				className={clsx(cards.control)}
				aria-label={overviewControlLabel.zoomOut}
				onClick={() => {
					void flow.zoomOut();
				}}
			>
				−
			</button>
			<button
				type="button"
				className={clsx(cards.control)}
				aria-label={overviewControlLabel.fit}
				onClick={() => {
					void flow.fitView();
				}}
			>
				{overviewControlLabel.fit}
			</button>
			<button
				type="button"
				className={clsx(cards.control)}
				aria-label={overviewControlLabel.zoomIn}
				onClick={() => {
					void flow.zoomIn();
				}}
			>
				+
			</button>
		</>
	);
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
				<GraphProbe />
			</ReactFlow>
		</div>
	);
}
