import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	type FitViewOptions,
	Handle,
	MarkerType,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
	type Viewport,
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
	diagramStageScale,
	type LaidEdge,
	layoutWorkflow,
	runStageScale,
	stageFrameId,
	type StageScale,
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
	// One height for every graph: the screen below the shell, so a page scrolled to its end shows the whole pane.
	diagramPane: {
		boxSizing: "border-box",
		width: "100%",
		height: measure.diagramPane,
		borderWidth: 0,
		backgroundColor: colours.surfaceMuted,
		"--xy-background-color": colours.surfaceMuted,
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
	roleCard: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		minWidth: 0,
		textAlign: "center",
	},
	roleLabel: {
		maxWidth: "100%",
		overflow: "hidden",
		color: colours.ink,
		fontSize: type.small,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	roleName: {
		color: colours.inkSoft,
		fontSize: type.meta,
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

/** The border of a workflow stage in the colour of its agent role. A stage with no role is a tool stage. */
const roleStroke = stylex.create({
	implementer: { stroke: colours.accent },
	verifier: { stroke: colours.awaitingMerge },
	reviewer: { stroke: colours.done },
	receiver: { stroke: colours.warn },
	senior: { stroke: colours.danger },
	manager: { stroke: colours.lineStrong },
	tool: { stroke: colours.inkSoft },
});

const roleOutline = stylex.create({
	other: { stroke: colours.inkMuted },
	all: { fill: colours.raised, strokeWidth: measure.focus },
});

const roleStrokes: ReadonlyMap<string, stylex.StyleXStyles> = new Map(
	Object.entries(roleStroke),
);

/** The text of an agent role in the colour of its stage borders. */
const roleInk = stylex.create({
	implementer: { color: colours.accent },
	verifier: { color: colours.awaitingMerge },
	reviewer: { color: colours.done },
	receiver: { color: colours.warn },
	senior: { color: colours.danger },
	manager: { color: colours.lineStrong },
	other: { color: colours.inkMuted },
});

const roleInks: ReadonlyMap<string, stylex.StyleXStyles> = new Map(
	Object.entries(roleInk),
);

export const roleInkOf = (role: string): stylex.StyleXStyles =>
	roleInks.get(role) ?? roleInk.other;

function roleStrokeOf(role: string | undefined): stylex.StyleXStyles {
	return [
		roleOutline.all,
		role === undefined
			? roleStroke.tool
			: (roleStrokes.get(role) ?? roleOutline.other),
	];
}

function Outline({
	shape,
	stroke,
	layout,
}: {
	shape: string;
	stroke: stylex.StyleXStyles;
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
						className={clsx(stroke)}
					/>
				) : (
					<polyline
						key={mark.points}
						points={mark.points}
						vectorEffect="non-scaling-stroke"
						fill="none"
						className={clsx(stroke)}
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
		/** Set when the graph shows the agent role of each stage instead of its run state. */
		role: { name: string | undefined } | null;
	},
	"stage"
>;

type FrameNode = Node<Record<string, never>, "frame">;

type RouteEdge = Edge<Pick<LaidEdge, "points" | "text" | "condition">, "route">;

function Stage({
	data: { facts, shape, kind, child, role },
}: NodeProps<StageNode>) {
	return (
		<div
			className={clsx(styles.stage, inset[insetOf[shape] ?? "box"])}
			data-shape={shape}
			data-kind={kind}
			data-role={role?.name}
			data-child={child === null ? undefined : child.open ? "open" : "closed"}
		>
			<Handle
				type="target"
				position={Position.Top}
				className={clsx(styles.handle)}
			/>
			<Outline
				shape={shape}
				stroke={
					role === null
						? stageStroke[facts.stage.state]
						: roleStrokeOf(role.name)
				}
				layout={styles.outline}
			/>
			<span className={clsx(styles.body)}>
				{role === null ? (
					<StageCard facts={facts} />
				) : (
					<span className={clsx(styles.roleCard)} title={facts.stage.label}>
						<span className={clsx(styles.roleLabel)}>{facts.stage.label}</span>
						<span className={clsx(styles.roleName)}>
							{role.name ?? stageKindLabel(kind)}
						</span>
					</span>
				)}
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

/** Lays out the graph again only when its stages, edges, open frames, direction or scale change. */
function useLaidWorkflow(
	graph: Graph,
	open: ReadonlySet<string>,
	direction: GraphDirection,
	scale: StageScale,
): WorkflowLayout | undefined {
	const shape = JSON.stringify([
		graph.nodes.map((node) => [
			node.id,
			(node.child ?? []).map((stage) => stage.id),
		]),
		graph.edges,
		[...open].toSorted(),
		direction,
		scale,
	]);
	return useQuery({
		queryKey: ["runGraphLayout", shape],
		queryFn: () =>
			layoutWorkflow(elk(), graph, open, direction, textSize, scale),
		staleTime: Number.POSITIVE_INFINITY,
	}).data;
}

function flowOf(
	graph: Graph,
	laid: WorkflowLayout,
	factsOf: (stage: StageFacts["stage"]) => StageFacts,
	open: ReadonlySet<string>,
	toggle: (id: string) => void,
	roles: boolean,
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
							data: {
								facts: factsOf(stage),
								shape,
								kind,
								child,
								role: roles ? { name: role } : null,
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

/**
 * The stage states of a run, or the stage roles of a diagram with no run,
 * then each shape in the graph with its kind, and the edge text.
 */
function Legend({ graph, byRole }: { graph: Graph; byRole: boolean }) {
	const shapes = [
		...new Map(
			graph.nodes.map((node) => [`${node.shape}\n${node.kind}`, node]),
		).values(),
	];
	const framed = graph.nodes.some((node) => node.child !== undefined);
	// A called graph draws its stages as tool stages.
	const roles = [
		...new Set(
			graph.nodes.flatMap((node) => [
				node.role,
				...(node.child === undefined ? [] : [undefined]),
			]),
		),
	];
	return (
		<LegendFrame id="run-graph-legend" label={runGraphLegendLabel.legend}>
			{byRole ? (
				<ul
					className={clsx(styles.legendRow)}
					aria-label={runGraphLegendLabel.roles}
				>
					{roles.map((role) => (
						<li
							key={role ?? ""}
							className={clsx(board.legendItem)}
							data-legend-role={role ?? runGraphLegendLabel.tool}
						>
							<Outline
								shape="box"
								stroke={roleStrokeOf(role)}
								layout={styles.glyph}
							/>
							{role ?? runGraphLegendLabel.tool}
						</li>
					))}
				</ul>
			) : (
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
							<Outline
								shape="box"
								stroke={stageStroke[state]}
								layout={styles.glyph}
							/>
							{runStageStateLabel[state]}
						</li>
					))}
				</ul>
			)}
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
							stroke={stageStroke.completed}
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
					{byRole
						? runGraphLegendLabel.calledGraphDiagram
						: runGraphLegendLabel.calledGraph}
				</p>
			) : null}
		</LegendFrame>
	);
}

const paneId = "run-graph";

type RunState = {
	checkpoint: RunCheckpoint;
	agents: readonly RunAgent[];
	onPick: (stage: string) => void;
};

/** The diagram pane takes the shape of the laid graph, so the whole graph fills its width. */
const fitted = stylex.create({
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
function laidBounds(laid: WorkflowLayout) {
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
function openingView(
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

/** The graph view of a workflow. With no `run`, each stage border shows its agent role instead of its run state. */
function GraphPane({ graph, run }: { graph: Graph; run: RunState | null }) {
	const checkpoint = run?.checkpoint;
	const agents = run?.agents;
	const [direction, setDirection] = useState<GraphDirection>(
		run === null ? "left-to-right" : "top-to-bottom",
	);
	const scale = run === null ? diagramStageScale : runStageScale;
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
	const laid = useLaidWorkflow(graph, open, direction, scale);
	const flow = useMemo(
		() =>
			laid === undefined
				? null
				: flowOf(
						graph,
						laid,
						(stage) =>
							checkpoint === undefined
								? { stage, tool: null, usage: undefined }
								: stageFacts(stage, checkpoint, agents ?? []),
						open,
						(id) =>
							setToggled((before) => new Map(before).set(id, !open.has(id))),
						checkpoint === undefined,
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
	const bounds = useMemo(
		() =>
			run === null && laid !== undefined && laid.stages.size > 0
				? laidBounds(laid)
				: null,
		[run, laid],
	);
	const fit = useCallback((): FitViewOptions | Viewport => {
		const pane = document.getElementById(paneId);
		if (bounds !== null && pane !== null) {
			return openingView(bounds, {
				width: pane.clientWidth,
				height: pane.clientHeight,
			});
		}
		return {
			maxZoom: 1,
			padding: 0.2,
			...(liveId === undefined ? {} : { nodes: [{ id: liveId }] }),
		};
	}, [bounds, liveId]);
	const fitAll = useCallback(() => ({ padding: 0.1 }), []);
	return (
		<>
			{run === null ? null : (
				<h3 className={clsx(panel.sectionLabel)}>{runGraphLabel}</h3>
			)}
			<figure
				id={paneId}
				{...stylex.props(
					styles.pane,
					run === null && styles.diagramPane,
					run !== null &&
						bounds !== null &&
						fitted.shape(bounds.width, bounds.height),
				)}
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
									run?.onPick(node.id);
								}
							}}
							minZoom={0.1}
							proOptions={{ hideAttribution: true }}
						>
							<FitLayout layout={laid} held={false} refit={refit} fit={fit} />
						</ReactFlow>
					)}
					<div className={clsx(float.overlay)}>
						<Legend graph={graph} byRole={run === null} />
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

/** A workflow graph with no run: each stage in the shape of its node, its border in the colour of its role. */
export function WorkflowDiagram({ graph }: { graph: Graph }) {
	return <GraphPane graph={graph} run={null} />;
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
	const stages = data.graph.nodes.flatMap((node) => [
		node,
		...(node.child ?? []),
	]);
	// A picked child stage that the checkpoint no longer lists falls back to its caller.
	const stage =
		stages.find((item) => item.id === picked) ??
		stages.find((item) => item.id === picked?.split("/")[0]);
	return (
		<div className={clsx(styles.withPane)}>
			<div className={clsx(styles.graphColumn)}>
				<GraphPane
					graph={data.graph}
					run={{ checkpoint: data, agents, onPick: setPicked }}
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
