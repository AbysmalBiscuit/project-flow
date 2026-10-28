import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	Handle,
	MarkerType,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";

import { board } from "./board-styles.ts";
import { Button } from "./button.tsx";
import type {
	RunAgent,
	RunCheckpoint,
	RunGraph as Graph,
	RunGraphNodeState,
	ShownFactoryRun,
} from "./domain.ts";
import { elk, FitLayout, LegendFrame } from "./graph-core-view.tsx";
import type { Point } from "./graph-core.ts";
import { float, FloatPanel } from "./graph-float.tsx";
import { GraphTools } from "./graph-pane.tsx";
import { DirectionSwitch } from "./graph-switches.tsx";
import {
	type LaidEdge,
	layoutWorkflow,
	stageFrameId,
	stageSize,
	type WorkflowLayout,
} from "./graph-workflow.ts";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { StagePane } from "./run-stage-pane.tsx";
import {
	liveStage,
	StageCard,
	type StageFacts,
	stageFacts,
	stageStroke,
} from "./run-stage.tsx";
import {
	calledGraphLabel,
	floatPanelLabel,
	runGraphHelp,
	runGraphLabel,
	runGraphLegendLabel,
	runStageStateLabel,
	stageKindLabel,
} from "./terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import type { GraphDirection } from "./view-settings.ts";

const styles = stylex.create({
	withPane: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "flex-end",
		gap: space.md,
	},
	graphColumn: {
		flexGrow: 1,
		flexBasis: measure.diagram,
		minWidth: 0,
	},
	pane: {
		position: "relative",
		height: measure.runGraph,
		margin: 0,
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
		position: "relative",
		display: "flex",
		cursor: "pointer",
		alignItems: "center",
		boxSizing: "border-box",
		width: "100%",
		height: "100%",
	},
	outline: {
		position: "absolute",
		inset: 0,
		overflow: "visible",
		width: "100%",
		height: "100%",
	},
	body: {
		position: "relative",
		minWidth: 0,
		width: "100%",
	},
	toggle: {
		position: "absolute",
		top: `calc(-1 * ${space.sm})`,
		right: `calc(-1 * ${space.sm})`,
	},
	frame: {
		boxSizing: "border-box",
		width: "100%",
		height: "100%",
		borderWidth: measure.hairline,
		borderStyle: "dashed",
		borderColor: colours.groupLine,
		borderRadius: radius.md,
		backgroundColor: colours.groupFill,
	},
	handle: {
		opacity: 0,
	},
	edgeText: {
		position: "absolute",
		paddingInline: space.twoXs,
		borderRadius: radius.sm,
		backgroundColor: colours.raised,
		color: colours.inkMuted,
		fontSize: type.meta,
		lineHeight: type.line,
		whiteSpace: "nowrap",
		pointerEvents: "all",
	},
	legendRow: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	glyph: {
		flexShrink: 0,
		overflow: "visible",
		width: measure.icon,
		height: measure.glyph,
	},
	legendText: {
		position: "static",
	},
});

/** The inner gap of each shape, so that the stage text stays inside the outline. */
const inset = stylex.create({
	box: { paddingInline: space.sm },
	slant: { paddingInline: "13%" },
	point: { paddingInline: "24%" },
	roof: { paddingInline: space.sm, paddingTop: "18%" },
});

const insetOf: Record<string, keyof typeof inset> = {
	diamond: "point",
	Mdiamond: "point",
	hexagon: "slant",
	parallelogram: "slant",
	tripleoctagon: "slant",
	house: "roof",
};

type Mark = { points: string; closed: boolean };

/** The outline of each Graphviz shape in a 100 by 100 box: the filled outline, then its marks. */
const outlines: Record<string, Mark[]> = {
	box: [{ points: "0,0 100,0 100,100 0,100", closed: true }],
	Msquare: [
		{ points: "0,0 100,0 100,100 0,100", closed: true },
		{ points: "0,12 6,0", closed: false },
		{ points: "94,0 100,12", closed: false },
		{ points: "0,88 6,100", closed: false },
		{ points: "94,100 100,88", closed: false },
	],
	diamond: [{ points: "50,0 100,50 50,100 0,50", closed: true }],
	Mdiamond: [
		{ points: "50,0 100,50 50,100 0,50", closed: true },
		{ points: "44,12 56,12", closed: false },
		{ points: "44,88 56,88", closed: false },
		{ points: "6,44 6,56", closed: false },
		{ points: "94,44 94,56", closed: false },
	],
	hexagon: [{ points: "10,0 90,0 100,50 90,100 10,100 0,50", closed: true }],
	parallelogram: [{ points: "12,0 100,0 88,100 0,100", closed: true }],
	component: [
		{ points: "4,0 100,0 100,100 4,100", closed: true },
		{ points: "0,20 8,20 8,36 0,36", closed: true },
		{ points: "0,64 8,64 8,80 0,80", closed: true },
	],
	tripleoctagon: [
		{ points: "8,0 92,0 100,24 100,76 92,100 8,100 0,76 0,24", closed: true },
		{ points: "10,6 90,6 97,26 97,74 90,94 10,94 3,74 3,26", closed: false },
		{ points: "12,12 88,12 94,28 94,72 88,88 12,88 6,72 6,28", closed: false },
	],
	house: [{ points: "50,0 100,30 100,100 0,100 0,30", closed: true }],
};

function Outline({
	shape,
	state,
	layout,
}: {
	shape: string;
	state: RunGraphNodeState;
	layout: stylex.StyleXStyles;
}) {
	const marks = outlines[shape] ?? outlines.box ?? [];
	return (
		<svg
			aria-hidden="true"
			className={clsx(layout)}
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
		>
			{marks.map((mark, index) =>
				mark.closed ? (
					<polygon
						key={mark.points}
						points={mark.points}
						vectorEffect="non-scaling-stroke"
						className={clsx(stageStroke[state])}
					/>
				) : (
					<polyline
						key={mark.points}
						points={mark.points}
						vectorEffect="non-scaling-stroke"
						fill="none"
						className={clsx(stageStroke[state])}
						data-mark={index}
					/>
				),
			)}
		</svg>
	);
}

type StageNode = Node<
	{
		facts: StageFacts;
		shape: string;
		kind: string;
		child: { open: boolean; toggle: () => void } | null;
	},
	"stage"
>;

type FrameNode = Node<Record<string, never>, "frame">;

type RouteEdge = Edge<Pick<LaidEdge, "points" | "text" | "condition">, "route">;

function Stage({ data: { facts, shape, kind, child } }: NodeProps<StageNode>) {
	return (
		<div
			className={clsx(styles.stage, inset[insetOf[shape] ?? "box"])}
			data-shape={shape}
			data-kind={kind}
			data-child={child === null ? undefined : child.open ? "open" : "closed"}
		>
			<Handle
				type="target"
				position={Position.Top}
				className={clsx(styles.handle)}
			/>
			<Outline
				shape={shape}
				state={facts.stage.state}
				layout={styles.outline}
			/>
			<span className={clsx(styles.body)}>
				<StageCard facts={facts} />
			</span>
			{child === null ? null : (
				<span className={`nodrag nopan ${clsx(styles.toggle)}`}>
					<Button
						icon={child.open ? "shrink" : "expand"}
						name={calledGraphLabel(child.open, facts.stage.label)}
						pressed={child.open}
						onClick={child.toggle}
					/>
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

function Frame() {
	return (
		<div className={clsx(styles.frame)}>
			<Handle
				type="target"
				position={Position.Top}
				className={clsx(styles.handle)}
			/>
			<Handle
				type="source"
				position={Position.Bottom}
				className={clsx(styles.handle)}
			/>
		</div>
	);
}

function pathOf(points: readonly Point[]): string {
	return points
		.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
		.join(" ");
}

/** An edge along the route that ELK laid out, with its text where ELK placed it. */
function Route({ id, data, markerEnd }: EdgeProps<RouteEdge>) {
	const text = data?.text;
	return (
		<>
			<BaseEdge
				id={id}
				path={pathOf(data?.points ?? [])}
				{...(markerEnd === undefined ? {} : { markerEnd })}
			/>
			{text === undefined ? null : (
				<EdgeLabelRenderer>
					<span
						className={clsx(styles.edgeText)}
						data-edge-text={text.text}
						title={data?.condition}
						style={{
							transform: `translate(-50%, -50%) translate(${text.x + text.width / 2}px, ${text.y + text.height / 2}px)`,
						}}
					>
						{text.text}
					</span>
				</EdgeLabelRenderer>
			)}
		</>
	);
}

const nodeTypes = { stage: Stage, frame: Frame };
const edgeTypes = { route: Route };

const textHeight = 18;
const textCharWidth = 6.6;

/** The size of an edge text in the meta font, close enough for ELK to keep room for it. */
function textSize(text: string) {
	return { width: text.length * textCharWidth + 8, height: textHeight };
}

/** Lays out the graph again only when its stages, edges, open frames or direction change. */
function useLaidWorkflow(
	graph: Graph,
	open: ReadonlySet<string>,
	direction: GraphDirection,
): WorkflowLayout | undefined {
	const shape = JSON.stringify([
		graph.nodes.map((node) => [
			node.id,
			(node.child ?? []).map((stage) => stage.id),
		]),
		graph.edges,
		[...open].toSorted(),
		direction,
	]);
	return useQuery({
		queryKey: ["runGraphLayout", shape],
		queryFn: () => layoutWorkflow(elk(), graph, open, direction, textSize),
		staleTime: Number.POSITIVE_INFINITY,
	}).data;
}

function flowOf(
	graph: Graph,
	laid: WorkflowLayout,
	factsOf: (stage: StageFacts["stage"]) => StageFacts,
	open: ReadonlySet<string>,
	toggle: (id: string) => void,
) {
	const frames: FrameNode[] = [...laid.frames].map(([caller, rect]) => ({
		id: stageFrameId(caller),
		type: "frame",
		position: { x: rect.x, y: rect.y },
		width: rect.width,
		height: rect.height,
		zIndex: -1,
		data: {},
	}));
	const stages: StageNode[] = graph.nodes.flatMap((node) => {
		const stageNode = (
			stage: StageFacts["stage"],
			child: StageNode["data"]["child"],
			shape: string,
			kind: string,
		): StageNode[] => {
			const at = laid.stages.get(stage.id);
			return at === undefined
				? []
				: [
						{
							id: stage.id,
							type: "stage",
							position: at,
							...stageSize,
							data: { facts: factsOf(stage), shape, kind, child },
						},
					];
		};
		const child =
			node.child === undefined || node.child.length === 0
				? null
				: { open: open.has(node.id), toggle: () => toggle(node.id) };
		return [
			...stageNode(node, child, node.shape, node.kind),
			...(node.child ?? []).flatMap((stage) =>
				stageNode(stage, null, "box", ""),
			),
		];
	});
	const frameOf = new Set(laid.frames.keys());
	const ends = (id: string) => (frameOf.has(id) ? stageFrameId(id) : id);
	const edges: RouteEdge[] = laid.edges.map((edge) => ({
		id: edge.id,
		type: "route",
		source: ends(edge.from),
		target: ends(edge.to),
		markerEnd: { type: MarkerType.ArrowClosed },
		data: {
			points: edge.points,
			...(edge.text === undefined ? {} : { text: edge.text }),
			...(edge.condition === undefined ? {} : { condition: edge.condition }),
		},
	}));
	return { nodes: [...frames, ...stages], edges };
}

const states = Object.keys(runStageStateLabel).filter(
	(state): state is RunGraphNodeState =>
		Object.hasOwn(runStageStateLabel, state),
);

/** The stage states, each shape in the graph with its kind, and the edge text. */
function Legend({ graph }: { graph: Graph }) {
	const shapes = [
		...new Map(
			graph.nodes.map((node) => [`${node.shape}\n${node.kind}`, node]),
		).values(),
	];
	const framed = graph.nodes.some((node) => node.child !== undefined);
	return (
		<LegendFrame id="run-graph-legend" label={runGraphLegendLabel.legend}>
			<ul
				className={clsx(styles.legendRow)}
				aria-label={runGraphLegendLabel.states}
			>
				{states.map((state) => (
					<li
						key={state}
						className={clsx(board.legendItem)}
						data-legend-state={state}
					>
						<Outline shape="box" state={state} layout={styles.glyph} />
						{runStageStateLabel[state]}
					</li>
				))}
			</ul>
			<ul
				className={clsx(styles.legendRow)}
				aria-label={runGraphLegendLabel.shapes}
			>
				{shapes.map((node) => (
					<li
						key={`${node.shape}\n${node.kind}`}
						className={clsx(board.legendItem)}
						data-legend-shape={node.shape}
					>
						<Outline
							shape={node.shape}
							state="completed"
							layout={styles.glyph}
						/>
						{stageKindLabel(node.kind)}
					</li>
				))}
			</ul>
			<p className={clsx(board.legendNote, board.legendEdge)}>
				<span className={clsx(board.legendSwatch)} />
				<span className={clsx(styles.edgeText, styles.legendText)}>
					{runGraphLegendLabel.edgeSample}
				</span>
				{runGraphLegendLabel.edge}
			</p>
			{framed ? (
				<p className={clsx(board.legendNote)}>
					{runGraphLegendLabel.calledGraph}
				</p>
			) : null}
		</LegendFrame>
	);
}

const paneId = "run-graph";

function GraphPane({
	graph,
	checkpoint,
	agents,
	onPick,
}: {
	graph: Graph;
	checkpoint: RunCheckpoint;
	agents: readonly RunAgent[];
	onPick: (stage: string) => void;
}) {
	const [direction, setDirection] = useState<GraphDirection>("top-to-bottom");
	const [refit, setRefit] = useState(0);
	const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(
		new Map(),
	);
	const open = useMemo(
		() =>
			new Set(
				graph.nodes
					.filter(
						(node) =>
							node.child !== undefined &&
							(toggled.get(node.id) ??
								(node.state === "current" || node.state === "failed")),
					)
					.map((node) => node.id),
			),
		[graph, toggled],
	);
	const laid = useLaidWorkflow(graph, open, direction);
	const flow = useMemo(
		() =>
			laid === undefined
				? null
				: flowOf(
						graph,
						laid,
						(stage) => stageFacts(stage, checkpoint, agents),
						open,
						(id) =>
							setToggled((before) => new Map(before).set(id, !open.has(id))),
					),
		[graph, laid, checkpoint, agents, open],
	);
	// The view opens on the live stage, or on the whole open frame that holds it.
	const caller = liveStage(graph)?.id.split("/")[0];
	const liveId =
		caller === undefined
			? undefined
			: laid?.frames.has(caller) === true
				? stageFrameId(caller)
				: caller;
	const fit = useCallback(
		() => ({
			maxZoom: 1,
			padding: 0.2,
			...(liveId === undefined ? {} : { nodes: [{ id: liveId }] }),
		}),
		[liveId],
	);
	const fitAll = useCallback(() => ({ padding: 0.1 }), []);
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runGraphLabel}</h3>
			<figure
				id={paneId}
				className={clsx(styles.pane)}
				aria-label={runGraphLabel}
				title={runGraphHelp}
				data-direction={direction}
			>
				{/* The project page wraps the side panel in the ticket graph's provider, and a ReactFlow under a provider uses its store. */}
				<ReactFlowProvider>
					{flow === null ? null : (
						<ReactFlow
							nodes={flow.nodes}
							edges={flow.edges}
							nodeTypes={nodeTypes}
							edgeTypes={edgeTypes}
							nodesDraggable={false}
							nodesConnectable={false}
							nodesFocusable={false}
							elementsSelectable={false}
							zoomOnDoubleClick={false}
							onNodeClick={(_, node) => {
								if (node.type === "stage") {
									onPick(node.id);
								}
							}}
							minZoom={0.1}
							proOptions={{ hideAttribution: true }}
						>
							<FitLayout layout={laid} held={false} refit={refit} fit={fit} />
						</ReactFlow>
					)}
					<div className={clsx(float.overlay)}>
						<Legend graph={graph} />
					</div>
					<div className={clsx(float.corner)}>
						<FloatPanel
							id="run-graph-controls"
							label={floatPanelLabel.controls}
							icon="sliders"
							grow="up"
							pin="first"
						>
							<div className={clsx(float.group)}>
								<DirectionSwitch
									direction={direction}
									onChange={(next) => {
										setDirection(next);
										setRefit((count) => count + 1);
									}}
								/>
								<GraphTools
									probeId="run-graph-viewport"
									fitId="run-graph-fit"
									scope={`#${paneId}`}
									fitOptions={fitAll}
								/>
							</div>
						</FloatPanel>
					</div>
				</ReactFlowProvider>
			</figure>
		</>
	);
}

/** The run's workflow graph, each stage in the shape of its workflow node and marked from the run checkpoint. */
export function RunGraph({
	run,
	onOpenStage,
}: {
	run: ShownFactoryRun;
	onOpenStage: (stage: string) => void;
}) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	const agents = useQuery(pageQuery.agents(run)).data ?? [];
	const [picked, setPicked] = useState<string | null>(null);
	if (typeof data !== "object" || data.graph === null) {
		return null;
	}
	const stage = data.graph.nodes
		.flatMap((node) => [node, ...(node.child ?? [])])
		.find((item) => item.id === picked);
	return (
		<div className={clsx(styles.withPane)}>
			<div className={clsx(styles.graphColumn)}>
				<GraphPane
					graph={data.graph}
					checkpoint={data}
					agents={agents}
					onPick={setPicked}
				/>
			</div>
			{stage === undefined ? null : (
				<StagePane
					run={run}
					facts={stageFacts(stage, data, agents)}
					onClose={() => setPicked(null)}
					onOpenStage={onOpenStage}
				/>
			)}
		</div>
	);
}
