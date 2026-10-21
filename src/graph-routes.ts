import { MarkerType, type Position } from "@xyflow/react";

export type GraphRoute = {
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
};

export type NodeBound = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

export type RoutedEdge = {
	path: string;
	labelX: number;
	labelY: number;
};

export type LabelSpot = NodeBound;

export type MarkerEnd = {
	type: MarkerType;
	width: number;
	height: number;
	markerUnits: "userSpaceOnUse";
	color?: string;
};

export function measureMarker(className: string): number {
	const probe = document.createElement("span");
	probe.className = className;
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	document.body.append(probe);
	const size = probe.getBoundingClientRect().width;
	probe.remove();
	return size;
}

export function markerEnd(size: number, color?: string): MarkerEnd {
	return {
		type: MarkerType.ArrowClosed,
		width: size,
		height: size,
		markerUnits: "userSpaceOnUse",
		...(color === undefined ? {} : { color }),
	};
}

const bend = 8;
const laneGap = 36;
const stub = 36;
const approach = 28;
const labelClearance = 28;
const channelGap = 18;

function sameAxis(route: GraphRoute): boolean {
	return (
		route.sourcePosition === route.targetPosition ||
		(route.sourcePosition === "left" && route.targetPosition === "right") ||
		(route.sourcePosition === "right" && route.targetPosition === "left") ||
		(route.sourcePosition === "top" && route.targetPosition === "bottom") ||
		(route.sourcePosition === "bottom" && route.targetPosition === "top")
	);
}

function horizontalRoute(route: GraphRoute): boolean {
	return route.sourcePosition === "left" || route.sourcePosition === "right";
}

function forward(route: GraphRoute): boolean {
	if (route.sourcePosition === "right") {
		return route.targetX >= route.sourceX;
	}
	if (route.sourcePosition === "left") {
		return route.targetX <= route.sourceX;
	}
	if (route.sourcePosition === "bottom") {
		return route.targetY >= route.sourceY;
	}
	return route.targetY <= route.sourceY;
}

function laneOf(index: number, count: number): number {
	return (index - (count - 1) / 2) * laneGap;
}

function point(x: number, y: number): string {
	return `${x} ${y}`;
}

function corner(
	fromX: number,
	fromY: number,
	x: number,
	y: number,
	toX: number,
	toY: number,
): string {
	const radius = Math.min(
		bend,
		Math.hypot(x - fromX, y - fromY) / 2,
		Math.hypot(toX - x, toY - y) / 2,
	);
	if (radius < 1) {
		return `L ${point(x, y)}`;
	}
	const intoX = x + Math.sign(fromX - x) * radius;
	const intoY = y + Math.sign(fromY - y) * radius;
	const outX = x + Math.sign(toX - x) * radius;
	const outY = y + Math.sign(toY - y) * radius;
	return `L ${point(intoX, intoY)} Q ${point(x, y)} ${point(outX, outY)}`;
}

function pathThrough(points: { x: number; y: number }[]): string {
	const first = points[0];
	if (first === undefined) {
		return "";
	}
	let path = `M ${point(first.x, first.y)}`;
	for (let index = 1; index < points.length - 1; index += 1) {
		const previous = points[index - 1];
		const current = points[index];
		const next = points[index + 1];
		if (previous === undefined || current === undefined || next === undefined) {
			continue;
		}
		path += ` ${corner(
			previous.x,
			previous.y,
			current.x,
			current.y,
			next.x,
			next.y,
		)}`;
	}
	const last = points[points.length - 1];
	if (last !== undefined) {
		path += ` L ${point(last.x, last.y)}`;
	}
	return path;
}

function hitsNode(
	from: { x: number; y: number },
	to: { x: number; y: number },
	node: NodeBound,
): boolean {
	const horizontal = from.y === to.y;
	const vertical = from.x === to.x;
	if (!horizontal && !vertical) {
		return false;
	}
	if (horizontal) {
		const left = Math.min(from.x, to.x);
		const right = Math.max(from.x, to.x);
		return (
			from.y > node.top &&
			from.y < node.bottom &&
			right > node.left &&
			left < node.right
		);
	}
	const top = Math.min(from.y, to.y);
	const bottom = Math.max(from.y, to.y);
	return (
		from.x > node.left &&
		from.x < node.right &&
		bottom > node.top &&
		top < node.bottom
	);
}

function segmentHits(
	from: { x: number; y: number },
	to: { x: number; y: number },
	nodes: NodeBound[],
): boolean {
	return nodes.some((node) => hitsNode(from, to, node));
}

function channelBlocked(
	horizontal: boolean,
	at: number,
	from: number,
	to: number,
	nodes: NodeBound[],
): boolean {
	const start = Math.min(from, to);
	const end = Math.max(from, to);
	return nodes.some((node) => {
		if (horizontal) {
			return (
				at > node.top &&
				at < node.bottom &&
				end > node.left &&
				start < node.right
			);
		}
		return (
			at > node.left && at < node.right && end > node.top && start < node.bottom
		);
	});
}

function clearChannel(
	horizontal: boolean,
	preferred: number,
	from: number,
	to: number,
	nodes: NodeBound[],
): number {
	const step = horizontal
		? Math.max(...nodes.map((node) => node.bottom - node.top), laneGap) +
			channelGap
		: Math.max(...nodes.map((node) => node.right - node.left), laneGap) +
			channelGap;
	for (let offset = 0; offset < 12; offset += 1) {
		const sign = offset % 2 === 0 ? 1 : -1;
		const rank = Math.ceil(offset / 2);
		const at = preferred + sign * rank * step;
		if (!channelBlocked(horizontal, at, from, to, nodes)) {
			return at;
		}
	}
	return preferred;
}

function targetEntry(
	route: GraphRoute,
	index: number,
	count: number,
	side: number,
): { x: number; y: number } {
	const room = Math.max(side - laneGap, 0);
	const step = count <= 1 ? 0 : Math.min(laneGap, room / (count - 1));
	const spread = (index - (count - 1) / 2) * step;
	if (route.targetPosition === "left" || route.targetPosition === "right") {
		return { x: route.targetX, y: route.targetY + spread };
	}
	return { x: route.targetX + spread, y: route.targetY };
}

function sourceExit(route: GraphRoute, lane: number): { x: number; y: number } {
	if (route.sourcePosition === "left" || route.sourcePosition === "right") {
		return { x: route.sourceX, y: route.sourceY + lane };
	}
	return { x: route.sourceX + lane, y: route.sourceY };
}

function routePoints(
	route: GraphRoute,
	lane: number,
	entryIndex: number,
	entries: number,
	nodes: NodeBound[],
	side: number,
): { x: number; y: number }[] {
	const horizontal = horizontalRoute(route);
	const sourceSign =
		route.sourcePosition === "right" || route.sourcePosition === "bottom"
			? 1
			: -1;
	const targetSign =
		route.targetPosition === "right" || route.targetPosition === "bottom"
			? 1
			: -1;
	const exit = sourceExit(route, lane);
	const entry = targetEntry(route, entryIndex, entries, side);
	const straight =
		horizontal && forward(route) && sameAxis(route)
			? [
					{ x: route.sourceX, y: route.sourceY },
					{ x: route.sourceX + approach, y: route.sourceY },
					{ x: route.sourceX + approach, y: exit.y },
					{ x: entry.x - approach, y: entry.y },
					{ x: entry.x, y: entry.y },
				]
			: !horizontal && forward(route) && sameAxis(route)
				? [
						{ x: route.sourceX, y: route.sourceY },
						{ x: route.sourceX, y: route.sourceY + approach },
						{ x: exit.x, y: route.sourceY + approach },
						{ x: entry.x, y: entry.y - approach },
						{ x: entry.x, y: entry.y },
					]
				: null;
	if (
		straight !== null &&
		!straight.some((pointAt, pointIndex) => {
			const next = straight[pointIndex + 1];
			return next !== undefined && segmentHits(pointAt, next, nodes);
		})
	) {
		return straight;
	}
	if (horizontal) {
		const leave = route.sourceX + sourceSign * stub;
		const arrive = route.targetX + targetSign * stub;
		const rail = clearChannel(
			true,
			(route.sourceY + route.targetY) / 2 + lane,
			leave,
			arrive,
			nodes,
		);
		return [
			{ x: route.sourceX, y: route.sourceY },
			{ x: leave, y: route.sourceY },
			{ x: leave, y: rail },
			{ x: arrive, y: rail },
			{ x: arrive, y: entry.y },
			{ x: entry.x, y: entry.y },
		];
	}
	const leave = route.sourceY + sourceSign * stub;
	const arrive = route.targetY + targetSign * stub;
	const rail = clearChannel(
		false,
		(route.sourceX + route.targetX) / 2 + lane,
		leave,
		arrive,
		nodes,
	);
	return [
		{ x: route.sourceX, y: route.sourceY },
		{ x: route.sourceX, y: leave },
		{ x: rail, y: leave },
		{ x: rail, y: arrive },
		{ x: entry.x, y: arrive },
		{ x: entry.x, y: entry.y },
	];
}

function labelCandidates(
	points: { x: number; y: number }[],
): { x: number; y: number }[] {
	const candidates: { x: number; y: number }[] = [];
	for (let index = 0; index < points.length - 1; index += 1) {
		const from = points[index];
		const to = points[index + 1];
		if (from === undefined || to === undefined) {
			continue;
		}
		const length = Math.hypot(to.x - from.x, to.y - from.y);
		if (length < labelClearance * 2) {
			continue;
		}
		candidates.push({
			x: from.x + (to.x - from.x) * 0.55,
			y: from.y + (to.y - from.y) * 0.55,
		});
	}
	const fallback = points[Math.floor(points.length / 2)] ??
		points[0] ?? { x: 0, y: 0 };
	if (candidates.length === 0) {
		candidates.push(fallback);
	}
	for (let step = 1; step <= 8; step += 1) {
		candidates.push({
			x: fallback.x,
			y: fallback.y + step * labelClearance * 2 * (step % 2 === 0 ? 1 : -1),
		});
	}
	return candidates;
}

export function labelSpots(
	routes: {
		route: GraphRoute;
		lane: number;
		lanes: number;
		entry: number;
		entries: number;
		nodes: NodeBound[];
		side: number;
	}[],
): { x: number; y: number }[] {
	const occupied: NodeBound[] = [];
	return routes.map((item) => {
		const points = routePoints(
			item.route,
			item.lane,
			item.entry,
			item.entries,
			item.nodes,
			item.side,
		);
		for (const candidate of labelCandidates(points)) {
			const box = labelBox(candidate);
			if (
				occupied.some((taken) => overlaps(box, taken)) ||
				item.nodes.some((node) => overlaps(box, node))
			) {
				continue;
			}
			occupied.push(box);
			return candidate;
		}
		const fallback = labelCandidates(points).at(-1) ?? { x: 0, y: 0 };
		for (let step = 1; step <= 24; step += 1) {
			const shifted = {
				x: fallback.x + step * labelClearance * 2,
				y: fallback.y,
			};
			const box = labelBox(shifted);
			if (occupied.some((taken) => overlaps(box, taken))) {
				continue;
			}
			occupied.push(box);
			return shifted;
		}
		occupied.push(labelBox(fallback));
		return fallback;
	});
}

function labelBox(at: { x: number; y: number }): NodeBound {
	return {
		left: at.x - labelClearance * 2,
		right: at.x + labelClearance * 2,
		top: at.y - labelClearance / 2,
		bottom: at.y + labelClearance / 2,
	};
}

function overlaps(left: NodeBound, right: NodeBound): boolean {
	return (
		left.left < right.right &&
		left.right > right.left &&
		left.top < right.bottom &&
		left.bottom > right.top
	);
}

export function routeEdge(
	route: GraphRoute,
	index: number,
	count: number,
	nodes: NodeBound[] = [],
	label: { x: number; y: number } = { x: 0, y: 0 },
	entry = index,
	entries = count,
	side = laneGap * 4,
): RoutedEdge {
	const points = routePoints(
		route,
		laneOf(index, count),
		entry,
		entries,
		nodes,
		side,
	);
	return {
		path: pathThrough(points),
		labelX: label.x,
		labelY: label.y,
	};
}

export type LaneAssignment = {
	lane: number;
	lanes: number;
	entry: number;
	entries: number;
};

export function assignLanes<
	T extends { source: string; target: string; data?: object },
>(edges: T[]): (T & { data: LaneAssignment })[] {
	const lanes = new Map<string, number>();
	const incoming = new Map<string, number>();
	for (const edge of edges) {
		const pair = `${edge.source}\0${edge.target}`;
		lanes.set(pair, (lanes.get(pair) ?? 0) + 1);
		incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
	}
	const used = new Map<string, number>();
	const usedIncoming = new Map<string, number>();
	return edges.map((edge) => {
		const pair = `${edge.source}\0${edge.target}`;
		const lane = used.get(pair) ?? 0;
		used.set(pair, lane + 1);
		const entry = usedIncoming.get(edge.target) ?? 0;
		usedIncoming.set(edge.target, entry + 1);
		return {
			...edge,
			data: {
				...edge.data,
				lane,
				lanes: lanes.get(pair) ?? 1,
				entry,
				entries: incoming.get(edge.target) ?? 1,
			},
		};
	});
}
