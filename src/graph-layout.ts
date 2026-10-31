import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";

import type { FocusLink, ProjectReport } from "./domain.ts";
import {
	directionOptions,
	frameTree,
	padding,
	placeTree,
	type Point,
	type Rect,
} from "./graph-core.ts";
import {
	type FlowEdge,
	type FlowGap,
	flowGap,
	type FlowTicket,
	graphBand,
	graphEdges,
	graphTickets,
	outsideBand,
	projectNodeId,
} from "./graph-flow.ts";
import type { NodeSize } from "./graph-sizes.ts";
import { groupLabelOf } from "./ticket-groups.ts";
import { foldKey } from "./ticket-key.ts";
import type { GraphDirection, GroupBy } from "./view-settings.ts";

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
	outside: boolean;
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

/** A blocker arrow between two cards. */
export type LayoutLink = FlowEdge & { id: string };

/** The cards, groups, parent ticket frames and blocker arrows that the graph lays out. */
export type LayoutInput = {
	cards: LayoutCard[];
	groups: LayoutGroup[];
	frames: LayoutFrame[];
	edges: LayoutLink[];
	/** The ticket of the collapsed card that hides each hidden ticket. */
	hiddenIn: Map<string, string>;
	/** The key of each parent ticket that heads a frame, open, collapsed or hidden. */
	parents: string[];
};

/**
 * Every part of the layout input that places the cards. The done state of an
 * arrow changes only how the page draws it, so it stays out.
 */
export function layoutSignature(input: LayoutInput): string {
	return JSON.stringify(input, (key, value: unknown) =>
		key === "done" ? undefined : value instanceof Map ? [...value] : value,
	);
}

/** Tells whether the frame of the parent ticket with this key is collapsed. */
export type Collapsed = (key: string, startsCollapsed: boolean) => boolean;

export type { Point, Rect };

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
 * group or another project. A link that would close a parent cycle is dropped.
 */
function parentLinks(
	placed: readonly Placed[],
	hidden: ReadonlySet<string>,
): {
	links: Map<string, string>;
	copies: Map<string, Placed & { of: string }>;
} {
	const byKey = new Map(placed.map((item) => [foldKey(item.ticket.key), item]));
	const parentOf = (item: Placed) =>
		byKey.get(foldKey(item.ticket.parent) ?? "");
	const links = new Map<string, string>();
	const copies = new Map<string, Placed & { of: string }>();
	const encloses = (outer: string, inner: string): boolean => {
		for (let at: string | undefined = outer; at !== undefined;) {
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
	const shownTickets = new Set(
		graphTickets(report).map((ticket) =>
			projectNodeId(ticket.project, ticket.key),
		),
	);
	const hiddenParents = new Set(
		placed.flatMap((item) => (shownTickets.has(item.id) ? [] : [item.id])),
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
		for (let above = links.get(id); above !== undefined;) {
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
						outside: item.ticket.outside,
						parent: frameOf(item.id),
						group: item.group,
					},
				]
			: [],
	);
	const shown = new Set(cards.map((card) => card.id));
	const edges = new Map<string, LayoutLink>();
	for (const edge of graphEdges(report)) {
		const from = shownAs(edge.from);
		const to = shownAs(edge.to);
		if (from === to || !shown.has(from) || !shown.has(to)) {
			continue;
		}
		const id = `${from}->${to}`;
		const done = (edges.get(id)?.done ?? true) && edge.done === true;
		edges.set(id, { id, from, to, done });
	}
	const showing = new Set(cards.map((card) => card.ticket));
	const ticketOf = new Map(laid.map((item) => [item.id, item.of]));
	const hiddenIn = new Map<string, string>();
	for (const item of laid) {
		const by = ticketOf.get(shownAs(item.id));
		if (by !== undefined && !showing.has(item.of) && !hiddenIn.has(item.of)) {
			hiddenIn.set(item.of, by);
		}
	}
	const filled = new Set(cards.map((card) => card.group));
	return {
		cards,
		groups: [...groups.values()]
			.filter((group) => filled.has(group.id))
			.sort((left, right) => left.label.localeCompare(right.label)),
		frames,
		edges: [...edges.values()],
		hiddenIn,
		parents: [
			...new Set(
				laid.flatMap((item) => (heading.has(item.id) ? [item.ticket.key] : [])),
			),
		],
	};
}

/** The blocker arrows of the laid graph as links between the tickets that their cards show. */
export function focusLinks(input: LayoutInput): FocusLink[] {
	const ticketOf = new Map(input.cards.map((card) => [card.id, card.ticket]));
	return input.edges.map((edge) => ({
		from: ticketOf.get(edge.from) ?? edge.from,
		to: ticketOf.get(edge.to) ?? edge.to,
	}));
}

/** The focused tickets, each hidden one moved to the collapsed card that hides it. */
export function focusSeeds(
	input: LayoutInput,
	seeds: ReadonlySet<string>,
): ReadonlySet<string> {
	return new Set([...seeds].map((id) => input.hiddenIn.get(id) ?? id));
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

const rootId = "root";

/**
 * The holder of each ELK node: the root holds the groups, and a group or a
 * frame holds its cards and frames. A frame stands in for its head card.
 */
function layoutTree(input: LayoutInput): {
	holderOf: Map<string, string>;
	nodeOf: (card: string) => string;
} {
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
 * The size of each card: its measured size in `sizes`, else `card`. A head
 * card with no measured size grows by `titleGrowth` of its title.
 */
export function cardSizes(
	card: NodeSize,
	sizes: ReadonlyMap<string, NodeSize>,
	titleGrowth: (title: string) => number,
): {
	sizeOf: (id: string) => NodeSize;
	headOf: (frame: LayoutFrame) => NodeSize;
} {
	return {
		sizeOf: (id) => sizes.get(id) ?? card,
		headOf: (frame) =>
			sizes.get(frame.head) ?? {
				width: card.width,
				height: card.height + titleGrowth(frame.title),
			},
	};
}

/**
 * Lays out the project graph with ELK `layered`, one compound node per group.
 *
 * A second pass packs the group frames after `headGrowth` gives the extra
 * height of each wrapped group label at its frame width. Each card takes its
 * measured size from `sizes`, as `cardSizes` tells. `gap` is the distance
 * from one card to the next, along and across the arrows.
 */
export async function layoutGraph(
	elk: ELK,
	input: LayoutInput,
	direction: GraphDirection,
	card: NodeSize,
	headGrowth: (label: string, width: number) => number,
	titleGrowth: (title: string) => number,
	sizes: ReadonlyMap<string, NodeSize> = new Map(),
	gap: FlowGap = flowGap,
): Promise<GraphLayout> {
	const { sizeOf, headOf } = cardSizes(card, sizes, titleGrowth);
	const options = directionOptions(direction, card, gap);
	const frames = new Map(input.frames.map((frame) => [frame.id, frame]));
	const groups = new Map(input.groups.map((group) => [group.id, group]));
	const groupOptions = { ...options, ...compactGroups };
	const { holderOf, nodeOf } = layoutTree(input);
	const tree = frameTree({
		holderOf,
		optionsOf: (id) => {
			const frame = frames.get(id);
			if (frame !== undefined) {
				const head = headOf(frame);
				return {
					...groupOptions,
					"elk.padding": padding(framePad * 2 + head.height, framePad),
					"elk.nodeSize.constraints": "MINIMUM_SIZE",
					"elk.nodeSize.minimum": `(${head.width + framePad * 2}, ${card.height})`,
				};
			}
			const group = groups.get(id);
			return group === undefined
				? undefined
				: {
						...groupOptions,
						"elk.padding": group.framed
							? padding(groupHead, groupPad)
							: padding(0, 0),
					};
		},
		sizeOf,
		edges: input.edges.map((edge) => ({
			from: nodeOf(edge.from),
			to: nodeOf(edge.to),
		})),
		selfLoops: false,
	});
	const placeAll = (laid: ElkNode, offset: Point, layout: GraphLayout) => {
		for (const [id, rect] of placeTree(laid, offset)) {
			const frame = frames.get(id);
			if (frame === undefined) {
				layout.cards.set(id, { x: rect.x, y: rect.y });
				continue;
			}
			layout.frames.set(id, rect);
			layout.cards.set(frame.head, {
				x: rect.x + framePad,
				y: rect.y + framePad,
			});
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
			children: tree.children(rootId),
			edges: tree.edgesIn(rootId),
		});
		placeAll(laid, { x: 0, y: 0 }, layout);
		return layout;
	}
	const laid = await elk.layout({
		id: rootId,
		layoutOptions: groupOptions,
		children: input.groups.map((group) => tree.node(group.id)),
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
	const packed = placeTree(
		await elk.layout({
			id: "root",
			layoutOptions: options,
			children: [...heads].map(([id, { box, growth }]) => ({
				id,
				width: box?.width ?? 0,
				height: (box?.height ?? 0) + growth,
			})),
		}),
		{ x: 0, y: 0 },
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
