import {
	Background,
	BackgroundVariant,
	BaseEdge,
	type EdgeProps,
	type Edge as FlowEdge,
	type Node as FlowNode,
	Handle,
	type NodeProps,
	Panel,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import {
	groupKeysOf,
	groupLabelOf,
	outsideKey,
	type ProjectReport,
	type TicketRelation,
	type TicketState,
} from "./domain.ts";
import { MeasuredNode, useNodeSpan } from "./graph-node-size.tsx";
import { columnDepth } from "./graph-pane.tsx";
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
import {
	graphDirectionLabel,
	navLabel,
	projectGraphLabel,
	stateLabel,
} from "./terms.ts";
import { classToken, clsx } from "./ui.ts";
import { board, cards, headerControlStyle } from "./ui-styles.ts";
import type { GraphDirection, GroupBy } from "./view-settings.ts";
import { graphDirections } from "./view-settings.ts";

const columnGap = 280;
const rowGap = 148;
const groupPad = 16;
const groupHead = 28;

type GraphTicketView = {
	key: string | null;
	title: string;
	state?: TicketState;
	pull?: string;
	needsYou?: boolean;
	workstream?: string;
	workstreamKey?: string;
	theme?: string;
	assignees?: string[];
};

type TicketNodeData = {
	ticket: GraphTicketView;
	outside: boolean;
	project: string;
	tracker: "github" | "linear";
	open: boolean;
};

type ClusterNodeData = {
	name: string;
	label: string;
};

type ProjectNodeData = TicketNodeData | ClusterNodeData;

type ProjectNode =
	| FlowNode<TicketNodeData, "ticket">
	| FlowNode<ClusterNodeData, "cluster">;

function isClusterNode(
	node: FlowNode<ProjectNodeData>,
): node is FlowNode<ClusterNodeData, "cluster"> {
	return node.type === "cluster";
}

export type OpenedNode = {
	key: string;
	project: string;
	tracker: "github" | "linear";
	title: string;
	outside: boolean;
	state?: TicketState;
};

type TicketEdgeData = {
	lane: number;
	lanes: number;
	entry: number;
	entries: number;
	nodes: NodeBound[];
	label: { x: number; y: number };
	side: number;
};

function shortTicket(key: string, project: string, outside: boolean): string {
	if (!outside) {
		const mark = key.lastIndexOf("#");
		return mark === -1 ? key : key.slice(mark);
	}
	return outsideKey(project, key);
}

function nodeId(project: string, key: string): string {
	return `${project}\n${key.toLowerCase()}`;
}

const stateTone: Record<
	TicketState,
	{ label: string; tone: (typeof board)["ticketReady"] }
> = {
	backlog: { label: stateLabel.backlog, tone: board.ticketReady },
	inProgress: { label: stateLabel.inProgress, tone: board.ticketProgress },
	inReview: { label: stateLabel.inReview, tone: board.ticketReview },
	awaitingMerge: { label: stateLabel.awaitingMerge, tone: board.ticketMerge },
	done: { label: stateLabel.done, tone: board.ticketDone },
	dropped: { label: stateLabel.dropped, tone: board.ticketDropped },
};

const legendTone: Record<TicketState, (typeof board)["legendDone"]> = {
	backlog: board.legendReady,
	inProgress: board.legendProgress,
	inReview: board.legendReview,
	awaitingMerge: board.legendMerge,
	done: board.legendDone,
	dropped: board.legendDropped,
};

const legendOrder = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
	"dropped",
] as const satisfies ReadonlyArray<TicketState>;

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
				known === undefined ? null : stateTone[known].tone,
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
	return (
		<BaseEdge
			id={id}
			path={drawn.path}
			{...(markerEnd === undefined ? {} : { markerEnd })}
		/>
	);
}

const nodeTypes = { ticket: TicketNode, cluster: ClusterNode };
const edgeTypes = { ticket: TicketEdge };

type GraphTicket = {
	ticket: GraphTicketView;
	project: string;
	tracker: "github" | "linear";
	outside: boolean;
};

function outsideState(
	reports: ProjectReport[],
	project: string,
	key: string,
): TicketState | undefined {
	const home = reports.find(
		(report) => report.name.toLowerCase() === project.toLowerCase(),
	);
	return home?.tickets.find(
		(ticket) => ticket.key?.toLowerCase() === key.toLowerCase(),
	)?.state;
}

function outsideNode(
	blocker: TicketRelation,
	reports: ProjectReport[],
): GraphTicket {
	const state = outsideState(reports, blocker.project, blocker.key);
	return {
		ticket: {
			key: blocker.key,
			title: blocker.title,
			...(state === undefined ? {} : { state }),
		},
		project: blocker.project,
		tracker: blocker.tracker,
		outside: true,
	};
}

function outsideTickets(
	report: ProjectReport,
	reports: ProjectReport[],
): GraphTicket[] {
	const seen = new Set<string>();
	const found: GraphTicket[] = [];
	for (const ticket of report.tickets) {
		for (const blocker of [
			...(ticket.outsideBlockers ?? []),
			...(ticket.blocks ?? []),
		]) {
			if (blocker.project.toLowerCase() === report.name.toLowerCase()) {
				continue;
			}
			const id = nodeId(blocker.project, blocker.key);
			if (seen.has(id)) {
				continue;
			}
			seen.add(id);
			found.push(outsideNode(blocker, reports));
		}
	}
	found.sort((left, right) =>
		`${left.project} ${left.ticket.key ?? ""}`.localeCompare(
			`${right.project} ${right.ticket.key ?? ""}`,
		),
	);
	return found;
}

function localTickets(report: ProjectReport): GraphTicket[] {
	return report.tickets.flatMap((ticket) => {
		if (ticket.key === null) {
			return [];
		}
		return [
			{
				ticket,
				project: report.name,
				tracker: report.tracker,
				outside: false,
			},
		];
	});
}

const outsideBand = "\u0000outside";

function bandNames(ticket: GraphTicket, groupBy: GroupBy): string[] {
	if (ticket.outside) {
		return [outsideBand];
	}
	if (groupBy === "none") {
		return [""];
	}
	return groupKeysOf(ticket.ticket, groupBy);
}

function graphBand(
	ticket: GraphTicket,
	groupBy: GroupBy,
	assignees: readonly string[],
): string {
	const names = bandNames(ticket, groupBy);
	if (groupBy !== "assignee" || names.length < 2) {
		return names[0] ?? "";
	}
	const wanted = new Set(
		assignees.flatMap((name) => {
			const trimmed = name.trim().toLowerCase();
			return trimmed === "" ? [] : [trimmed];
		}),
	);
	if (wanted.size === 0) {
		return names[0] ?? "";
	}
	return names.find((name) => wanted.has(name.toLowerCase())) ?? names[0] ?? "";
}

function ticketIds(tickets: GraphTicket[]): string[] {
	return tickets.flatMap((ticket) =>
		ticket.ticket.key === null
			? []
			: [nodeId(ticket.project, ticket.ticket.key)],
	);
}

function layoutTickets(
	tickets: GraphTicket[],
	edges: { from: string; to: string }[],
	direction: GraphDirection,
	groupBy: GroupBy,
	assignees: readonly string[],
): Map<string, { x: number; y: number }> {
	const incoming = new Map<string, string[]>();
	for (const edge of edges) {
		const sources = incoming.get(edge.to) ?? [];
		sources.push(edge.from);
		incoming.set(edge.to, sources);
	}
	const depth = columnDepth(ticketIds(tickets), incoming);
	const outgoing = new Set(edges.map((edge) => edge.from));
	const ordered = [...tickets].sort((left, right) =>
		`${left.ticket.key ?? left.ticket.title}`.localeCompare(
			`${right.ticket.key ?? right.ticket.title}`,
		),
	);
	if (groupBy === "none") {
		const columns = new Map<number, string[]>();
		for (const id of ticketIds(ordered)) {
			const column = depth.get(id) ?? 0;
			const names = columns.get(column) ?? [];
			names.push(id);
			columns.set(column, names);
		}
		const positions = new Map<string, { x: number; y: number }>();
		for (const [column, names] of columns) {
			names.forEach((id, index) => {
				positions.set(
					id,
					direction === "top-to-bottom"
						? { x: index * columnGap, y: column * rowGap }
						: { x: column * columnGap, y: index * rowGap },
				);
			});
		}
		return positions;
	}
	const groups = [
		...new Set(tickets.flatMap((ticket) => bandNames(ticket, groupBy))),
	].sort((left, right) => left.localeCompare(right));
	const members = new Map<string, string[]>();
	for (const ticket of ordered) {
		const key = ticket.ticket.key;
		if (key === null) {
			continue;
		}
		const name = graphBand(ticket, groupBy, assignees);
		const known = members.get(name) ?? [];
		known.push(nodeId(ticket.project, key));
		members.set(name, known);
	}
	const slots = new Map<string, { along: number; across: number }>();
	const groupSpan = new Map<string, { along: number; across: number }>();
	for (const name of groups) {
		const ids = members.get(name) ?? [];
		const linked = ids.filter((id) => incoming.has(id) || outgoing.has(id));
		const loose = ids.filter((id) => !incoming.has(id) && !outgoing.has(id));
		const byColumn = new Map<number, string[]>();
		let minDepth = Number.POSITIVE_INFINITY;
		for (const id of linked) {
			const column = depth.get(id) ?? 0;
			minDepth = Math.min(minDepth, column);
			const names = byColumn.get(column) ?? [];
			names.push(id);
			byColumn.set(column, names);
		}
		const looseAcross =
			loose.length === 0 ? 1 : Math.ceil(Math.sqrt(loose.length));
		const looseAlong =
			loose.length === 0 ? 0 : Math.ceil(loose.length / looseAcross);
		const chainStart = Number.isFinite(minDepth) ? minDepth : 0;
		let chainAcross = 1;
		let chainAlong = 0;
		for (const [column, names] of byColumn) {
			const along = column - chainStart;
			names.forEach((id, index) => {
				slots.set(id, { along, across: index });
			});
			chainAcross = Math.max(chainAcross, names.length);
			chainAlong = Math.max(chainAlong, along + 1);
		}
		loose.forEach((id, index) => {
			slots.set(id, {
				along: chainAlong + Math.floor(index / looseAcross),
				across: index % looseAcross,
			});
		});
		groupSpan.set(name, {
			along: Math.max(chainAlong + looseAlong, 1),
			across: Math.max(loose.length === 0 ? 1 : looseAcross, chainAcross),
		});
	}
	const groupStart = new Map<string, number>();
	let cursor = 0;
	for (const name of groups) {
		groupStart.set(name, cursor);
		const span = groupSpan.get(name) ?? { along: 1, across: 1 };
		const width =
			direction === "top-to-bottom"
				? span.across * columnGap
				: span.along * columnGap;
		cursor += width + groupPad * 2;
	}
	const positions = new Map<string, { x: number; y: number }>();
	for (const [name, ids] of members) {
		const origin = groupStart.get(name) ?? 0;
		for (const id of ids) {
			const slot = slots.get(id) ?? { along: 0, across: 0 };
			positions.set(
				id,
				direction === "top-to-bottom"
					? {
							x: slot.across * columnGap + origin,
							y: slot.along * rowGap,
						}
					: {
							x: slot.along * columnGap + origin,
							y: slot.across * rowGap,
						},
			);
		}
	}
	return positions;
}

function graphEdges(report: ProjectReport): { from: string; to: string }[] {
	const local = new Map<string, string>();
	for (const ticket of report.tickets) {
		if (ticket.key !== null) {
			local.set(ticket.key.toLowerCase(), nodeId(report.name, ticket.key));
		}
	}
	const edges: { from: string; to: string }[] = [];
	for (const ticket of report.tickets) {
		if (ticket.key === null) {
			continue;
		}
		const target = nodeId(report.name, ticket.key);
		for (const key of ticket.blockers) {
			const source = local.get(key.toLowerCase());
			if (source !== undefined && source !== target) {
				edges.push({ from: source, to: target });
			}
		}
		for (const blocker of ticket.outsideBlockers ?? []) {
			edges.push({
				from: nodeId(blocker.project, blocker.key),
				to: target,
			});
		}
		for (const blocked of ticket.blocks ?? []) {
			if (blocked.project.toLowerCase() === report.name.toLowerCase()) {
				continue;
			}
			edges.push({
				from: target,
				to: nodeId(blocked.project, blocked.key),
			});
		}
	}
	return edges;
}

function groupId(name: string): string {
	return `group\n${name}`;
}

type TicketSize = { width: number; height: number };

function edgeRoute(
	edge: { source: string; target: string },
	bounds: Map<string, NodeBound>,
	horizontal: boolean,
): GraphRoute {
	const source = bounds.get(edge.source);
	const target = bounds.get(edge.target);
	if (horizontal) {
		return {
			sourceX: source?.right ?? 0,
			sourceY: source === undefined ? 0 : (source.top + source.bottom) / 2,
			targetX: target?.left ?? 0,
			targetY: target === undefined ? 0 : (target.top + target.bottom) / 2,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
	}
	return {
		sourceX: source === undefined ? 0 : (source.left + source.right) / 2,
		sourceY: source?.bottom ?? 0,
		targetX: target === undefined ? 0 : (target.left + target.right) / 2,
		targetY: target?.top ?? 0,
		sourcePosition: Position.Bottom,
		targetPosition: Position.Top,
	};
}

function clusterNodes(
	tickets: GraphTicket[],
	positions: Map<string, { x: number; y: number }>,
	ticketSizes: Map<string, TicketSize>,
	groupBy: GroupBy,
	assignees: readonly string[],
	fallback: TicketSize,
): FlowNode<ClusterNodeData, "cluster">[] {
	if (groupBy === "none") {
		return [];
	}
	const groups = new Map<
		string,
		{ label: string; places: { x: number; y: number; size: TicketSize }[] }
	>();
	for (const ticket of tickets) {
		const key = ticket.ticket.key;
		if (key === null || ticket.outside) {
			continue;
		}
		const name = graphBand(ticket, groupBy, assignees);
		const id = nodeId(ticket.project, key);
		const place = positions.get(id);
		const size = ticketSizes.get(id) ?? fallback;
		if (place === undefined || name === "") {
			continue;
		}
		const label = groupLabelOf(ticket.ticket, groupBy, name);
		const known = groups.get(name) ?? { label, places: [] };
		known.places.push({ x: place.x, y: place.y, size });
		groups.set(name, known);
	}
	return [...groups.entries()]
		.sort((left, right) => left[1].label.localeCompare(right[1].label))
		.map(([name, group]) => {
			const places = group.places;
			const left = Math.min(...places.map((place) => place.x));
			const top = Math.min(...places.map((place) => place.y));
			const right = Math.max(
				...places.map((place) => place.x + place.size.width),
			);
			const bottom = Math.max(
				...places.map((place) => place.y + place.size.height),
			);
			const width = right - left + groupPad * 2;
			const height = bottom - top + groupHead + groupPad;
			return {
				id: groupId(name),
				type: "cluster" as const,
				position: { x: left - groupPad, y: top - groupHead },
				width,
				height,
				style: { width, height },
				data: { name, label: group.label },
				zIndex: -1,
				draggable: false,
				selectable: false,
			};
		});
}

export function graphModel(
	report: ProjectReport,
	reports: ProjectReport[],
	direction: GraphDirection,
	groupBy: GroupBy,
	assignees: readonly string[],
	openKey: string | null,
	ticketSizes: Map<string, TicketSize>,
	fallback: TicketSize,
): {
	nodes: ProjectNode[];
	edges: FlowEdge<TicketEdgeData>[];
} {
	const tickets = [...outsideTickets(report, reports), ...localTickets(report)];
	const links = graphEdges(report);
	const positions = layoutTickets(
		tickets,
		links,
		direction,
		groupBy,
		assignees,
	);
	const horizontal = direction === "left-to-right";
	const groups = clusterNodes(
		tickets,
		positions,
		ticketSizes,
		groupBy,
		assignees,
		fallback,
	);
	const nodes = tickets.flatMap((item) => {
		const key = item.ticket.key;
		if (key === null) {
			return [];
		}
		const id = nodeId(item.project, key);
		const place = positions.get(id) ?? { x: 0, y: 0 };
		const node: FlowNode<TicketNodeData, "ticket"> = sizedNode(
			{
				id,
				type: "ticket",
				position: place,
				sourcePosition: horizontal ? Position.Right : Position.Bottom,
				targetPosition: horizontal ? Position.Left : Position.Top,
				data: {
					ticket: item.ticket,
					outside: item.outside,
					project: item.project,
					tracker: item.tracker,
					open: openKey === key,
				},
			},
			ticketSizes.get(id) ?? fallback,
		);
		return [node];
	});
	const fromHandle = horizontal ? "right" : "bottom";
	const toHandle = horizontal ? "left" : "top";
	const marker = markerEnd(measureMarker(classToken(cards.graphMarker)));
	const pending = links.map((link) => ({
		id: `${link.from}->${link.to}`,
		source: link.from,
		target: link.to,
		sourceHandle: fromHandle,
		targetHandle: toHandle,
		type: "ticket" as const,
		markerEnd: marker,
	}));
	const bounds = new Map(
		nodes.flatMap((node) => {
			if (isClusterNode(node)) {
				return [];
			}
			const size = ticketSizes.get(node.id) ?? fallback;
			const x = node.position.x;
			const y = node.position.y;
			return [
				[
					node.id,
					{
						left: x,
						top: y,
						right: x + size.width,
						bottom: y + size.height,
					},
				] as const,
			];
		}),
	);
	const laned = assignLanes(pending).map((edge) => {
		const nodesForEdge = [...bounds.entries()].flatMap(([id, bound]) =>
			id === edge.source || id === edge.target ? [] : [bound],
		);
		return { edge, nodesForEdge };
	});
	const side = horizontal ? fallback.height : fallback.width;
	const spots = labelSpots(
		laned.map(({ edge, nodesForEdge }) => ({
			route: edgeRoute(edge, bounds, horizontal),
			lane: edge.data.lane,
			lanes: edge.data.lanes,
			entry: edge.data.entry,
			entries: edge.data.entries,
			nodes: nodesForEdge,
			side,
		})),
	);
	const edges = laned.map(({ edge, nodesForEdge }, index) => ({
		...edge,
		data: {
			...edge.data,
			nodes: nodesForEdge,
			label: spots[index] ?? { x: 0, y: 0 },
			side,
		},
	}));
	return {
		nodes: [...groups, ...nodes],
		edges,
	};
}

function Legend() {
	return (
		<Panel position="top-left">
			<section
				className={clsx(board.legendBox)}
				aria-label={projectGraphLabel.legend}
			>
				<ul className={clsx(board.legendRow)}>
					{legendOrder.map((state) => (
						<li key={state} className={clsx(board.legendItem)}>
							<span className={clsx(board.legendDot, legendTone[state])} />
							{stateTone[state].label}
						</li>
					))}
				</ul>
				<p className={clsx(board.legendNote)}>{projectGraphLabel.arrow}</p>
				<p className={clsx(board.legendNote)}>{projectGraphLabel.dashed}</p>
			</section>
		</Panel>
	);
}

function FitDirection() {
	const flow = useReactFlow();
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			void flow.fitView({ padding: 0.28 });
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
	onOpen,
}: {
	report: ProjectReport;
	reports: ProjectReport[];
	direction: GraphDirection;
	groupBy: GroupBy;
	assignees: readonly string[];
	openKey: string | null;
	onOpen: (ticket: OpenedNode) => void;
}) {
	return (
		<ReactFlowProvider>
			<SizedProjectGraph
				report={report}
				reports={reports}
				direction={direction}
				groupBy={groupBy}
				assignees={assignees}
				openKey={openKey}
				onOpen={onOpen}
			/>
		</ReactFlowProvider>
	);
}

function SizedProjectGraph({
	report,
	reports,
	direction,
	groupBy,
	assignees,
	openKey,
	onOpen,
}: {
	report: ProjectReport;
	reports: ProjectReport[];
	direction: GraphDirection;
	groupBy: GroupBy;
	assignees: readonly string[];
	openKey: string | null;
	onOpen: (ticket: OpenedNode) => void;
}) {
	const span = useNodeSpan(board.ticketNode, "ticket", "Ticket");
	const model = useMemo(() => {
		if (span === null) {
			return null;
		}
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
	}, [report, reports, direction, groupBy, assignees, openKey, span]);
	if (model === null) {
		return <div id="project-graph" className={clsx(board.ticketGraph)} />;
	}
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
			<p id="project-graph-places" className={clsx(cards.graphProbe)}>
				{places}
			</p>
			<p id="project-graph-direction" className={clsx(cards.graphProbe)}>
				{direction}
			</p>
			<p id="project-graph-outside" className={clsx(cards.graphProbe)}>
				{outsideLabels.join(" | ")}
			</p>

			<ReactFlow
				key={direction}
				nodes={model.nodes}
				edges={model.edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				panOnDrag
				fitView
				fitViewOptions={{ padding: 0.28 }}
				proOptions={{ hideAttribution: true }}
				onNodeClick={(_event, node) => {
					if (isClusterNode(node)) {
						return;
					}
					onOpen({
						key: node.data.ticket.key ?? node.data.ticket.title,
						project: node.data.project,
						tracker: node.data.tracker,
						title: node.data.ticket.title,
						outside: node.data.outside,
						...(node.data.ticket.state === undefined
							? {}
							: { state: node.data.ticket.state }),
					});
				}}
			>
				<Background variant={BackgroundVariant.Dots} gap={18} />
				<FitDirection key={direction} />
				<Legend />
			</ReactFlow>
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
