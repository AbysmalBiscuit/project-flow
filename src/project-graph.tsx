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
import { flowGap, projectFlowPlaces } from "./graph-flow.ts";
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
import {
	graphDirectionLabel,
	navLabel,
	projectGraphLabel,
	stateLabel,
} from "./terms.ts";
import { classToken, clsx } from "./ui.ts";
import { board, cards } from "./ui-styles.ts";
import type { GraphDirection, GroupBy } from "./view-settings.ts";
import { graphDirections } from "./view-settings.ts";

const columnGap = flowGap.along;
const groupPad = 16;
const groupHead = 28;
const fitPadding = "24px";

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

function TicketNode({ data }: NodeProps<FlowNode<TicketNodeData>>) {
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
			data-outside={data.outside ? "true" : "false"}
			data-state={known ?? "unknown"}
			aria-pressed={data.open}
		>
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

function layoutTickets(
	report: ProjectReport,
	direction: GraphDirection,
	groupBy: GroupBy,
	assignees: readonly string[],
): Map<string, { x: number; y: number }> {
	const placed = projectFlowPlaces(report, groupBy, assignees);
	const positions = new Map<string, { x: number; y: number }>();
	const turned = (place: { x: number; y: number }) =>
		direction === "top-to-bottom"
			? {
					x: (place.y / flowGap.across) * flowGap.along,
					y: (place.x / flowGap.along) * flowGap.across,
				}
			: place;
	if (groupBy === "none") {
		for (const [id, place] of placed) {
			positions.set(id, turned(place));
		}
		return positions;
	}
	const byBand = new Map<string, { id: string; x: number; y: number }[]>();
	for (const [id, place] of placed) {
		const members = byBand.get(place.band) ?? [];
		members.push({ id, x: place.x, y: place.y });
		byBand.set(place.band, members);
	}
	const bands = [...byBand.keys()].sort((left, right) =>
		left.localeCompare(right),
	);
	let origin = 0;
	for (const band of bands) {
		const members = byBand.get(band) ?? [];
		const minX = Math.min(...members.map((member) => member.x));
		const minY = Math.min(...members.map((member) => member.y));
		const maxX = Math.max(...members.map((member) => member.x));
		const maxY = Math.max(...members.map((member) => member.y));
		for (const member of members) {
			const along = member.x - minX;
			const across = member.y - minY;
			positions.set(
				member.id,
				turned(
					direction === "top-to-bottom"
						? { x: across + origin, y: along }
						: { x: along + origin, y: across },
				),
			);
		}
		const span = direction === "top-to-bottom" ? maxY - minY : maxX - minX;
		origin += span + columnGap + groupPad * 2;
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

function nodeSpan(): TicketSize {
	const probe = document.createElement("span");
	probe.className = classToken(board.ticketNode);
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	document.body.append(probe);
	const box = probe.getBoundingClientRect();
	probe.remove();
	return { width: box.width, height: box.height };
}

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
		const size = ticketSizes.get(id) ?? nodeSpan();
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
): {
	nodes: ProjectNode[];
	edges: FlowEdge<TicketEdgeData>[];
} {
	const tickets = [...outsideTickets(report, reports), ...localTickets(report)];
	const links = graphEdges(report);
	const positions = layoutTickets(report, direction, groupBy, assignees);
	const horizontal = direction === "left-to-right";
	const groups = clusterNodes(
		tickets,
		positions,
		ticketSizes,
		groupBy,
		assignees,
	);
	const nodes = tickets.flatMap((item) => {
		const key = item.ticket.key;
		if (key === null) {
			return [];
		}
		const id = nodeId(item.project, key);
		const place = positions.get(id) ?? { x: 0, y: 0 };
		const node: FlowNode<TicketNodeData, "ticket"> = {
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
		};
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
	const span = nodeSpan();
	const bounds = new Map(
		nodes.flatMap((node) => {
			if (isClusterNode(node)) {
				return [];
			}
			const size = ticketSizes.get(node.id) ?? span;
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
	const side = horizontal ? span.height : span.width;
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
	);
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
	const model = useMemo(
		() =>
			graphModel(
				report,
				reports,
				direction,
				groupBy,
				assignees,
				openKey,
				new Map(),
			),
		[report, reports, direction, groupBy, assignees, openKey],
	);
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
			<Legend />
			<div className={clsx(board.graphPane)}>
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
					fitViewOptions={{
						padding: fitPadding,
						maxZoom: 1,
					}}
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
					<GraphTools
						probeId="project-graph-viewport"
						fitId="project-graph-fit"
						scope="#project-graph"
					/>
				</ReactFlow>
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
		<fieldset className={clsx(board.direction)}>
			<legend className={clsx(cards.graphProbe)}>Graph direction</legend>
			{graphDirections.map((item) => (
				<button
					key={item}
					type="button"
					id={`graph-direction-${item}`}
					className={clsx(
						board.directionButton,
						direction === item && board.directionOn,
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
