import {
	type Edge as FlowEdge,
	type Node as FlowNode,
	Position,
} from "@xyflow/react";
import { board } from "./board-styles.ts";
import { type ProjectReport, parentChip, type TicketState } from "./domain.ts";
import {
	type FlowTicket,
	graphEdges,
	graphTickets,
	projectNodeId,
} from "./graph-flow.ts";
import type { GraphLayout, LayoutInput } from "./graph-layout.ts";
import {
	assignLanes,
	type GraphRoute,
	labelSpots,
	markerEnd,
	measureMarker,
	type NodeBound,
} from "./graph-routes.ts";
import { sizedNode } from "./graph-sizes.ts";
import { classToken } from "./ui.ts";
import { cards } from "./ui-styles.ts";
import type { GraphDirection, GroupBy } from "./view-settings.ts";

export type GraphTicketView = {
	key: string | null;
	title: string;
	state?: TicketState;
	pull?: string;
	needsYou?: boolean;
	workstream?: string;
	workstreamKey?: string;
	themeGroup?: string;
	assignees?: string[];
	parentLabel?: string;
	subTickets?: number;
};

export type TicketNodeData = {
	ticket: GraphTicketView;
	outside: boolean;
	project: string;
	tracker: "github" | "linear";
	open: boolean;
	/** A flat grouping shows the parent ticket hierarchy as chips. */
	hierarchyChips: boolean;
};

export type ClusterNodeData = {
	label: string;
	members: string[];
};

export type ProjectNodeData = TicketNodeData | ClusterNodeData;

export type ProjectNode =
	| FlowNode<TicketNodeData, "ticket">
	| FlowNode<ClusterNodeData, "cluster">;

export function isClusterNode(
	node: FlowNode<ProjectNodeData>,
): node is FlowNode<ClusterNodeData, "cluster"> {
	return node.type === "cluster";
}

export type TicketEdgeData = {
	lane: number;
	lanes: number;
	entry: number;
	entries: number;
	nodes: NodeBound[];
	label: { x: number; y: number };
	side: number;
	done: boolean;
	flowing?: boolean;
};

type GraphTicket = {
	flow: FlowTicket;
	ticket: GraphTicketView;
	project: string;
	tracker: "github" | "linear";
	outside: boolean;
};

function ticketView(
	ticket: FlowTicket,
	report: ProjectReport,
	reports: ProjectReport[],
): GraphTicket {
	const home = reports.find(
		(report) => report.name.toLowerCase() === ticket.project.toLowerCase(),
	);
	const known = home?.tickets.find(
		(item) => item.key?.toLowerCase() === ticket.key.toLowerCase(),
	);
	const state = ticket.state;
	return {
		flow: ticket,
		ticket: {
			key: ticket.key,
			title: ticket.title,
			...(state === undefined ? {} : { state }),
			...(known?.pull === undefined ? {} : { pull: known.pull }),
			...(known?.needsYou === undefined ? {} : { needsYou: known.needsYou }),
			...(ticket.parent === undefined
				? {}
				: {
						parentLabel: parentChip(report.outsideParents, ticket.parent).label,
					}),
			...(ticket.subTickets === undefined
				? {}
				: { subTickets: ticket.subTickets }),
			...(ticket.workstream === undefined
				? {}
				: { workstream: ticket.workstream }),
			...(ticket.workstreamKey === undefined
				? {}
				: { workstreamKey: ticket.workstreamKey }),
			...(ticket.themeGroup === undefined
				? {}
				: { themeGroup: ticket.themeGroup }),
			...(ticket.assignees === undefined
				? {}
				: { assignees: ticket.assignees }),
		},
		project: ticket.project,
		tracker: ticket.tracker ?? home?.tracker ?? "github",
		outside: ticket.outside,
	};
}

function shownTickets(
	report: ProjectReport,
	reports: ProjectReport[],
): GraphTicket[] {
	return graphTickets(report).map((ticket) =>
		ticketView(ticket, report, reports),
	);
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

function labelHeight(label: string, width: number): number {
	const probe = document.createElement("div");
	probe.className = classToken(board.cluster);
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.style.width = `${width}px`;
	probe.style.height = "auto";
	probe.textContent = label;
	document.body.append(probe);
	const height = probe.getBoundingClientRect().height;
	probe.remove();
	return height;
}

/** The extra height of a group label that wraps at the frame width. */
export function headGrowth(label: string, width: number): number {
	return Math.max(0, labelHeight(label, width) - labelHeight("\u00a0", width));
}

function clusterNodes(
	input: LayoutInput,
	layout: GraphLayout,
): FlowNode<ClusterNodeData, "cluster">[] {
	return input.groups.flatMap((group) => {
		const frame = layout.groups.get(group.id);
		if (frame === undefined) {
			return [];
		}
		return [
			{
				id: group.id,
				type: "cluster" as const,
				position: { x: frame.x, y: frame.y },
				width: frame.width,
				height: frame.height,
				style: { width: frame.width, height: frame.height },
				data: {
					label: group.label,
					members: input.cards.flatMap((card) =>
						card.group === group.id ? [card.id] : [],
					),
				},
				zIndex: -1,
				draggable: false,
				selectable: false,
			},
		];
	});
}

export function graphModel(
	report: ProjectReport,
	reports: ProjectReport[],
	direction: GraphDirection,
	groupBy: GroupBy,
	openKey: string | null,
	input: LayoutInput,
	layout: GraphLayout,
	ticketSizes: Map<string, TicketSize>,
	fallback: TicketSize,
): {
	nodes: ProjectNode[];
	edges: FlowEdge<TicketEdgeData>[];
} {
	const tickets = shownTickets(report, reports);
	const links = graphEdges(report);
	const horizontal = direction === "left-to-right";
	const groups = clusterNodes(input, layout);
	const nodes = tickets.flatMap((item) => {
		const key = item.ticket.key;
		if (key === null) {
			return [];
		}
		const id = projectNodeId(item.project, key);
		const place = layout.cards.get(id) ?? { x: 0, y: 0 };
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
					hierarchyChips: groupBy === "assignee" || groupBy === "none",
				},
			},
			ticketSizes.get(id) ?? fallback,
		);
		return [node];
	});
	const fromHandle = horizontal ? "right" : "bottom";
	const toHandle = horizontal ? "left" : "top";
	const solid = measureMarker(classToken(cards.graphMarker));
	const done = measureMarker(classToken(board.graphDoneMarker));
	const solidMarker = markerEnd(solid.size, solid.color);
	const doneMarker = markerEnd(done.size, done.color);
	const pending = links.map((link) => {
		const closed = link.done === true;
		return {
			id: `${link.from}->${link.to}`,
			source: link.from,
			target: link.to,
			sourceHandle: fromHandle,
			targetHandle: toHandle,
			type: "ticket" as const,
			markerEnd: closed ? doneMarker : solidMarker,
			...(closed ? { className: classToken(board.graphEdgeDone) } : {}),
			data: { done: closed },
		};
	});
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
