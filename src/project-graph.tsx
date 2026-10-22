import {
	Background,
	BackgroundVariant,
	BaseEdge,
	type EdgeProps,
	type Edge as FlowEdge,
	type Node as FlowNode,
	Handle,
	type NodeProps,
	Position,
	ReactFlow,
	useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { board } from "./board-styles.ts";
import { cardTones } from "./card-tones.ts";
import { outsideKey, type ProjectReport, type TicketState } from "./domain.ts";
import { focusOrOpen } from "./focus.ts";
import { fitPadding, float, Legend } from "./graph-float.tsx";
import { HierarchyChips } from "./graph-hierarchy-chips.tsx";
import type {
	ClusterNodeData,
	TicketEdgeData,
	TicketNodeData,
} from "./graph-model.ts";
import { graphModel, isClusterNode } from "./graph-model.ts";
import { MeasuredNode, useNodeSpan } from "./graph-node-size.tsx";
import { GraphTools } from "./graph-pane.tsx";
import { type GraphRoute, routeEdge } from "./graph-routes.ts";
import type { NodeSize } from "./graph-sizes.ts";
import { graphDirectionLabel, navLabel, projectGraphLabel } from "./terms.ts";
import { pageTheme, watchPageTheme } from "./theme.ts";
import { clsx } from "./ui.ts";
import { cards, headerControlStyle } from "./ui-styles.ts";
import type { GraphDirection, GroupBy } from "./view-settings.ts";
import { graphDirections } from "./view-settings.ts";

export type OpenedNode = {
	key: string;
	project: string;
	tracker: "github" | "linear";
	title: string;
	outside: boolean;
	state?: TicketState;
};

function shortTicket(key: string, project: string, outside: boolean): string {
	if (!outside) {
		const mark = key.lastIndexOf("#");
		return mark === -1 ? key : key.slice(mark);
	}
	return outsideKey(project, key);
}

function ClusterNode({
	data,
}: NodeProps<FlowNode<ClusterNodeData, "cluster">>) {
	return (
		<div className={clsx(board.cluster)} data-group={data.label}>
			{data.label}
		</div>
	);
}

function TicketNode({ id, data }: NodeProps<FlowNode<TicketNodeData>>) {
	const key = data.ticket.key ?? data.ticket.title;
	const known = data.ticket.state;
	return (
		<button
			type="button"
			className={clsx(
				board.ticketNode,
				board.cardFocus,
				known === undefined ? null : cardTones[known],
				data.outside && board.ticketOutside,
				data.open && board.ticketNodeOpen,
			)}
			data-graph-node={key}
			id={`graph-card-${id}`}
			data-outside={data.outside ? "true" : "false"}
			data-state={known ?? "unknown"}
			aria-pressed={data.open}
		>
			<MeasuredNode id={id} kind="ticket" />
			<Handle type="target" position={Position.Left} id="left" />
			<Handle type="target" position={Position.Top} id="top" />
			<span className={clsx(board.meta)}>
				<span className={clsx(board.key)}>
					{shortTicket(key, data.project, data.outside)}
				</span>
				{data.ticket.pull === undefined ? null : (
					<span className={clsx(board.pull)}>{data.ticket.pull}</span>
				)}
				{data.ticket.needsYou ? (
					<span className={clsx(board.chip, board.chipNeeds)}>
						{navLabel.needsYou}
					</span>
				) : null}
			</span>
			<span className={clsx(board.title)}>{data.ticket.title}</span>
			{data.hierarchyChips ? <HierarchyChips ticket={data.ticket} /> : null}
			<Handle type="source" position={Position.Right} id="right" />
			<Handle type="source" position={Position.Bottom} id="bottom" />
		</button>
	);
}

function TicketEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	markerEnd,
	data,
}: EdgeProps<FlowEdge<TicketEdgeData>>) {
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
	const done = data?.done === true;
	const flowing = done && data?.flowing === true;
	return (
		<BaseEdge
			id={id}
			path={drawn.path}
			data-flowing={flowing ? "true" : "false"}
			className={
				done
					? clsx(board.graphEdgeDash, flowing && board.graphEdgeFlow)
					: undefined
			}
			{...(markerEnd === undefined ? {} : { markerEnd })}
		/>
	);
}

const nodeTypes = { ticket: TicketNode, cluster: ClusterNode };
const edgeTypes = { ticket: TicketEdge };

function layoutParts(): {
	root: HTMLElement;
	legend: HTMLElement;
	controls: HTMLElement;
	floats: HTMLElement[];
} | null {
	const root = document.getElementById("project-graph");
	if (!(root instanceof HTMLElement)) {
		return null;
	}
	const legend = root.querySelector(
		`[aria-label="${projectGraphLabel.legend}"]`,
	);
	const controls = document.getElementById("project-graph-controls");
	const floats = [
		...(controls?.querySelectorAll(":scope > * > *") ?? []),
	].filter((node): node is HTMLElement => node instanceof HTMLElement);
	if (
		!(legend instanceof HTMLElement) ||
		!(controls instanceof HTMLElement) ||
		floats.length === 0
	) {
		return null;
	}
	return { root, legend, controls, floats };
}

function boxesMiss(left: DOMRect, right: DOMRect): boolean {
	return (
		Math.round(left.right) <= Math.round(right.left) ||
		Math.round(left.bottom) <= Math.round(right.top) ||
		Math.round(right.bottom) <= Math.round(left.top)
	);
}

function publishLayout(): void {
	const probe = document.getElementById("project-graph-layout");
	const parts = layoutParts();
	const pane = document.getElementById("project-graph-pane");
	if (probe === null || parts === null || !(pane instanceof HTMLElement)) {
		return;
	}
	const paneBox = pane.getBoundingClientRect();
	const legendBox = parts.legend.getBoundingClientRect();
	const rootBox = parts.root.getBoundingClientRect();
	const apart = parts.floats.every((float) =>
		boxesMiss(legendBox, float.getBoundingClientRect()),
	);
	const border = Number.parseFloat(getComputedStyle(parts.root).borderTopWidth);
	const edge = Number.isFinite(border) ? border : 0;
	const flush =
		Math.round(paneBox.top - edge) === Math.round(rootBox.top) &&
		Math.round(paneBox.bottom + edge) === Math.round(rootBox.bottom);
	const controlsBox = parts.controls.getBoundingClientRect();
	const corner =
		Math.round(controlsBox.left) === Math.round(paneBox.left) &&
		Math.round(controlsBox.bottom) === Math.round(paneBox.bottom);
	const page = document.documentElement;
	const fits = page.scrollWidth === page.clientWidth;
	probe.textContent = [
		flush ? "canvas-flush" : "canvas-offset",
		apart ? "floats-apart" : "floats-cover",
		fits ? "page-fits" : "page-scrolls",
		corner ? "controls-corner" : "controls-moved",
	].join(" ");
}

function watchLayout(span: NodeSize | null): () => void {
	if (span === null) {
		return () => {};
	}
	const parts = layoutParts();
	if (parts === null) {
		return () => {};
	}
	publishLayout();
	const observer = new ResizeObserver(publishLayout);
	observer.observe(parts.root);
	observer.observe(document.documentElement);
	observer.observe(parts.legend);
	for (const float of parts.floats) {
		observer.observe(float);
	}
	return () => observer.disconnect();
}

function FitDirection() {
	const flow = useReactFlow();
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			void flow.fitView({
				padding: fitPadding,
				maxZoom: 1,
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [flow]);
	return null;
}

export function ProjectGraph({
	report,
	reports,
	direction,
	groupBy,
	assignees,
	openKey,
	chain,
	onOpen,
	onFocus,
	onPreview,
	onPreviewEnd,
	onDirection,
}: {
	report: ProjectReport;
	reports: ProjectReport[];
	direction: GraphDirection;
	groupBy: GroupBy;
	assignees: readonly string[];
	openKey: string | null;
	chain: ReadonlySet<string> | null;
	onOpen: (ticket: OpenedNode) => void;
	onFocus: (nodeId: string) => void;
	onPreview: (nodeId: string) => void;
	onPreviewEnd: () => void;
	onDirection: (direction: GraphDirection) => void;
}) {
	const span = useNodeSpan(board.ticketNode, "ticket", "Ticket");
	const [theme, setTheme] = useState(pageTheme);
	useEffect(() => watchPageTheme(setTheme), []);
	const model = useMemo(() => {
		if (span === null) {
			return null;
		}
		void theme;
		return graphModel(
			report,
			reports,
			direction,
			groupBy,
			assignees,
			openKey,
			new Map(),
			span,
		);
	}, [report, reports, direction, groupBy, assignees, openKey, span, theme]);
	useEffect(() => watchLayout(span), [span]);
	if (model === null) {
		return <div id="project-graph" className={clsx(board.ticketGraph)} />;
	}
	const fades = clsx(board.fades);
	const faded = clsx(board.fades, board.faded);
	const nodes = model.nodes.map((node) => {
		const kept = isClusterNode(node)
			? node.data.members.some((id) => chain?.has(id) === true)
			: chain?.has(node.id) === true;
		return { ...node, className: chain === null || kept ? fades : faded };
	});
	const edges = model.edges.map((edge) => {
		const kept =
			chain === null || (chain.has(edge.source) && chain.has(edge.target));
		const className = `${edge.className ?? ""} ${kept ? fades : faded}`.trim();
		if (chain === null || !kept || edge.data === undefined) {
			return { ...edge, className };
		}
		return { ...edge, className, data: { ...edge.data, flowing: true } };
	});
	const places = model.nodes
		.map((node) => {
			const x = node.position.x;
			const y = node.position.y;
			return `${node.id.replaceAll("\n", " ")} ${x},${y}`;
		})
		.join(" | ");

	const outsideLabels = model.nodes.flatMap((node) =>
		isClusterNode(node) || !node.data.outside
			? []
			: [shortTicket(node.data.ticket.key ?? "", node.data.project, true)],
	);
	return (
		<div
			id="project-graph"
			className={clsx(board.ticketGraph)}
			data-group-by={groupBy}
		>
			<p id="project-graph-focus" className={clsx(cards.graphProbe)}>
				{chain === null
					? "focus none"
					: `focus ${[...chain]
							.sort()
							.map((id) => id.replace("\n", " "))
							.join(" | ")}`}
			</p>
			<p id="project-graph-places" className={clsx(cards.graphProbe)}>
				{places}
			</p>
			<p id="project-graph-direction" className={clsx(cards.graphProbe)}>
				{direction}
			</p>
			<p id="project-graph-outside" className={clsx(cards.graphProbe)}>
				{outsideLabels.join(" | ")}
			</p>
			<p id="project-graph-layout" className={clsx(cards.graphProbe)} />
			<p id="project-graph-panel" className={clsx(cards.graphProbe)}>
				{openKey === null ? "panel closed" : "panel open"}
			</p>
			<p id="graph-states" className={clsx(cards.graphProbe)}>
				{model.nodes
					.flatMap((node) =>
						isClusterNode(node)
							? []
							: [
									`${node.data.ticket.key ?? node.id} ${node.data.ticket.state ?? "unknown"}`,
								],
					)
					.join(" | ")}
			</p>
			<div
				id="project-graph-pane"
				className={clsx(board.graphPane, float.pane)}
			>
				<ReactFlow
					key={direction}
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable={false}
					panOnDrag
					zoomOnDoubleClick={false}
					fitView
					minZoom={0.1}
					fitViewOptions={{
						padding: fitPadding,
						maxZoom: 1,
					}}
					proOptions={{ hideAttribution: true }}
					onNodeMouseEnter={(_event, node) => {
						if (!isClusterNode(node)) {
							onPreview(node.id);
						}
					}}
					onNodeMouseLeave={onPreviewEnd}
					onNodeDoubleClick={(_event, node) => {
						if (!isClusterNode(node)) {
							onFocus(node.id);
						}
					}}
					onNodeClick={(event, node) => {
						if (isClusterNode(node)) {
							return;
						}
						focusOrOpen(
							event,
							() => onFocus(node.id),
							() =>
								onOpen({
									key: node.data.ticket.key ?? node.data.ticket.title,
									project: node.data.project,
									tracker: node.data.tracker,
									title: node.data.ticket.title,
									outside: node.data.outside,
									...(node.data.ticket.state === undefined
										? {}
										: { state: node.data.ticket.state }),
								}),
						);
					}}
				>
					<Background variant={BackgroundVariant.Dots} gap={18} />
					<FitDirection key={direction} />
				</ReactFlow>
				<div className={clsx(float.overlay)}>
					<Legend />
				</div>
				<div id="project-graph-controls" className={clsx(float.corner)}>
					<div className={clsx(float.group)}>
						<DirectionSwitch direction={direction} onChange={onDirection} />
						<GraphTools
							probeId="project-graph-viewport"
							fitId="project-graph-fit"
							scope="#project-graph"
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

export function DirectionSwitch({
	direction,
	onChange,
}: {
	direction: GraphDirection;
	onChange: (direction: GraphDirection) => void;
}) {
	return (
		<fieldset className={clsx(headerControlStyle.group)}>
			<legend className={clsx(cards.graphProbe)}>Graph direction</legend>
			{graphDirections.map((item) => (
				<button
					key={item}
					type="button"
					id={`graph-direction-${item}`}
					className={clsx(
						headerControlStyle.segment,
						direction === item && headerControlStyle.segmentOn,
					)}
					aria-pressed={direction === item}
					onClick={() => onChange(item)}
				>
					{graphDirectionLabel[item]}
				</button>
			))}
		</fieldset>
	);
}
