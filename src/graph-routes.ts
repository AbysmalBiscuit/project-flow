import type { Position } from "@xyflow/react";

export type GraphRoute = {
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
};

export type RoutedEdge = {
	path: string;
	labelX: number;
	labelY: number;
};

const bend = 8;
const laneGap = 36;

function sameColumn(route: GraphRoute): boolean {
	return (
		route.sourcePosition === route.targetPosition ||
		(route.sourcePosition === "left" && route.targetPosition === "right") ||
		(route.sourcePosition === "right" && route.targetPosition === "left") ||
		(route.sourcePosition === "top" && route.targetPosition === "bottom") ||
		(route.sourcePosition === "bottom" && route.targetPosition === "top")
	);
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

function routePoints(
	route: GraphRoute,
	lane: number,
): { x: number; y: number }[] {
	const horizontal =
		route.sourcePosition === "left" || route.sourcePosition === "right";
	const sourceSign =
		route.sourcePosition === "right" || route.sourcePosition === "bottom"
			? 1
			: -1;
	const targetSign =
		route.targetPosition === "right" || route.targetPosition === "bottom"
			? 1
			: -1;
	if (horizontal && forward(route) && sameColumn(route)) {
		const approach = 28;
		const endX = route.targetX + Math.min(lane, 0);
		const endY = route.targetY + lane;
		return [
			{ x: route.sourceX, y: route.sourceY },
			{ x: route.sourceX + approach, y: route.sourceY },
			{ x: route.sourceX + approach, y: route.sourceY + lane },
			{ x: endX - approach, y: endY },
			{ x: endX, y: endY },
		];
	}
	if (!horizontal && forward(route) && sameColumn(route)) {
		const approach = 28;
		const endX = route.targetX + lane;
		const endY = route.targetY + Math.min(lane, 0);
		return [
			{ x: route.sourceX, y: route.sourceY },
			{ x: route.sourceX, y: route.sourceY + approach },
			{ x: route.sourceX + lane, y: route.sourceY + approach },
			{ x: endX, y: endY - approach },
			{ x: endX, y: endY },
		];
	}
	const stub = 36;
	if (horizontal) {
		const leave = route.sourceX + sourceSign * stub;
		const arrive = route.targetX + targetSign * stub;
		const rail = (route.sourceY + route.targetY) / 2 + lane;
		return [
			{ x: route.sourceX, y: route.sourceY },
			{ x: leave, y: route.sourceY },
			{ x: leave, y: rail },
			{ x: arrive, y: rail },
			{ x: arrive, y: route.targetY },
			{ x: route.targetX, y: route.targetY },
		];
	}
	const leave = route.sourceY + sourceSign * stub;
	const arrive = route.targetY + targetSign * stub;
	const rail = (route.sourceX + route.targetX) / 2 + lane;
	return [
		{ x: route.sourceX, y: route.sourceY },
		{ x: route.sourceX, y: leave },
		{ x: rail, y: leave },
		{ x: rail, y: arrive },
		{ x: route.targetX, y: arrive },
		{ x: route.targetX, y: route.targetY },
	];
}

export function routeEdge(
	route: GraphRoute,
	index: number,
	count: number,
): RoutedEdge {
	const points = routePoints(route, laneOf(index, count));
	const along = points[2];
	const next = points[3];
	const label =
		along === undefined || next === undefined
			? { x: route.sourceX, y: route.sourceY }
			: {
					x: along.x + (next.x - along.x) * 0.55,
					y: along.y + (next.y - along.y) * 0.55,
				};
	return {
		path: pathThrough(points),
		labelX: label.x,
		labelY: label.y,
	};
}
