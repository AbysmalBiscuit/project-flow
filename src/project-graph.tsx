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
import type { ProjectReport, TicketState, TicketView } from "./domain.ts";
import { columnDepth, GraphTools } from "./graph-pane.tsx";
import {
	graphDirectionLabel,
	navLabel,
	projectGraphLabel,
	stateLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { board, cards } from "./ui-styles.ts";
import type { GraphDirection } from "./view-settings.ts";
import { graphDirections } from "./view-settings.ts";

const columnGap = 280;
const rowGap = 120;

type TicketNodeData = {
	ticket: TicketView;
	outside: boolean;
	project: string;
	tracker: "github" | "linear";
	open: boolean;
	onOpen: (ticket: OpenedNode) => void;
};

export type OpenedNode = {
	key: string;
	project: string;
	tracker: "github" | "linear";
	title: string;
	outside: boolean;
};

type TicketEdgeData = Record<string, never>;

function shortKey(key: string): string {
	const mark = key.lastIndexOf("#");
	return mark === -1 ? key : key.slice(mark);
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

function tone(ticket: TicketView) {
	return stateTone[ticket.state].tone;
}

function TicketNode({ data }: NodeProps<FlowNode<TicketNodeData>>) {
	const key = data.ticket.key ?? data.ticket.title;
	return (
		<button
			type="button"
			className={clsx(
				board.ticketNode,
				tone(data.ticket),
				data.outside && board.ticketOutside,
				data.open && board.ticketNodeOpen,
			)}
			data-graph-node={key}
			data-outside={data.outside ? "true" : "false"}
			aria-pressed={data.open}
		>
			<Handle type="target" position={Position.Left} id="left" />
			<Handle type="target" position={Position.Top} id="top" />
			<span className={clsx(board.meta)}>
				<span className={clsx(board.key)}>{shortKey(key)}</span>
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

const nodeTypes = { ticket: TicketNode };
const edgeTypes = { ticket: TicketEdge };

type GraphTicket = {
	ticket: TicketView;
	project: string;
	tracker: "github" | "linear";
	outside: boolean;
};

function outsideTickets(report: ProjectReport): GraphTicket[] {
	const seen = new Set<string>();
	const found: GraphTicket[] = [];
	for (const ticket of report.tickets) {
		for (const blocker of ticket.outsideBlockers ?? []) {
			const id = nodeId(blocker.project, blocker.key);
			if (seen.has(id)) {
				continue;
			}
			seen.add(id);
			found.push({
				ticket: {
					key: blocker.key,
					title: blocker.title,
					state: "backlog",
					blockers: [],
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

function layoutTickets(
	tickets: GraphTicket[],
	edges: { from: string; to: string }[],
	direction: GraphDirection,
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

function graphModel(
	report: ProjectReport,
	direction: GraphDirection,
	openKey: string | null,
	onOpen: (ticket: OpenedNode) => void,
): {
	nodes: FlowNode<TicketNodeData>[];
	edges: FlowEdge<TicketEdgeData>[];
} {
	const tickets = [...outsideTickets(report), ...localTickets(report)];
	const links = graphEdges(report);
	const positions = layoutTickets(tickets, links, direction);
	const horizontal = direction === "left-to-right";
	const nodes = tickets.flatMap((item) => {
		const key = item.ticket.key;
		if (key === null) {
			return [];
		}
		const id = nodeId(item.project, key);
		return [
			{
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
					onOpen,
				},
			},
		];
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
	return { nodes, edges };
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
	direction,
	openKey,
	onOpen,
}: {
	report: ProjectReport;
	direction: GraphDirection;
	openKey: string | null;
	onOpen: (ticket: OpenedNode) => void;
}) {
	const model = useMemo(
		() => graphModel(report, direction, openKey, onOpen),
		[report, direction, openKey, onOpen],
	);
	const places = model.nodes
		.map((node) => `${node.id}:${node.position.x},${node.position.y}`)
		.join(" ");
	return (
		<div id="project-graph" className={clsx(board.ticketGraph)}>
			<p id="project-graph-places" className={clsx(cards.graphProbe)}>
				{places}
			</p>
			<p id="project-graph-direction" className={clsx(cards.graphProbe)}>
				{direction}
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
						node.data.onOpen({
							key: node.data.ticket.key ?? node.data.ticket.title,
							project: node.data.project,
							tracker: node.data.tracker,
							title: node.data.ticket.title,
							outside: node.data.outside,
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
