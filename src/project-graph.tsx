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
} from "@xyflow/react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { board } from "./board-styles.ts";
import { useCollapse } from "./collapse.ts";
import {
	focusChain,
	outsideKey,
	type ProjectReport,
	type TicketState,
} from "./domain.ts";
import { focusOrOpen } from "./focus.ts";
import {
	fitPadding,
	float,
	Legend,
	LegendProbe,
	legendFit,
} from "./graph-float.tsx";
import { projectNodeId } from "./graph-flow.ts";
import { HierarchyChips } from "./graph-hierarchy-chips.tsx";
import { type Anchor, FitLayout, useLaidGraph } from "./graph-laid.tsx";
import { focusLinks, focusSeeds } from "./graph-layout.ts";
import type {
	ClusterNodeData,
	TicketEdgeData,
	TicketNodeData,
} from "./graph-model.ts";
import { graphModel, isClusterNode } from "./graph-model.ts";
import { MeasuredNode, useNodeSpan } from "./graph-node-size.tsx";
import { GraphTools } from "./graph-pane.tsx";
import { type GraphRoute, routeEdge } from "./graph-routes.ts";
import { FrameTools, ScopeLine } from "./graph-scope.tsx";
import type { NodeSize } from "./graph-sizes.ts";
import { DirectionSwitch, LayoutSwitch } from "./graph-switches.tsx";
import { stateTones } from "./state-tone.ts";
import { tableTree } from "./table-tree-styles.ts";
import {
	graphLayoutFailedLabel,
	navLabel,
	openParentLabel,
	projectGraphLabel,
	stateLabel,
	subTicketsDoneLabel,
	subTicketsToggleLabel,
} from "./terms.ts";
import { pageTheme, watchPageTheme } from "./theme.ts";
import { clsx } from "./ui.ts";
import { cards, panel } from "./ui-styles.ts";
import type {
	GraphDirection,
	GraphLayoutKind,
	GroupBy,
} from "./view-settings.ts";

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
	if (data.head !== undefined) {
		return <div className={clsx(board.cluster)} data-frame={data.head} />;
	}
	return (
		<div className={clsx(board.cluster)} data-group={data.label}>
			{data.label}
		</div>
	);
}

const FrameToggleContext = createContext<
	(card: string, key: string, startsCollapsed: boolean) => void
>(() => {});

function FrameToggle({
	card,
	ticket,
	collapsed,
	startsCollapsed,
}: {
	card: string;
	ticket: string;
	collapsed: boolean;
	startsCollapsed: boolean;
}) {
	const toggle = useContext(FrameToggleContext);
	return (
		<button
			type="button"
			className={clsx(board.frameToggle, board.cardFocus)}
			data-frame-toggle={ticket}
			aria-expanded={!collapsed}
			aria-label={subTicketsToggleLabel(ticket, collapsed)}
			onClick={(event) => {
				event.stopPropagation();
				toggle(card, ticket, startsCollapsed);
			}}
			// Focus scrolls the React Flow box when the graph overflows it, which
			// moves the toggle away before the click lands.
			onMouseDownCapture={(event) => event.preventDefault()}
			onDoubleClick={(event) => event.stopPropagation()}
		>
			<svg
				viewBox="0 0 8 8"
				aria-hidden="true"
				className={clsx(
					tableTree.toggleMark,
					collapsed && tableTree.toggleShut,
				)}
			>
				<path d="M2.5 1 5.5 4 2.5 7" fill="none" stroke="currentColor" />
			</svg>
		</button>
	);
}

function TicketNode({ id, data }: NodeProps<FlowNode<TicketNodeData>>) {
	const key = data.ticket.key;
	const known = data.ticket.state;
	return (
		<>
			<button
				type="button"
				className={clsx(
					board.ticketNode,
					board.cardFocus,
					known !== undefined && board.toned,
					known !== undefined && stateTones[known],
					data.ticket.outside && board.ticketOutside,
					data.ticket.outside &&
						known === undefined &&
						board.ticketOutsideUntoned,
					data.open && board.ticketNodeOpen,
				)}
				data-graph-node={key}
				id={`graph-card-${id}`}
				data-outside={data.ticket.outside ? "true" : "false"}
				data-state={known ?? "unknown"}
				aria-pressed={data.open}
			>
				<MeasuredNode id={id} kind="ticket" />
				<Handle type="target" position={Position.Left} id="left" />
				<Handle type="target" position={Position.Top} id="top" />
				<span
					className={clsx(
						board.meta,
						data.frame !== null && board.metaBesideToggle,
					)}
				>
					<span className={clsx(board.key)}>
						{shortTicket(key, data.ticket.project, data.ticket.outside)}
					</span>
					{data.ticket.pull === undefined ? null : (
						<span className={clsx(board.pull)}>{data.ticket.pull}</span>
					)}
					{data.frame !== null && data.ticket.outside ? (
						<span className={clsx(board.pull)}>
							{known === undefined ? openParentLabel : stateLabel[known]}
						</span>
					) : null}
					{data.frame !== null && data.ticket.subTickets !== undefined ? (
						<span className={clsx(board.pull)}>
							{subTicketsDoneLabel(
								data.ticket.subTicketsDone ?? 0,
								data.ticket.subTickets,
							)}
						</span>
					) : null}
					{data.ticket.needsYou ? (
						<span className={clsx(board.chip, board.chipNeeds)}>
							{navLabel.needsYou}
						</span>
					) : null}
				</span>
				<span className={clsx(board.title)}>{data.ticket.title}</span>
				{data.hierarchyChips ? (
					<HierarchyChips ticket={data.ticket} parentLabel={data.parentLabel} />
				) : null}
				<Handle type="source" position={Position.Right} id="right" />
				<Handle type="source" position={Position.Bottom} id="bottom" />
			</button>
			{data.frame === null ? null : (
				<FrameToggle
					card={id}
					ticket={data.ticket.key}
					collapsed={data.frame === "collapsed"}
					startsCollapsed={data.ticket.startsCollapsed === true}
				/>
			)}
		</>
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
	const drawn =
		data?.straight ??
		routeEdge(
			route,
			data?.lane ?? 0,
			data?.lanes ?? 1,
			data?.nodes ?? [],
			data?.label ?? { x: 0, y: 0 },
			data?.entry ?? 0,
			data?.entries ?? 1,
			data?.side,
		).path;
	const done = data?.done === true;
	const flowing = done && data?.flowing === true;
	return (
		<g key={drawn} className={clsx(board.edgeEnters)}>
			<BaseEdge
				id={id}
				path={drawn}
				data-flowing={flowing ? "true" : "false"}
				className={
					done
						? clsx(board.graphEdgeDash, flowing && board.graphEdgeFlow)
						: undefined
				}
				{...(markerEnd === undefined ? {} : { markerEnd })}
			/>
		</g>
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

function seedLabel(
	report: ProjectReport,
	shown: ReadonlyMap<string, string>,
	seed: string,
): string {
	const label = shown.get(seed);
	if (label !== undefined) {
		return label;
	}
	const key =
		report.tickets.find(
			(item) =>
				item.key !== null && projectNodeId(report.name, item.key) === seed,
		)?.key ?? null;
	return key === null
		? seed.slice(seed.indexOf("\n") + 1)
		: shortTicket(key, report.name, false);
}

export function ProjectGraph({
	report,
	reports,
	direction,
	layout,
	groupBy,
	assignees,
	openKey,
	seeds,
	focus,
	onOpen,
	onFocus,
	onClearFocus,
	onPreview,
	onPreviewEnd,
	onDirection,
	onLayout,
}: {
	report: ProjectReport;
	reports: ProjectReport[];
	direction: GraphDirection;
	layout: GraphLayoutKind;
	groupBy: GroupBy;
	assignees: readonly string[];
	openKey: string | null;
	seeds: ReadonlySet<string>;
	focus: ReadonlySet<string>;
	onOpen: (ticket: OpenedNode) => void;
	onFocus: (nodeId: string) => void;
	onClearFocus: () => void;
	onPreview: (nodeId: string) => void;
	onPreviewEnd: () => void;
	onDirection: (direction: GraphDirection) => void;
	onLayout: (layout: GraphLayoutKind) => void;
}) {
	const span = useNodeSpan(board.ticketNode, "ticket", "Ticket");
	const [theme, setTheme] = useState(pageTheme);
	useEffect(() => watchPageTheme(setTheme), []);
	const collapse = useCollapse();
	const anchor = useRef<Anchor | null>(null);
	const [refit, setRefit] = useState(0);
	const { laid, failed } = useLaidGraph(
		report,
		direction,
		layout,
		groupBy,
		assignees,
		collapse.collapsed,
		span,
		anchor,
	);
	const toggleFrame = useCallback(
		(card: string, key: string, startsCollapsed: boolean) => {
			const at = laid?.layout.cards.get(card);
			anchor.current = at === undefined ? null : { card, at };
			collapse.toggle(key, startsCollapsed);
		},
		[laid, collapse],
	);
	const model = useMemo(() => {
		if (span === null || laid === null) {
			return null;
		}
		void theme;
		return graphModel(
			laid.report,
			reports,
			laid.direction,
			laid.kind,
			laid.groupBy,
			openKey,
			laid.input,
			laid.layout,
			laid.sizes,
			span,
		);
	}, [laid, reports, openKey, span, theme]);
	useEffect(() => watchLayout(span), [span]);
	if (model === null || laid === null) {
		return (
			<div id="project-graph" className={clsx(board.ticketGraph)}>
				{failed && laid === null ? (
					<p className={clsx(panel.error)} role="alert">
						{graphLayoutFailedLabel}
					</p>
				) : null}
			</div>
		);
	}
	const drawn = `${laid.kind} ${laid.direction}`;
	const chain =
		seeds.size === 0
			? null
			: focusChain(focusSeeds(laid.input, seeds), focusLinks(laid.input));
	const ticketOf = new Map(
		laid.input.cards.map((card) => [card.id, card.ticket]),
	);
	const fades = clsx(board.fades);
	const faded = clsx(board.fades, board.faded);
	const moves = clsx(board.moves);
	const movesFaded = clsx(board.moves, board.faded);
	const nodes = model.nodes.map((node) => {
		const kept = isClusterNode(node)
			? node.data.members.some((id) => chain?.has(id) === true)
			: chain?.has(node.data.ticketId) === true;
		return { ...node, className: chain === null || kept ? moves : movesFaded };
	});
	const shownLabels = new Map(
		model.nodes.flatMap((node) =>
			isClusterNode(node)
				? []
				: [
						[
							node.data.ticketId,
							shortTicket(
								node.data.ticket.key,
								node.data.ticket.project,
								node.data.ticket.outside,
							),
						] as const,
					],
		),
	);
	const toScope = (frames: "collapse" | "keep", clearFocus: boolean) => {
		anchor.current = null;
		if (frames === "collapse") {
			collapse.setAll(laid.input.parents, true);
		}
		if (clearFocus) {
			onClearFocus();
		}
		setRefit((count) => count + 1);
	};
	const edges = model.edges.map((edge) => {
		const kept =
			chain === null ||
			(chain.has(ticketOf.get(edge.source) ?? edge.source) &&
				chain.has(ticketOf.get(edge.target) ?? edge.target));
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

	const frameBoxes = model.nodes.flatMap((node) =>
		isClusterNode(node) && node.data.head !== undefined
			? [
					{
						head: node.data.head,
						left: node.position.x,
						top: node.position.y,
						right: node.position.x + (node.width ?? 0),
						bottom: node.position.y + (node.height ?? 0),
					},
				]
			: [],
	);
	const framedCards = model.nodes.flatMap((node) => {
		if (isClusterNode(node)) {
			return [];
		}
		const left = node.position.x;
		const top = node.position.y;
		const right = left + (node.width ?? 0);
		const bottom = top + (node.height ?? 0);
		const key = node.data.ticket.key;
		const holders = frameBoxes
			.filter(
				(box) =>
					box.head !== key &&
					box.left <= left &&
					box.top <= top &&
					right <= box.right &&
					bottom <= box.bottom,
			)
			.sort(
				(one, other) =>
					(one.right - one.left) * (one.bottom - one.top) -
					(other.right - other.left) * (other.bottom - other.top),
			)
			.map((box) => box.head);
		return holders.length === 0 ? [] : [[key, ...holders].join(" in ")];
	});
	const outsideLabels = model.nodes.flatMap((node) =>
		isClusterNode(node) || !node.data.ticket.outside
			? []
			: [shortTicket(node.data.ticket.key, node.data.ticket.project, true)],
	);
	return (
		<div
			id="project-graph"
			className={clsx(board.ticketGraph)}
			data-group-by={laid.groupBy}
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
				{laid.direction}
			</p>
			<p id="project-graph-engine" className={clsx(cards.graphProbe)}>
				{laid.kind}
			</p>
			<p id="project-graph-frames" className={clsx(cards.graphProbe)}>
				{framedCards.sort().join(" | ")}
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
									`${node.data.ticket.key} ${node.data.ticket.state ?? "unknown"}`,
								],
					)
					.join(" | ")}
			</p>
			<div
				id="project-graph-pane"
				className={clsx(board.graphPane, float.pane)}
			>
				<FrameToggleContext value={toggleFrame}>
					<ReactFlow
						key={drawn}
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
								onPreview(node.data.ticketId);
							}
						}}
						onNodeMouseLeave={onPreviewEnd}
						onNodeDoubleClick={(_event, node) => {
							if (!isClusterNode(node)) {
								onFocus(node.data.ticketId);
							}
						}}
						onNodeClick={(event, node) => {
							if (isClusterNode(node)) {
								return;
							}
							focusOrOpen(
								event,
								() => onFocus(node.data.ticketId),
								() =>
									onOpen({
										key: node.data.ticket.key,
										project: node.data.ticket.project,
										tracker: node.data.ticket.tracker,
										title: node.data.ticket.title,
										outside: node.data.ticket.outside,
										...(node.data.ticket.state === undefined
											? {}
											: { state: node.data.ticket.state }),
									}),
							);
						}}
					>
						<Background variant={BackgroundVariant.Dots} gap={18} />
						<FitLayout
							key={drawn}
							layout={laid.layout}
							held={laid.held}
							refit={refit}
						/>
						<LegendProbe />
					</ReactFlow>
				</FrameToggleContext>
				<div className={clsx(float.overlay)}>
					<ScopeLine
						project={report.name}
						openFrames={laid.input.frames.length}
						focus={[...focus].map((seed) =>
							seedLabel(report, shownLabels, seed),
						)}
						onProject={() => toScope("collapse", true)}
						onFrames={() => toScope("keep", true)}
						onFocus={() => toScope("keep", false)}
					/>
					<Legend />
				</div>
				<div id="project-graph-controls" className={clsx(float.corner)}>
					<div className={clsx(float.group)}>
						<LayoutSwitch layout={layout} onChange={onLayout} />
						<DirectionSwitch
							direction={direction}
							disabled={layout !== "layered"}
							onChange={onDirection}
						/>
						<GraphTools
							probeId="project-graph-viewport"
							fitId="project-graph-fit"
							scope="#project-graph"
							fitOptions={legendFit}
						/>
						<FrameTools
							parents={laid.input.parents.length}
							onAll={(shut) => {
								anchor.current = null;
								collapse.setAll(laid.input.parents, shut);
								setRefit((count) => count + 1);
							}}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
