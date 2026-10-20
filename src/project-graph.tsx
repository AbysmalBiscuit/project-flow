import {
	Background,
	BackgroundVariant,
	BaseEdge,
	type Edge as FlowEdge,
	type Node as FlowNode,
	getSmoothStepPath,
	Handle,
	MarkerType,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
} from "@xyflow/react";
import { useMemo } from "react";
import {
	groupKeysOf,
	outsideKey,
	type ProjectReport,
	type TicketState,
} from "./domain.ts";
import { columnDepth, GraphTools } from "./graph-pane.tsx";
import {
	graphDirectionLabel,
	navLabel,
	projectGraphLabel,
	stateLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { board, cards } from "./ui-styles.ts";
import type { GraphDirection, GroupBy } from "./view-settings.ts";
import { graphDirections } from "./view-settings.ts";

const columnGap = 280;
const rowGap = 120;

type GraphTicketView = {
	key: string | null;
	title: string;
	state?: TicketState;
	pull?: string;
	needsYou?: boolean;
	workstream?: string;
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

type TicketEdgeData = Record<string, never>;

function nodeKey(key: string, project: string, outside: boolean): string {
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
		<p className={clsx(board.cluster)} data-group={data.name}>
			{data.name}
		</p>
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
					{nodeKey(key, data.project, data.outside)}
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
}: {
	id: string;
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
}) {
	const [path] = getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		borderRadius: 0,
	});
	return <BaseEdge id={id} path={path} />;
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

function outsideTickets(
	report: ProjectReport,
	reports: ProjectReport[],
): GraphTicket[] {
	const seen = new Set<string>();
	const found: GraphTicket[] = [];
	for (const ticket of report.tickets) {
		for (const blocker of ticket.outsideBlockers ?? []) {
			const id = nodeId(blocker.project, blocker.key);
			if (seen.has(id)) {
				continue;
			}
			seen.add(id);
			const state = outsideState(reports, blocker.project, blocker.key);
			found.push({
				ticket: {
					key: blocker.key,
					title: blocker.title,
					...(state === undefined ? {} : { state }),
				},
				project: blocker.project,
				tracker: blocker.tracker,
				outside: true,
			});
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
	const depth = columnDepth(
		tickets.flatMap((ticket) =>
			ticket.ticket.key === null
				? []
				: [nodeId(ticket.project, ticket.ticket.key)],
		),
		incoming,
	);
	const columns = new Map<number, string[]>();
	const ordered = [...tickets].sort((left, right) =>
		`${left.ticket.key ?? left.ticket.title}`.localeCompare(
			`${right.ticket.key ?? right.ticket.title}`,
		),
	);
	for (const ticket of ordered) {
		const key = ticket.ticket.key;
		if (key === null) {
			continue;
		}
		const id = nodeId(ticket.project, key);
		const column = depth.get(id) ?? 0;
		const names = columns.get(column) ?? [];
		names.push(id);
		columns.set(column, names);
	}
	if (groupBy === "none") {
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
	const columnCounts = new Map<string, number>();
	for (const ticket of ordered) {
		const key = ticket.ticket.key;
		if (key === null) {
			continue;
		}
		const name = graphBand(ticket, groupBy, assignees);
		const column = depth.get(nodeId(ticket.project, key)) ?? 0;
		const slot = `${name}\n${column}`;
		columnCounts.set(slot, (columnCounts.get(slot) ?? 0) + 1);
	}
	const bandGap = direction === "top-to-bottom" ? columnGap : rowGap;
	const bandSize = new Map<string, number>();
	for (const name of groups) {
		let largest = 1;
		for (const [slot, count] of columnCounts) {
			if (slot.startsWith(`${name}\n`)) {
				largest = Math.max(largest, count);
			}
		}
		bandSize.set(name, largest * bandGap);
	}
	const bandStart = new Map<string, number>();
	let cursor = 0;
	for (const name of groups) {
		bandStart.set(name, cursor);
		cursor += bandSize.get(name) ?? bandGap;
	}
	const positions = new Map<string, { x: number; y: number }>();
	for (const [column, names] of columns) {
		const row = new Map<string, number>();
		names.forEach((id) => {
			const ticket = tickets.find(
				(item) =>
					item.ticket.key !== null &&
					nodeId(item.project, item.ticket.key) === id,
			);
			const name =
				ticket === undefined ? "" : graphBand(ticket, groupBy, assignees);
			const index = row.get(name) ?? 0;
			row.set(name, index + 1);
			const shift = bandStart.get(name) ?? 0;
			positions.set(
				id,
				direction === "top-to-bottom"
					? { x: index * columnGap + shift, y: column * rowGap }
					: { x: column * columnGap, y: index * rowGap + shift },
			);
		});
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
	}
	return edges;
}

function clusterNodes(
	tickets: GraphTicket[],
	positions: Map<string, { x: number; y: number }>,
	groupBy: GroupBy,
	assignees: readonly string[],
): FlowNode<ClusterNodeData, "cluster">[] {
	if (groupBy === "none") {
		return [];
	}
	const groups = new Map<string, { x: number; y: number }>();
	for (const ticket of tickets) {
		const key = ticket.ticket.key;
		if (key === null || ticket.outside) {
			continue;
		}
		const name = graphBand(ticket, groupBy, assignees);
		const place = positions.get(nodeId(ticket.project, key));
		if (place === undefined || name === "") {
			continue;
		}
		const known = groups.get(name);
		if (
			known === undefined ||
			place.x < known.x ||
			(place.x === known.x && place.y < known.y)
		) {
			groups.set(name, place);
		}
	}
	return [...groups.entries()]
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([name, place]) => ({
			id: `group\n${name}`,
			type: "cluster",
			position: { x: place.x, y: place.y - 28 },
			data: { name },
			draggable: false,
			selectable: false,
		}));
}

function graphModel(
	report: ProjectReport,
	reports: ProjectReport[],
	direction: GraphDirection,
	groupBy: GroupBy,
	assignees: readonly string[],
	openKey: string | null,
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
	const nodes = tickets.flatMap((item) => {
		const key = item.ticket.key;
		if (key === null) {
			return [];
		}
		const id = nodeId(item.project, key);
		const node: FlowNode<TicketNodeData, "ticket"> = {
			id,
			type: "ticket",
			position: positions.get(id) ?? { x: 0, y: 0 },
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
	const edges = links.map((link) => ({
		id: `${link.from}->${link.to}`,
		source: link.from,
		target: link.to,
		sourceHandle: horizontal ? "right" : "bottom",
		targetHandle: horizontal ? "left" : "top",
		type: "ticket",
		markerEnd: { type: MarkerType.ArrowClosed },
		data: {},
	}));
	return {
		nodes: [...clusterNodes(tickets, positions, groupBy, assignees), ...nodes],
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
						<span className={clsx(board.legendDot, stateTone[state].tone)} />
						{stateTone[state].label}
					</li>
				))}
			</ul>
			<p className={clsx(board.legendNote)}>{projectGraphLabel.arrow}</p>
			<p className={clsx(board.legendNote)}>{projectGraphLabel.dashed}</p>
		</section>
	);
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
	const model = useMemo(
		() => graphModel(report, reports, direction, groupBy, assignees, openKey),
		[report, reports, direction, groupBy, assignees, openKey],
	);
	const places = model.nodes
		.map(
			(node) =>
				`${node.id.replaceAll("\n", " ")} ${node.position.x},${node.position.y}`,
		)
		.join(" | ");
	const outsideLabels = model.nodes.flatMap((node) =>
		isClusterNode(node) || !node.data.outside
			? []
			: [nodeKey(node.data.ticket.key ?? "", node.data.project, true)],
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
			<ReactFlowProvider>
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
					<Legend />
					<GraphTools
						probeId="project-graph-viewport"
						fitId="project-graph-fit"
						scope="#project-graph"
					/>
				</ReactFlow>
			</ReactFlowProvider>
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
