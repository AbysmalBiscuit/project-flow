import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { groupLabelOf, type ProjectReport } from "./domain.ts";
import {
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

export type LayoutGroup = { id: string; label: string; framed: boolean };

/** The cards, groups and blocker arrows that the project graph lays out. */
export type LayoutInput = {
	cards: { id: string; group: string | null }[];
	groups: LayoutGroup[];
	edges: { from: string; to: string }[];
};

export type Point = { x: number; y: number };
export type Rect = Point & NodeSize;

export type GraphLayout = {
	cards: Map<string, Point>;
	/** The frame of each framed group, its head included. */
	groups: Map<string, Rect>;
};

export function groupId(name: string): string {
	return `group\n${name}`;
}

export function layoutInput(
	report: ProjectReport,
	groupBy: GroupBy,
	assignees: readonly string[],
): LayoutInput {
	const groups = new Map<string, LayoutGroup>();
	const cards = graphTickets(report).map((ticket) => {
		const id = projectNodeId(ticket.project, ticket.key);
		if (groupBy === "none") {
			return { id, group: null };
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
		return { id, group };
	});
	const shown = new Set(cards.map((card) => card.id));
	const edges = graphEdges(report).filter(
		(edge) => shown.has(edge.from) && shown.has(edge.to),
	);
	return {
		cards,
		groups: [...groups.values()].sort((left, right) =>
			left.label.localeCompare(right.label),
		),
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

function edgesWithin(
	input: LayoutInput,
	group: string | null,
): ElkExtendedEdge[] {
	const groupOf = new Map(input.cards.map((card) => [card.id, card.group]));
	return input.edges.flatMap((edge, index) =>
		edge.from !== edge.to &&
		groupOf.get(edge.from) === group &&
		groupOf.get(edge.to) === group
			? [{ id: `edge${index}`, sources: [edge.from], targets: [edge.to] }]
			: [],
	);
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
 * height of each wrapped group label at its frame width.
 */
export async function layoutGraph(
	elk: ELK,
	input: LayoutInput,
	direction: GraphDirection,
	card: NodeSize,
	headGrowth: (label: string, width: number) => number,
): Promise<GraphLayout> {
	const options = placeOptions(direction, card);
	const cardNode = (id: string): ElkNode => ({ id, ...card });
	if (input.groups.length === 0) {
		const laid = await elk.layout({
			id: "root",
			layoutOptions: options,
			children: input.cards.map((item) => cardNode(item.id)),
			edges: edgesWithin(input, null),
		});
		return { cards: laidChildren(laid), groups: new Map() };
	}
	const groupOptions = { ...options, ...compactGroups };
	const members = Map.groupBy(input.cards, (item) => item.group);
	const laid = await elk.layout({
		id: "root",
		layoutOptions: groupOptions,
		children: input.groups.map((group) => ({
			id: group.id,
			layoutOptions: {
				...groupOptions,
				"elk.padding": group.framed
					? padding(groupHead, groupPad)
					: padding(0, 0),
			},
			children: (members.get(group.id) ?? []).map((item) => cardNode(item.id)),
			edges: edgesWithin(input, group.id),
		})),
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
	const cards = new Map<string, Point>();
	const groups = new Map<string, Rect>();
	for (const group of input.groups) {
		const head = heads.get(group.id);
		const frame = packed.get(group.id);
		if (head === undefined || frame === undefined) {
			continue;
		}
		if (group.framed) {
			groups.set(group.id, frame);
		}
		for (const [id, place] of laidChildren(head.box ?? { id: group.id })) {
			cards.set(id, {
				x: frame.x + place.x,
				y: frame.y + head.growth + place.y,
			});
		}
	}
	return { cards, groups };
}
