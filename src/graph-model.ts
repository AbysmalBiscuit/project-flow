import {
	type Edge as FlowEdge,
	type Node as FlowNode,
	Position,
} from "@xyflow/react";
import { board } from "./board-styles.ts";
import {
	groupLabelOf,
	type ProjectReport,
	type TicketState,
} from "./domain.ts";
import {
	type FlowTicket,
	flowGap,
	graphBand,
	graphEdges,
	graphTickets,
	projectFlowPlaces,
	projectNodeId,
} from "./graph-flow.ts";
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

const columnGap = flowGap.along;
const groupPad = 16;
const groupHead = 28;

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
};

export type TicketNodeData = {
	ticket: GraphTicketView;
	outside: boolean;
	project: string;
	tracker: "github" | "linear";
	open: boolean;
};

export type ClusterNodeData = {
	name: string;
	label: string;
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
};

type GraphTicket = {
	flow: FlowTicket;
	ticket: GraphTicketView;
	project: string;
	tracker: "github" | "linear";
	outside: boolean;
};

function ticketView(ticket: FlowTicket, reports: ProjectReport[]): GraphTicket {
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
	return graphTickets(report).map((ticket) => ticketView(ticket, reports));
}

function layoutTickets(
	report: ProjectReport,
	direction: GraphDirection,
	groupBy: GroupBy,
	assignees: readonly string[],
): Map<string, { x: number; y: number }> {
	const placed = projectFlowPlaces(report, groupBy, assignees);
	const positions = new Map<string, { x: number; y: number }>();
	const local = (place: { x: number; row: number }) => ({
		x: place.x,
		y: place.row * flowGap.across,
	});
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
		const home = local(place);
		members.push({ id, x: home.x, y: home.y });
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
		const shifted = members.map((member) =>
			turned({ x: member.x - minX, y: member.y - minY }),
		);
		for (const [index, member] of members.entries()) {
			const place = shifted[index] ?? { x: 0, y: 0 };
			positions.set(member.id, {
				x: place.x + origin,
				y: place.y,
			});
		}
		const span = Math.max(...shifted.map((place) => place.x));
		origin += span + columnGap + groupPad * 2;
	}
	return positions;
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

function headGrowth(label: string, width: number): number {
	return Math.max(0, labelHeight(label, width) - labelHeight("\u00a0", width));
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
		const name = graphBand(ticket.flow, groupBy, assignees);
		const id = projectNodeId(ticket.project, key);
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
			const head = groupHead + headGrowth(group.label, width);
			const height = bottom - top + head + groupPad;
			return {
				id: groupId(name),
				type: "cluster" as const,
				position: { x: left - groupPad, y: top - head },
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
	const tickets = shownTickets(report, reports);
	const links = graphEdges(report);
	const positions = layoutTickets(report, direction, groupBy, assignees);
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
		const id = projectNodeId(item.project, key);
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
