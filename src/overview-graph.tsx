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
	ReactFlowProvider,
	useReactFlow,
	type Viewport,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { CrossProjectBlocker, ProjectCounts } from "./domain.ts";
import { openProject } from "./paths.ts";
import { overviewControlLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards } from "./ui-styles.ts";

const columnGap = 320;
const rowGap = 150;

type ProjectNodeData = {
	name: string;
	tracker: string;
	done: number;
	total: number;
	needsYou: number;
	segments: { key: string; share: number }[];
};

type BlockerEdgeData = {
	ticket: string;
	blocked: string;
	blocker: string;
	tracker: "github" | "linear";
};

function ticketTotal(project: ProjectCounts): number {
	return (
		project.done +
		project.dropped +
		project.backlog +
		project.inProgress +
		project.inReview +
		project.awaitingMerge
	);
}

function trackerName(tracker: ProjectCounts["tracker"]): string {
	return tracker === "linear" ? "Linear" : "GitHub";
}

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

const segmentTone = {
	done: cards.done,
	inProgress: cards.inProgress,
	inReview: cards.inReview,
	awaitingMerge: cards.awaitingMerge,
	backlog: cards.backlog,
} as const;

function ProjectNode({ data }: { data: ProjectNodeData }) {
	return (
		<div
			className={clsx(
				cards.graphNode,
				data.needsYou > 0 && cards.graphNeedsYou,
			)}
			data-project={data.name}
		>
			<Handle type="target" position={Position.Left} />
			<div className={clsx(cards.graphHead)}>
				<p className={clsx(cards.graphTitle)}>{data.name}</p>
				{data.needsYou > 0 ? (
					<span className={clsx(cards.graphBadge)}>
						{data.needsYou === 1
							? overviewControlLabel.needsYouOne
							: `${data.needsYou} ${overviewControlLabel.needsYouMany}`}
					</span>
				) : null}
			</div>
			<p className={clsx(cards.graphMeta)}>{data.tracker}</p>
			<div
				className={clsx(cards.graphBar)}
				role="progressbar"
				aria-valuenow={data.done}
				aria-valuemin={0}
				aria-valuemax={data.total}
				aria-label={data.name}
			>
				{data.segments.map((segment) => (
					<div
						key={segment.key}
						className={clsx(
							cards.graphFill,
							segmentTone[segment.key as keyof typeof segmentTone],
						)}
						style={{ width: `${segment.share}%` }}
					/>
				))}
			</div>
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
	return (
		<>
			<BaseEdge id={id} path={path} />
			<EdgeLabelRenderer>
				<button
					type="button"
					className={`nopan ${clsx(cards.graphEdge, cards.graphLabel)}`}
					style={{
						transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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

const segmentKeys = [
	"done",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"backlog",
] as const;

function nodeData(project: ProjectCounts): ProjectNodeData {
	const total = ticketTotal(project);
	return {
		name: project.name,
		tracker: trackerName(project.tracker),
		done: project.done,
		total,
		needsYou: project.needsYou,
		segments: segmentKeys.flatMap((key) => {
			const count = project.statusTypes[key];
			if (count === 0 || total === 0) {
				return [];
			}
			return [{ key, share: (count / total) * 100 }];
		}),
	};
}

export function graphModel(
	shown: ProjectCounts[],
	catalogue: ProjectCounts[],
): {
	nodes: FlowNode<ProjectNodeData>[];
	edges: FlowEdge<BlockerEdgeData>[];
} {
	const names = new Set(catalogue.map((project) => project.name));
	const positions = layout(catalogue, names);
	const nodes = shown.map((project) => ({
		id: project.name,
		type: "project",
		position: positions.get(project.name) ?? { x: 0, y: 0 },
		data: nodeData(project),
	}));
	const edges = shown.flatMap((project) =>
		project.crossProjectBlockers.flatMap((blocker) =>
			edgeFor(project.name, blocker, names),
		),
	);
	return { nodes, edges };
}

function edgeFor(
	blocked: string,
	blocker: CrossProjectBlocker,
	names: Set<string>,
): FlowEdge<BlockerEdgeData>[] {
	if (!names.has(blocker.project) || blocker.project === blocked) {
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
			},
		},
	];
}

function readViewport(): Viewport | null {
	const pane = document.querySelector(".react-flow__viewport");
	if (!(pane instanceof SVGElement) && !(pane instanceof HTMLElement)) {
		return null;
	}
	const transform = pane.style.transform;
	const shift = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(transform);
	const scale = /scale\(([^)]+)\)/.exec(transform)?.[1];
	const x = shift?.[1];
	const y = shift?.[2];
	if (scale === undefined || x === undefined || y === undefined) {
		return null;
	}
	return {
		x: Math.round(Number(x)),
		y: Math.round(Number(y)),
		zoom: Math.round(Number(scale) * 1000) / 1000,
	};
}

function settledViewport(
	setViewport: (viewport: Viewport | null) => void,
): () => void {
	let stopped = false;
	let last = "";
	let frames = 0;
	const tick = () => {
		if (stopped) {
			return;
		}
		const pane = document.querySelector(".react-flow__viewport");
		const transform = pane instanceof HTMLElement ? pane.style.transform : "";
		frames += 1;
		if ((transform === "" || transform !== last) && frames < 40) {
			last = transform;
			requestAnimationFrame(tick);
			return;
		}
		setViewport(readViewport());
	};
	const frame = requestAnimationFrame(tick);
	return () => {
		stopped = true;
		cancelAnimationFrame(frame);
	};
}

function GraphTools() {
	const flow = useReactFlow();
	const [viewport, setViewport] = useState<Viewport | null>(null);
	useEffect(() => settledViewport(setViewport), []);
	const show = () => {
		setViewport(readViewport());
	};
	return (
		<div className={clsx(cards.graphTools)}>
			<button
				type="button"
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.zoomOut}
				onClick={() => {
					void flow.zoomOut().then(show);
				}}
			>
				−
			</button>
			<button
				type="button"
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.fit}
				onClick={() => {
					void flow.fitView().then(show);
				}}
			>
				{overviewControlLabel.fit}
			</button>
			<button
				type="button"
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.zoomIn}
				onClick={() => {
					void flow.zoomIn().then(show);
				}}
			>
				+
			</button>
			<p id="graph-viewport" className={clsx(cards.graphProbe)}>
				{viewport === null
					? ""
					: `zoom ${viewport.zoom} at ${viewport.x},${viewport.y}`}
			</p>
		</div>
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
			<ReactFlowProvider>
				<ReactFlow
					nodes={model.nodes}
					edges={model.edges}
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable={false}
					panOnDrag={false}
					fitView
					proOptions={{ hideAttribution: true }}
				>
					<Background variant={BackgroundVariant.Dots} gap={18} />
					<GraphTools />
				</ReactFlow>
			</ReactFlowProvider>
		</div>
	);
}
