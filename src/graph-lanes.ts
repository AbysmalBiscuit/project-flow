import { Position } from "@xyflow/react";
import type {
	GraphLayout,
	LayoutInput,
	LayoutLink,
	Point,
} from "./graph-layout.ts";
import {
	assignLanes,
	type GraphRoute,
	type LaneAssignment,
	labelSpots,
	type NodeBound,
} from "./graph-routes.ts";
import type { NodeSize } from "./graph-sizes.ts";
import { straightPath } from "./graph-straight.ts";
import type { GraphDirection, GraphLayoutKind } from "./view-settings.ts";

/** An arrow with its lane among the arrows between the same two cards, and the spot of its label. */
export type LaidLink = LayoutLink &
	LaneAssignment & {
		/** The cards that the arrow routes around. */
		nodes: NodeBound[];
		label: Point;
		side: number;
		/** The straight path of an arrow in the Force layout. */
		straight?: string;
	};

function linkRoute(
	link: { source: string; target: string },
	bounds: ReadonlyMap<string, NodeBound>,
	horizontal: boolean,
): GraphRoute {
	const source = bounds.get(link.source);
	const target = bounds.get(link.target);
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

/**
 * Gives each arrow of a laid graph its lane, the cards it routes around and
 * the spot of its label. Each card has its measured size in `sizes`, else
 * `card`.
 */
export function laneLinks(
	input: LayoutInput,
	layout: GraphLayout,
	direction: GraphDirection,
	kind: GraphLayoutKind,
	card: NodeSize,
	sizes: ReadonlyMap<string, NodeSize>,
): LaidLink[] {
	const horizontal = direction === "left-to-right";
	const bounds = new Map(
		input.cards.flatMap((item) => {
			const at = layout.cards.get(item.id);
			if (at === undefined) {
				return [];
			}
			const size = sizes.get(item.id) ?? card;
			const bound: NodeBound = {
				left: at.x,
				top: at.y,
				right: at.x + size.width,
				bottom: at.y + size.height,
			};
			return [[item.id, bound] as const];
		}),
	);
	const side = horizontal ? card.height : card.width;
	const laned = assignLanes(
		input.edges.map((link) => ({ link, source: link.from, target: link.to })),
	).map((edge) => ({
		edge,
		nodes: [...bounds].flatMap(([id, bound]) =>
			id === edge.source || id === edge.target ? [] : [bound],
		),
	}));
	const spots = labelSpots(
		laned.map(({ edge, nodes }) => ({
			route: linkRoute(edge, bounds, horizontal),
			...edge.data,
			nodes,
			side,
		})),
	);
	return laned.map(({ edge, nodes }, index) => {
		const source = bounds.get(edge.source);
		const target = bounds.get(edge.target);
		return {
			...edge.link,
			...edge.data,
			nodes,
			label: spots[index] ?? { x: 0, y: 0 },
			side,
			...(kind === "force" && source !== undefined && target !== undefined
				? { straight: straightPath(source, target) }
				: {}),
		};
	});
}
