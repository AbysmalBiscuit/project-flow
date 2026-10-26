import type {
	ElkExtendedEdge,
	ElkLabel,
	ElkNode,
	LayoutOptions,
} from "elkjs/lib/elk-api.js";

import type { FlowGap } from "./graph-flow.ts";
import type { NodeSize } from "./graph-sizes.ts";
import type { GraphDirection } from "./view-settings.ts";

/** The page starts ELK from this script in a Web Worker. */
export const elkWorkerPath = "/elk-worker.js";

export type Point = { x: number; y: number };
export type Rect = Point & NodeSize;

/** The least gap between two nodes, when a drawn node fills the flow gap. */
const leastNodeGap = 32;

/**
 * The ELK `layered` options for a graph that flows in `direction`. `gap` is
 * the distance from one node of size `node` to the next, along and across
 * the arrows.
 */
export function directionOptions(
	direction: GraphDirection,
	node: NodeSize,
	gap: FlowGap,
): LayoutOptions {
	const horizontal = direction === "left-to-right";
	const alongGap = Math.max(gap.along - node.width, leastNodeGap);
	const acrossGap = Math.max(gap.across - node.height, leastNodeGap);
	return {
		"elk.algorithm": "layered",
		"elk.direction": horizontal ? "RIGHT" : "DOWN",
		"elk.spacing.nodeNode": String(horizontal ? acrossGap : alongGap),
		"elk.layered.spacing.nodeNodeBetweenLayers": String(
			horizontal ? alongGap : acrossGap,
		),
		"elk.spacing.componentComponent": String(acrossGap),
	};
}

/** The ELK padding of a frame with a head of height `top`. */
export function padding(top: number, side: number): string {
	return `[top=${top},left=${side},bottom=${side},right=${side}]`;
}

/**
 * Nested frames for ELK. `holderOf` names the frame or the root that holds
 * each node. A node with frame options from `optionsOf` is a frame, and each
 * other node is a leaf of size `sizeOf`. `selfLoops` keeps an edge whose two
 * ends are the same node. ELK places the `labels` of each edge.
 */
export type FrameTreeInput = {
	holderOf: ReadonlyMap<string, string>;
	optionsOf: (id: string) => LayoutOptions | undefined;
	sizeOf: (id: string) => NodeSize;
	edges: readonly { from: string; to: string; labels?: ElkLabel[] }[];
	selfLoops: boolean;
};

export type FrameTree = {
	/** The ELK node of a frame or a leaf, with the nodes that it holds. */
	node: (id: string) => ElkNode;
	/** The ELK nodes that a frame or the root holds. */
	children: (holder: string) => ElkNode[];
	/** The edges that ELK lays out inside a frame or the root. */
	edgesIn: (holder: string) => ElkExtendedEdge[];
};

/**
 * Each edge joins the two nodes that hold its ends right below their nearest
 * shared holder, and ELK lays it out inside that holder. An edge between a
 * frame and a node inside it has no such pair, so it is left out.
 */
function holderEdges({
	holderOf,
	edges,
	selfLoops,
}: FrameTreeInput): Map<string, ElkExtendedEdge[]> {
	const pathOf = (node: string): string[] => {
		const path = [node];
		for (let above = holderOf.get(node); above !== undefined;) {
			path.push(above);
			above = holderOf.get(above);
		}
		return path;
	};
	const byHolder = new Map<string, ElkExtendedEdge[]>();
	const add = (holder: string, edge: ElkExtendedEdge) =>
		byHolder.set(holder, [...(byHolder.get(holder) ?? []), edge]);
	for (const [index, edge] of edges.entries()) {
		const id = `edge${index}`;
		const labels = edge.labels === undefined ? {} : { labels: edge.labels };
		if (edge.from === edge.to) {
			const holder = holderOf.get(edge.from);
			if (selfLoops && holder !== undefined) {
				add(holder, {
					id,
					sources: [edge.from],
					targets: [edge.to],
					...labels,
				});
			}
			continue;
		}
		const from = pathOf(edge.from);
		const to = pathOf(edge.to);
		const shared = from.find((node) => to.includes(node));
		if (shared === undefined) {
			continue;
		}
		const source = from[from.indexOf(shared) - 1];
		const target = to[to.indexOf(shared) - 1];
		if (source === undefined || target === undefined || source === target) {
			continue;
		}
		add(shared, { id, sources: [source], targets: [target], ...labels });
	}
	return byHolder;
}

export function frameTree(input: FrameTreeInput): FrameTree {
	const held = Map.groupBy(input.holderOf, ([, holder]) => holder);
	const edges = holderEdges(input);
	const edgesIn = (holder: string) => edges.get(holder) ?? [];
	const children = (holder: string): ElkNode[] =>
		(held.get(holder) ?? []).map(([child]) => node(child));
	const node = (id: string): ElkNode => {
		const layoutOptions = input.optionsOf(id);
		return layoutOptions === undefined
			? { id, ...input.sizeOf(id) }
			: { id, layoutOptions, children: children(id), edges: edgesIn(id) };
	};
	return { node, children, edgesIn };
}

/**
 * The place of each node below a laid ELK node, frames before the nodes that
 * they hold, moved by `offset`.
 */
export function placeTree(laid: ElkNode, offset: Point): Map<string, Rect> {
	const places = new Map<string, Rect>();
	const place = (holder: ElkNode, at: Point) => {
		for (const child of holder.children ?? []) {
			const rect = {
				x: at.x + (child.x ?? 0),
				y: at.y + (child.y ?? 0),
				width: child.width ?? 0,
				height: child.height ?? 0,
			};
			places.set(child.id, rect);
			place(child, rect);
		}
	};
	place(laid, offset);
	return places;
}
