import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { groupLabelOf, type ProjectReport } from "./domain.ts";
import {
	type FlowTicket,
	flowGap,
	graphBand,
	graphEdges,
	graphTickets,
	outsideBand,
	projectNodeId,
} from "./graph-flow.ts";
import type { NodeSize } from "./graph-sizes.ts";
import type { GraphDirection, GroupBy } from "./view-settings.ts";

/** The page starts ELK from this script in a Web Worker. */
export const elkWorkerPath = "/elk-worker.js";

export const groupPad = 16;
export const groupHead = 28;

/** The gap between a parent ticket frame's border and its cards. */
export const framePad = 16;

export type LayoutGroup = { id: string; label: string; framed: boolean };

/**
 * The frame of a parent ticket. Its `head` card sits at the top of the frame,
 * and `parent` is the frame that holds this frame.
 */
export type LayoutFrame = {
	id: string;
	head: string;
	title: string;
	parent: string | null;
	group: string | null;
};

/**
 * The cards, groups, parent ticket frames and blocker arrows that the project
 * graph lays out. The `frame` of a card is the frame of its parent ticket.
 */
export type LayoutInput = {
	cards: { id: string; group: string | null; frame: string | null }[];
	groups: LayoutGroup[];
	frames: LayoutFrame[];
	edges: { from: string; to: string }[];
};

export type Point = { x: number; y: number };
export type Rect = Point & NodeSize;

export type GraphLayout = {
	cards: Map<string, Point>;
	/** The frame of each framed group, its head included. */
	groups: Map<string, Rect>;
	/** The frame of each parent ticket, its head card included. */
	frames: Map<string, Rect>;
};

export function groupId(name: string): string {
	return `group\n${name}`;
}

/** The id of the frame that the card `head` heads. */
export function frameId(head: string): string {
	return `frame\n${head}`;
}

export function framesParents(groupBy: GroupBy): boolean {
	return groupBy === "workstream" || groupBy === "theme";
}

type Placed = { id: string; group: string | null; ticket: FlowTicket };

/**
 * The parent ticket of each card, when both cards share a group. A link that
 * would close a parent cycle is dropped.
 */
function parentLinks(placed: readonly Placed[]): Map<string, string> {
	const idOfKey = new Map(
		placed.flatMap((item) =>
			item.ticket.outside ? [] : [[item.ticket.key.toLowerCase(), item]],
		),
	);
	const links = new Map<string, string>();
	for (const item of placed) {
		const parent = idOfKey.get(item.ticket.parent?.toLowerCase() ?? "");
		if (
			item.ticket.outside ||
			parent === undefined ||
			parent.group !== item.group
		) {
			continue;
		}
		let above: string | undefined = parent.id;
		while (above !== undefined && above !== item.id) {
			above = links.get(above);
		}
		if (above === undefined) {
			links.set(item.id, parent.id);
		}
	}
	return links;
}

export function layoutInput(
	report: ProjectReport,
	groupBy: GroupBy,
	assignees: readonly string[],
): LayoutInput {
	const groups = new Map<string, LayoutGroup>();
	const framed = framesParents(groupBy);
	const placed: Placed[] = graphTickets(report, framed).map((ticket) => {
		const id = projectNodeId(ticket.project, ticket.key);
		if (groupBy === "none") {
			return { id, group: null, ticket };
		}
		const name = graphBand(ticket, groupBy, assignees);
		const group = groupId(name);
		if (!groups.has(group)) {
			groups.set(group, {
				id: group,
				label: groupLabelOf(ticket, groupBy, name),
				framed: !ticket.outside && name !== "" && name !== outsideBand,
			});
		}
		return { id, group, ticket };
	});
	const links = framed ? parentLinks(placed) : new Map<string, string>();
	const hiddenParents = new Set(
		report.graphParents.flatMap((ticket) =>
			ticket.key === null ? [] : [projectNodeId(report.name, ticket.key)],
		),
	);
	const heading = new Set<string>();
	for (const item of placed) {
		if (hiddenParents.has(item.id)) {
			continue;
		}
		for (let above = links.get(item.id); above !== undefined; ) {
			heading.add(above);
			above = links.get(above);
		}
	}
	const kept = placed.filter(
		(item) => !hiddenParents.has(item.id) || heading.has(item.id),
	);
	const frameOf = (id: string): string | null => {
		const parent = links.get(id);
		return parent === undefined ? null : frameId(parent);
	};
	const cards = kept.map((item) => ({
		id: item.id,
		group: item.group,
		frame: frameOf(item.id),
	}));
	const frames = kept.flatMap((item) =>
		heading.has(item.id)
			? [
					{
						id: frameId(item.id),
						head: item.id,
						title: item.ticket.title,
						parent: frameOf(item.id),
						group: item.group,
					},
				]
			: [],
	);
	const shown = new Set(cards.map((card) => card.id));
	const edges = graphEdges(report).filter(
		(edge) => shown.has(edge.from) && shown.has(edge.to),
	);
	return {
		cards,
		groups: [...groups.values()].sort((left, right) =>
			left.label.localeCompare(right.label),
		),
		frames,
		edges,
	};
}

function placeOptions(
	direction: GraphDirection,
	card: NodeSize,
): Record<string, string> {
	const horizontal = direction === "left-to-right";
	const alongGap = flowGap.along - card.width;
	const acrossGap = flowGap.across - card.height;
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

/**
 * The ELK options that fill a group frame best, from the elkjs spike tables
 * that `proof/elk-spike/measure.ts` prints.
 *
 * ELK lays out each group alone and ignores the arrows between groups, so the
 * graph routes those arrows itself.
 */
const compactGroups = {
	"elk.hierarchyHandling": "SEPARATE_CHILDREN",
	"elk.layered.layering.strategy": "COFFMAN_GRAHAM",
	"elk.layered.layering.coffmanGraham.layerBound": "4",
};

function padding(top: number, side: number): string {
	return `[top=${top},left=${side},bottom=${side},right=${side}]`;
}

const rootId = "root";

/**
 * The ELK node tree: the root holds the groups, a group or a frame holds its
 * cards and frames. A frame stands in for its head card.
 */
type LayoutTree = {
	holderOf: Map<string, string>;
	nodeOf: (card: string) => string;
};

function layoutTree(input: LayoutInput): LayoutTree {
	const headed = new Map(input.frames.map((frame) => [frame.head, frame.id]));
	const holderOf = new Map<string, string>();
	for (const group of input.groups) {
		holderOf.set(group.id, rootId);
	}
	for (const frame of input.frames) {
		holderOf.set(frame.id, frame.parent ?? frame.group ?? rootId);
	}
	for (const card of input.cards) {
		if (!headed.has(card.id)) {
			holderOf.set(card.id, card.frame ?? card.group ?? rootId);
		}
	}
	return { holderOf, nodeOf: (card) => headed.get(card) ?? card };
}

/**
 * Each blocker arrow joins the two nodes that hold its ends right below their
 * nearest shared holder, and ELK lays it out inside that holder.
 */
function edgesByHolder(
	input: LayoutInput,
	{ holderOf, nodeOf }: LayoutTree,
): Map<string, ElkExtendedEdge[]> {
	const pathOf = (node: string): string[] => {
		const path = [node];
		for (let above = holderOf.get(node); above !== undefined; ) {
			path.push(above);
			above = holderOf.get(above);
		}
		return path;
	};
	const edges = new Map<string, ElkExtendedEdge[]>();
	for (const [index, edge] of input.edges.entries()) {
		const from = pathOf(nodeOf(edge.from));
		const to = pathOf(nodeOf(edge.to));
		const shared = from.find((node) => to.includes(node));
		if (shared === undefined) {
			continue;
		}
		const source = from[from.indexOf(shared) - 1];
		const target = to[to.indexOf(shared) - 1];
		if (source === undefined || target === undefined || source === target) {
			continue;
		}
		edges.set(shared, [
			...(edges.get(shared) ?? []),
			{ id: `edge${index}`, sources: [source], targets: [target] },
		]);
	}
	return edges;
}

function laidChildren(laid: ElkNode): Map<string, Rect> {
	return new Map(
		(laid.children ?? []).map((child) => [
			child.id,
			{
				x: child.x ?? 0,
				y: child.y ?? 0,
				width: child.width ?? 0,
				height: child.height ?? 0,
			},
		]),
	);
}

/**
 * Lays out the project graph with ELK `layered`, one compound node per group.
 *
 * A second pass packs the group frames after `headGrowth` gives the extra
 * height of each wrapped group label at its frame width. `titleGrowth` gives
 * the extra height of a head card whose title wraps.
 */
export async function layoutGraph(
	elk: ELK,
	input: LayoutInput,
	direction: GraphDirection,
	card: NodeSize,
	headGrowth: (label: string, width: number) => number,
	titleGrowth: (title: string) => number,
): Promise<GraphLayout> {
	const options = placeOptions(direction, card);
	const tree = layoutTree(input);
	const edges = edgesByHolder(input, tree);
	const held = Map.groupBy(tree.holderOf, ([, holder]) => holder);
	const frames = new Map(input.frames.map((frame) => [frame.id, frame]));
	const groups = new Map(input.groups.map((group) => [group.id, group]));
	const groupOptions = { ...options, ...compactGroups };
	const frameOptions = (title: string) => ({
		...groupOptions,
		"elk.padding": padding(
			framePad * 2 + card.height + titleGrowth(title),
			framePad,
		),
		"elk.nodeSize.constraints": "MINIMUM_SIZE",
		"elk.nodeSize.minimum": `(${card.width + framePad * 2}, ${card.height})`,
	});
	const node = (id: string): ElkNode => {
		const children = (held.get(id) ?? []).map(([child]) => node(child));
		const frame = frames.get(id);
		if (frame !== undefined) {
			return {
				id,
				layoutOptions: frameOptions(frame.title),
				children,
				edges: edges.get(id) ?? [],
			};
		}
		const group = groups.get(id);
		if (group === undefined) {
			return { id, ...card };
		}
		return {
			id,
			layoutOptions: {
				...groupOptions,
				"elk.padding": group.framed
					? padding(groupHead, groupPad)
					: padding(0, 0),
			},
			children,
			edges: edges.get(id) ?? [],
		};
	};
	const placeAll = (laid: ElkNode, offset: Point, layout: GraphLayout) => {
		for (const child of laid.children ?? []) {
			const at = { x: offset.x + (child.x ?? 0), y: offset.y + (child.y ?? 0) };
			const frame = frames.get(child.id);
			if (frame === undefined) {
				layout.cards.set(child.id, at);
				continue;
			}
			layout.frames.set(child.id, {
				...at,
				width: child.width ?? 0,
				height: child.height ?? 0,
			});
			layout.cards.set(frame.head, { x: at.x + framePad, y: at.y + framePad });
			placeAll(child, at, layout);
		}
	};
	const layout: GraphLayout = {
		cards: new Map(),
		groups: new Map(),
		frames: new Map(),
	};
	if (input.groups.length === 0) {
		const laid = await elk.layout({
			id: rootId,
			layoutOptions: options,
			children: (held.get(rootId) ?? []).map(([child]) => node(child)),
			edges: edges.get(rootId) ?? [],
		});
		placeAll(laid, { x: 0, y: 0 }, layout);
		return layout;
	}
	const laid = await elk.layout({
		id: rootId,
		layoutOptions: groupOptions,
		children: input.groups.map((group) => node(group.id)),
	});
	const heads = new Map(
		input.groups.map((group) => {
			const box = laid.children?.find((child) => child.id === group.id);
			const growth = group.framed
				? headGrowth(group.label, box?.width ?? 0)
				: 0;
			return [group.id, { box, growth }] as const;
		}),
	);
	const packed = laidChildren(
		await elk.layout({
			id: "root",
			layoutOptions: options,
			children: [...heads].map(([id, { box, growth }]) => ({
				id,
				width: box?.width ?? 0,
				height: (box?.height ?? 0) + growth,
			})),
		}),
	);
	for (const group of input.groups) {
		const head = heads.get(group.id);
		const frame = packed.get(group.id);
		if (head === undefined || frame === undefined) {
			continue;
		}
		if (group.framed) {
			layout.groups.set(group.id, frame);
		}
		placeAll(
			head.box ?? { id: group.id },
			{ x: frame.x, y: frame.y + head.growth },
			layout,
		);
	}
	return layout;
}
