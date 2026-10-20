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
	useReactFlow,
	type Viewport,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { GraphDirection } from "./view-settings.ts";
import { graphDirections } from "./view-settings.ts";
import type { ProjectReport, TicketView } from "./domain.ts";
import {
	graphDirectionLabel,
	navLabel,
	overviewControlLabel,
	projectGraphLabel,
	stateLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { board, cards } from "./ui-styles.ts";

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

function tone(ticket: TicketView) {
	const type = ticket.statusType ?? ticket.state;
	if (type === "done") {
		return board.ticketDone;
	}
	if (type === "dropped") {
		return board.ticketDropped;
	}
	if (type === "inProgress") {
		return board.ticketProgress;
	}
	if (type === "inReview") {
		return board.ticketReview;
	}
	if (type === "awaitingMerge") {
		return board.ticketMerge;
	}
	return board.ticketReady;
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
			onClick={() => {
				data.onOpen({
					key,
					project: data.project,
					tracker: data.tracker,
					title: data.ticket.title,
					outside: data.outside,
				});
			}}
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

function depthOf(
	tickets: GraphTicket[],
	incoming: Map<string, string[]>,
): Map<string, number> {
	const depth = new Map<string, number>();
	const visit = (id: string, seen: Set<string>): number => {
		const known = depth.get(id);
		if (known !== undefined) {
			return known;
		}
		if (seen.has(id)) {
			return 0;
		}
		seen.add(id);
		const sources = incoming.get(id) ?? [];
		const next =
			sources.length === 0
				? 0
				: Math.max(...sources.map((source) => visit(source, seen))) + 1;
		depth.set(id, next);
		return next;
	};
	for (const ticket of tickets) {
		const key = ticket.ticket.key;
		if (key !== null) {
			visit(nodeId(ticket.project, key), new Set());
		}
	}
	return depth;
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
	const depth = depthOf(tickets, incoming);
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

function readViewport(): Viewport | null {
	const pane = document.querySelector("#project-graph .react-flow__viewport");
	if (!(pane instanceof HTMLElement)) {
		return null;
	}
	const transform = pane.style.transform;
	const shift = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(transform);
	const scale = /scale\(([^)]+)\)/.exec(transform)?.[1];
	const x = shift?.[1];
	const y = shift?.[2];
	if (scale === undefined || x === undefined || y === undefined) {
		return null;
	}
	return {
		x: Math.round(Number(x)),
		y: Math.round(Number(y)),
		zoom: Math.round(Number(scale) * 1000) / 1000,
	};
}

function GraphTools() {
	const flow = useReactFlow();
	const [viewport, setViewport] = useState<Viewport | null>(null);
	useEffect(() => {
		let stopped = false;
		let frames = 0;
		const tick = () => {
			if (stopped) {
				return;
			}
			frames += 1;
			const next = readViewport();
			if (next === null && frames < 40) {
				requestAnimationFrame(tick);
				return;
			}
			setViewport(next);
		};
		const frame = requestAnimationFrame(tick);
		return () => {
			stopped = true;
			cancelAnimationFrame(frame);
		};
	}, []);
	const show = () => {
		setViewport(readViewport());
	};
	return (
		<div className={clsx(cards.graphTools)}>
			<button
				type="button"
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.zoomOut}
				onClick={() => {
					void flow.zoomOut().then(show);
				}}
			>
				−
			</button>
			<button
				type="button"
				id="project-graph-fit"
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.fit}
				onClick={() => {
					void flow.fitView().then(show);
				}}
			>
				{overviewControlLabel.fit}
			</button>
			<button
				type="button"
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.zoomIn}
				onClick={() => {
					void flow.zoomIn().then(show);
				}}
			>
				+
			</button>
			<p id="project-graph-viewport" className={clsx(cards.graphProbe)}>
				{viewport === null
					? ""
					: `zoom ${viewport.zoom} at ${viewport.x},${viewport.y}`}
			</p>
		</div>
	);
}

const legendTones = [
	{ label: projectGraphLabel.ready, tone: board.ticketReady },
	{ label: stateLabel.inProgress, tone: board.ticketProgress },
	{ label: stateLabel.inReview, tone: board.ticketReview },
	{ label: stateLabel.awaitingMerge, tone: board.ticketMerge },
	{ label: stateLabel.done, tone: board.ticketDone },
] as const;

function Legend() {
	return (
		<section
			className={clsx(board.legendBox)}
			aria-label={projectGraphLabel.legend}
		>
			<ul className={clsx(board.legendRow)}>
				{legendTones.map((item) => (
					<li key={item.label} className={clsx(board.legendItem)}>
						<span className={clsx(board.legendDot, item.tone)} />
						{item.label}
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
				>
					<Background variant={BackgroundVariant.Dots} gap={18} />
					<Legend />
					<GraphTools />
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
