import {
	Background,
	BackgroundVariant,
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	type Edge as FlowEdge,
	type Node as FlowNode,
	Handle,
	Position,
	ReactFlow,
} from "@xyflow/react";
import { createContext, useContext, useEffect, useMemo } from "react";
import { board } from "./board-styles.ts";
import type { CrossProjectBlocker, ProjectCounts } from "./domain.ts";
import {
	type FocusLink,
	type FocusView,
	focusChain,
	isFocusClick,
	shownSeeds,
} from "./focus.ts";
import { overviewFlowPlaces } from "./graph-flow.ts";
import { MeasuredNode, useNodeSpan } from "./graph-node-size.tsx";
import { GraphTools } from "./graph-pane.tsx";
import {
	assignLanes,
	type GraphRoute,
	labelSpots,
	markerEnd,
	measureMarker,
	type NodeBound,
	routeEdge,
} from "./graph-routes.ts";
import { sizedNode } from "./graph-sizes.ts";
import { openProject, projectPath } from "./paths.ts";
import { SegmentedBar, ticketTotal, trackerName } from "./progress-bar.tsx";
import { loadingLabel, overviewControlLabel } from "./terms.ts";
import { classToken, clsx } from "./ui.ts";
import { cards, shell } from "./ui-styles.ts";

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
	entry: number;
	entries: number;
	nodes: NodeBound[];
	label: { x: number; y: number };
	side: number;
};

const ProjectFocusContext = createContext<{
	chain: ReadonlySet<string> | null;
	view: FocusView | null;
}>({ chain: null, view: null });

function ProjectNode({ id, data }: { id: string; data: ProjectNodeData }) {
	const focus = useContext(ProjectFocusContext);
	const faded = focus.chain !== null && !focus.chain.has(data.project.name);
	return (
		<a
			className={clsx(
				cards.graphNode,
				cards.graphCard,
				shell.linkFocus,
				data.project.needsYou > 0 && cards.graphNeedsYou,
				faded && board.faded,
			)}
			href={projectPath(data.project.name)}
			id={`graph-card-${id}`}
			aria-label={data.project.name}
			data-project={data.project.name}
			data-faded={faded ? "true" : "false"}
			onMouseEnter={() => focus.view?.enter(data.project.name)}
			onMouseLeave={() => focus.view?.leave()}
			onClick={(event) => {
				event.preventDefault();
				if (isFocusClick(event)) {
					focus.view?.toggle(data.project.name);
					return;
				}
				openProject(data.project.name);
			}}
		>
			<MeasuredNode id={id} kind="project" />
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
		</a>
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
	const drawn = routeEdge(
		route,
		data?.lane ?? 0,
		data?.lanes ?? 1,
		data?.nodes ?? [],
		data?.label ?? { x: 0, y: 0 },
		data?.entry ?? 0,
		data?.entries ?? 1,
		data?.side,
	);
	const ticket = data?.ticket ?? "";
	const blocked = data?.blocked ?? "";
	const blocker = data?.blocker ?? "";
	const tracker = data?.tracker ?? "github";
	const { chain } = useContext(ProjectFocusContext);
	const faded = chain !== null && !(chain.has(blocked) && chain.has(blocker));
	return (
		<>
			<BaseEdge
				id={id}
				path={drawn.path}
				{...(faded ? { className: classToken(board.faded) } : {})}
				{...(markerEnd === undefined ? {} : { markerEnd })}
			/>
			<EdgeLabelRenderer>
				<button
					type="button"
					className={`nopan ${clsx(cards.graphEdge, cards.graphLabel, faded && board.faded)}`}
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

export function graphModel(
	shown: ProjectCounts[],
	catalogue: ProjectCounts[],
	span: { width: number; height: number },
): {
	nodes: FlowNode<ProjectNodeData>[];
	edges: FlowEdge<BlockerEdgeData>[];
} {
	const shownNames = new Set(shown.map((project) => project.name));
	const positions = overviewFlowPlaces(catalogue);
	const nodes = shown.map((project) => {
		const node = {
			id: project.name,
			type: "project" as const,
			position: positions.get(project.name) ?? { x: 0, y: 0 },
			data: nodeData(project),
			// React Flow gives a node pointer events only when it is selectable, draggable, or has a pointer handler.
			selectable: true,
		};
		return sizedNode(node, span);
	});
	const measured = measureMarker(classToken(cards.graphMarker));
	const marker = markerEnd(measured.size, measured.color);
	const pending = shown.flatMap((project) =>
		project.crossProjectBlockers.flatMap((blocker) =>
			edgeFor(project.name, blocker, shownNames, marker),
		),
	);
	const bounds = new Map(
		nodes.flatMap((node) => {
			const bound = nodeBound(node, span);
			if (bound === undefined) {
				return [];
			}
			const spot: [string, NodeBound] = [node.id, bound];
			return [spot];
		}),
	);
	const laned = assignLanes(pending).map((edge) => {
		const nodesForEdge = [...bounds.entries()].flatMap(([id, bound]) =>
			id === edge.source || id === edge.target ? [] : [bound],
		);
		return { edge, nodesForEdge };
	});
	const spots = labelSpots(
		laned.map(({ edge, nodesForEdge }) => ({
			route: edgeRoute(edge, bounds),
			lane: edge.data.lane,
			lanes: edge.data.lanes,
			entry: edge.data.entry,
			entries: edge.data.entries,
			nodes: nodesForEdge,
			side: span.height,
		})),
	);
	const edges = laned.map(({ edge, nodesForEdge }, index) => ({
		...edge,
		data: {
			...edge.data,
			nodes: nodesForEdge,
			label: spots[index] ?? { x: 0, y: 0 },
			side: span.height,
		},
	}));
	return { nodes, edges };
}

function nodeBound(
	node: FlowNode<ProjectNodeData> | undefined,
	span: { width: number; height: number },
): NodeBound | undefined {
	if (node === undefined) {
		return undefined;
	}
	const width = node.measured?.width ?? node.width ?? span.width;
	const height = node.measured?.height ?? node.height ?? span.height;
	return {
		left: node.position.x,
		top: node.position.y,
		right: node.position.x + width,
		bottom: node.position.y + height,
	};
}

function edgeRoute(
	edge: { source: string; target: string },
	bounds: Map<string, NodeBound>,
): GraphRoute {
	const source = bounds.get(edge.source);
	const target = bounds.get(edge.target);
	return {
		sourceX: source?.right ?? 0,
		sourceY: source === undefined ? 0 : (source.top + source.bottom) / 2,
		targetX: target?.left ?? 0,
		targetY: target === undefined ? 0 : (target.top + target.bottom) / 2,
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
	};
}

function edgeFor(
	blocked: string,
	blocker: CrossProjectBlocker,
	shownNames: Set<string>,
	marker: ReturnType<typeof markerEnd>,
): Edge<{
	ticket: string;
	blocked: string;
	blocker: string;
	tracker: CrossProjectBlocker["tracker"];
}>[] {
	if (!shownNames.has(blocker.project) || blocker.project === blocked) {
		return [];
	}
	return [
		{
			id: `blocker:${blocked}:${blocker.project}:${blocker.key}`,
			source: blocker.project,
			target: blocked,
			type: "blocker",
			markerEnd: marker,
			data: {
				ticket: blocker.key,
				blocked,
				blocker: blocker.project,
				tracker: blocker.tracker,
			},
		},
	];
}

export function overviewFocusLinks(projects: ProjectCounts[]): FocusLink[] {
	return projects.flatMap((project) =>
		project.crossProjectBlockers.map((blocker) => ({
			from: blocker.project,
			to: project.name,
		})),
	);
}

export function OverviewGraph({
	projects,
	catalogue,
	focus,
}: {
	projects: ProjectCounts[];
	catalogue: ProjectCounts[];
	focus: FocusView;
}) {
	const clearFocus = focus.clear;
	useEffect(() => clearFocus, [clearFocus]);
	const seeds = shownSeeds(focus.focus, focus.preview);
	const chain = useMemo(
		() =>
			seeds.size === 0 ? null : focusChain(seeds, overviewFocusLinks(projects)),
		[seeds, projects],
	);
	const span = useNodeSpan(cards.graphNode, "project", "Project");
	const model = useMemo(
		() => (span === null ? null : graphModel(projects, catalogue, span)),
		[projects, catalogue, span],
	);
	if (model === null) {
		return <div id="overview-graph" className={clsx(cards.graph)} />;
	}
	const places = model.nodes
		.map((node) => `${node.id}:${node.position.x},${node.position.y}`)
		.join(" ");

	return (
		<ProjectFocusContext.Provider value={{ chain, view: focus }}>
			<div id="overview-graph" className={clsx(cards.graph)}>
				<p id="graph-places" className={clsx(cards.graphProbe)}>
					{places}
				</p>
				<p id="graph-focus" className={clsx(cards.graphProbe)}>
					{chain === null
						? "focus none"
						: `focus ${[...chain].sort().join(" | ")}`}
				</p>

				<ReactFlow
					nodes={model.nodes}
					edges={model.edges}
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					nodesDraggable={false}
					nodesConnectable={false}
					nodesFocusable={false}
					elementsSelectable={false}
					panOnDrag
					zoomOnScroll
					fitView
					proOptions={{ hideAttribution: true }}
				>
					<Background variant={BackgroundVariant.Dots} gap={18} />
					<div className={clsx(cards.graphTools)}>
						<GraphTools />
					</div>
				</ReactFlow>
			</div>
		</ProjectFocusContext.Provider>
	);
}
