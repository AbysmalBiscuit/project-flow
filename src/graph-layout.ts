import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { groupLabelOf, type ProjectReport } from "./domain.ts";
import {
	type FlowEdge,
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

/** The page runs the Force layout from this script in a Web Worker. */
export const forceWorkerPath = "/force-worker.js";

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
 * A card on the project graph. `ticket` is the node id of the ticket it shows:
 * a parent ticket from another group shows again as a card of its own in each
 * group that holds its sub-tickets. `frame` is the frame of its parent ticket.
 * A `collapsed` card heads a collapsed frame and hides its sub-tickets.
 */
export type LayoutCard = {
	id: string;
	ticket: string;
	group: string | null;
	frame: string | null;
	collapsed: boolean;
};

/** The cards, groups, parent ticket frames and blocker arrows that the project graph lays out. */
export type LayoutInput = {
	cards: LayoutCard[];
	groups: LayoutGroup[];
	frames: LayoutFrame[];
	edges: FlowEdge[];
};

/** Tells whether the frame of the parent ticket with this key is collapsed. */
export type Collapsed = (key: string, startsCollapsed: boolean) => boolean;

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
 * The parent ticket card of each card. Each group frames its cards by their
 * whole parent chain, with a copy of each parent ticket card from another
 * group. A link that would close a parent cycle is dropped.
 */
function parentLinks(
	placed: readonly Placed[],
	hidden: ReadonlySet<string>,
): {
	links: Map<string, string>;
	copies: Map<string, Placed & { of: string }>;
} {
	const byKey = new Map(
		placed.flatMap((item) =>
			item.ticket.outside ? [] : [[item.ticket.key.toLowerCase(), item]],
		),
	);
	const parentOf = (item: Placed) =>
		byKey.get(item.ticket.parent?.toLowerCase() ?? "");
	const links = new Map<string, string>();
	const copies = new Map<string, Placed & { of: string }>();
	const encloses = (outer: string, inner: string): boolean => {
		for (let at: string | undefined = outer; at !== undefined; ) {
			if (at === inner) {
				return true;
			}
			at = links.get(at);
		}
		return false;
	};
	for (const item of placed) {
		if (item.ticket.outside || hidden.has(item.id)) {
			continue;
		}
		const cardIn = (ticket: Placed) =>
			ticket.group === item.group
				? ticket.id
				: `${ticket.id}\nin\n${item.group ?? ""}`;
		let lower = item;
		for (
			let upper = parentOf(lower);
			upper !== undefined;
			upper = parentOf(lower)
		) {
			const below = cardIn(lower);
			const head = cardIn(upper);
			if (links.has(below) || encloses(head, below)) {
				break;
			}
			links.set(below, head);
			if (head !== upper.id) {
				copies.set(head, {
					...upper,
					id: head,
					group: item.group,
					of: upper.id,
				});
			}
			lower = upper;
		}
	}
	return { links, copies };
}

/**
 * A collapsed frame shows only its head card. A blocker arrow whose end is a
 * hidden sub-ticket ends on that head card, and arrows that become the same
 * arrow merge into one, which is done only when all of them are done.
 */
export function layoutInput(
	report: ProjectReport,
	groupBy: GroupBy,
	assignees: readonly string[],
	collapsed: Collapsed = () => false,
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
	const hiddenParents = new Set(
		report.graphParents.flatMap((ticket) =>
			ticket.key === null ? [] : [projectNodeId(report.name, ticket.key)],
		),
	);
	const { links, copies } = framed
		? parentLinks(placed, hiddenParents)
		: { links: new Map<string, string>(), copies: new Map() };
	const heading = new Set(links.values());
	const laid = [
		...placed
			.filter((item) => !hiddenParents.has(item.id) || heading.has(item.id))
			.map((item) => ({ ...item, of: item.id })),
		...copies.values(),
	];
	const shut = new Set(
		laid.flatMap((item) =>
			heading.has(item.id) &&
			collapsed(item.ticket.key, item.ticket.startsCollapsed === true)
				? [item.id]
				: [],
		),
	);
	const shownAs = (id: string): string => {
		let shown = id;
		for (let above = links.get(id); above !== undefined; ) {
			if (shut.has(above)) {
				shown = above;
			}
			above = links.get(above);
		}
		return shown;
	};
	const kept = laid.filter((item) => shownAs(item.id) === item.id);
	const frameOf = (id: string): string | null => {
		const parent = links.get(id);
		return parent === undefined ? null : frameId(parent);
	};
	const cards = kept.map((item) => ({
		id: item.id,
		ticket: item.of,
		group: item.group,
		frame: frameOf(item.id),
		collapsed: shut.has(item.id),
	}));
	const frames = kept.flatMap((item) =>
		heading.has(item.id) && !shut.has(item.id)
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
	const edges = new Map<string, FlowEdge>();
	for (const edge of graphEdges(report)) {
		const from = shownAs(edge.from);
		const to = shownAs(edge.to);
		if (from === to || !shown.has(from) || !shown.has(to)) {
			continue;
		}
		const id = `${from}\n->\n${to}`;
		const done = (edges.get(id)?.done ?? true) && edge.done === true;
		edges.set(id, { from, to, done });
	}
	const filled = new Set(cards.map((card) => card.group));
	return {
		cards,
		groups: [...groups.values()]
			.filter((group) => filled.has(group.id))
			.sort((left, right) => left.label.localeCompare(right.label)),
		frames,
		edges: [...edges.values()],
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
