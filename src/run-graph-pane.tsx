import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
	type FitViewOptions,
	ReactFlow,
	ReactFlowProvider,
	type Viewport,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";

import type { RunGraph as Graph } from "./domain.ts";
import { ClearFocusButton } from "./focus-controls.tsx";
import { shownSeeds, useClickOrDouble, useFocusView } from "./focus.ts";
import { elk, FitLayout } from "./graph-core-view.tsx";
import { float, FloatPanel } from "./graph-float.tsx";
import { GraphTools } from "./graph-pane.tsx";
import { DirectionSwitch } from "./graph-switches.tsx";
import {
	diagramStageScale,
	layoutWorkflow,
	runStageScale,
	stageFrameId,
	type StageScale,
	type WorkflowLayout,
} from "./graph-workflow.ts";
import { panel } from "./panel-styles.ts";
import { Legend } from "./run-graph-legend.tsx";
import {
	type DiagramCalls,
	fitted,
	flowOf,
	laidBounds,
	noCalls,
	openingView,
	paneId,
	type RunState,
	stageFocus,
	textSize,
} from "./run-graph-model.ts";
import { edgeTypes, nodeTypes } from "./run-graph-nodes.tsx";
import { liveStage, stageFacts } from "./run-stage.tsx";
import { runGraphHelp, runGraphLabel } from "./run-terms.ts";
import { floatPanelLabel } from "./terms.ts";
import { colours, measure, radius } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import type { GraphDirection } from "./view-settings.ts";

const paneStyles = stylex.create({
	takesPointer: {
		pointerEvents: "auto",
	},
	pane: {
		position: "relative",
		height: measure.runGraph,
		margin: 0,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		overflow: "hidden",
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
});

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

/** The graph view of a workflow. With no `run`, each stage border shows its agent role instead of its run state. */
export function GraphPane({
	graph,
	run,
	diagram = noCalls,
}: {
	graph: Graph;
	run: RunState | null;
	diagram?: DiagramCalls;
}) {
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
	const focus = useFocusView();
	const clicks = useClickOrDouble();
	const stagesFocus = useMemo(() => {
		const seeds = shownSeeds(focus.focus, focus.preview);
		return seeds.size === 0 ? null : stageFocus(seeds, graph.edges);
	}, [focus.focus, focus.preview, graph]);
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
						diagram.calls,
						diagram.onOpen,
						stagesFocus,
					),
		[
			graph,
			laid,
			checkpoint,
			agents,
			open,
			diagram.calls,
			diagram.onOpen,
			stagesFocus,
		],
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
					paneStyles.pane,
					run === null && paneStyles.diagramPane,
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
							onNodeMouseEnter={(_event, node) => {
								if (node.type === "stage") {
									focus.enter(node.id);
								}
							}}
							onNodeMouseLeave={focus.leave}
							onNodeDoubleClick={(_event, node) => {
								if (node.type === "stage") {
									clicks.double(() => focus.toggle(node.id));
								}
							}}
							onNodeClick={(event, node) => {
								if (node.type !== "stage") {
									return;
								}
								const pick = run === null ? diagram.onPick : run.onPick;
								clicks.click(event, {
									focus: () => focus.toggle(node.id),
									open: () => pick(node.id),
								});
							}}
							minZoom={0.1}
							proOptions={{ hideAttribution: true }}
						>
							<FitLayout layout={laid} held={false} refit={refit} fit={fit} />
						</ReactFlow>
					)}
					<div className={clsx(float.overlay)}>
						<Legend
							graph={graph}
							byRole={run === null}
							opens={diagram.calls.size > 0}
						/>
						{focus.focus.size === 0 ? null : (
							<span className={clsx(paneStyles.takesPointer)}>
								<ClearFocusButton onClear={focus.clear} />
							</span>
						)}
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
