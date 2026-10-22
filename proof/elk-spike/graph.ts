/**
 * The spike graph: tickets, blocker links, groups and parent ticket frames of
 * one project report, as the elkjs spike lays them out.
 */
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { ProjectReport } from "../../src/domain.ts";
import {
	type FlowTicket,
	flowGap,
	graphBand,
	graphEdges,
	graphTickets,
	projectNodeId,
} from "../../src/graph-flow.ts";
import type { GroupBy } from "../../src/view-settings.ts";

export const card = { width: 220, height: 96 };
export const cell = { width: flowGap.along, height: flowGap.across };
export const framePad = { side: 16, head: 28 };
/** Id prefix of a parent ticket card from outside the project. */
export const outsideParent = "outside-parent\n";

export type Recorded = { url: string; body: string; text: string };

export type Frame = {
	id: string;
	label: string;
	header: string | null;
	cards: string[];
	frames: Frame[];
};

export type SpikeGraph = {
	tickets: Map<string, FlowTicket>;
	edges: { id: string; from: string; to: string }[];
	groups: Frame[];
	outside: string[];
	depth: number;
};

/** Parent key of each ticket, read from the recorded tracker responses. */
export function recordedParents(
	recorded: readonly Recorded[],
): Map<string, string> {
	const parents = new Map<string, string>();
	for (const response of recorded) {
		if (!response.url.endsWith("/graphql")) {
			continue;
		}
		const repo = repoOf(response.body);
		let data: unknown;
		try {
			data = JSON.parse(response.text);
		} catch {
			continue;
		}
		walkParents(data, repo, parents);
	}
	return parents;
}

function repoOf(body: string): string | null {
	try {
		const parsed: unknown = JSON.parse(body);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			!("variables" in parsed)
		) {
			return null;
		}
		const variables = parsed.variables;
		if (
			typeof variables === "object" &&
			variables !== null &&
			"owner" in variables &&
			"name" in variables
		) {
			return `${String(variables.owner)}/${String(variables.name)}`;
		}
	} catch {}
	return null;
}

function walkParents(
	value: unknown,
	repo: string | null,
	parents: Map<string, string>,
): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			walkParents(item, repo, parents);
		}
		return;
	}
	if (typeof value !== "object" || value === null) {
		return;
	}
	const own = ownKey(value, repo);
	const parent = "parent" in value ? parentKey(value.parent) : null;
	if (own !== null && parent !== null) {
		parents.set(own.toLowerCase(), parent.toLowerCase());
	}
	for (const item of Object.values(value)) {
		walkParents(item, repo, parents);
	}
}

function ownKey(value: object, repo: string | null): string | null {
	if ("identifier" in value && typeof value.identifier === "string") {
		return value.identifier;
	}
	if (repo !== null && "number" in value && "title" in value) {
		return `${repo}#${String(value.number)}`;
	}
	return null;
}

function parentKey(parent: unknown): string | null {
	if (typeof parent !== "object" || parent === null) {
		return null;
	}
	if ("identifier" in parent && typeof parent.identifier === "string") {
		return parent.identifier;
	}
	if (
		"number" in parent &&
		"repository" in parent &&
		typeof parent.repository === "object" &&
		parent.repository !== null &&
		"nameWithOwner" in parent.repository
	) {
		return `${String(parent.repository.nameWithOwner)}#${String(parent.number)}`;
	}
	return null;
}

/**
 * Groups the tickets like the project graph, then nests parent ticket frames
 * to full depth inside each group. A parent ticket tree joins the group that
 * most of its tickets have. A parent ticket that the graph does not show heads
 * its frame as an outside card.
 */
export function spikeGraph(
	report: ProjectReport,
	parents: ReadonlyMap<string, string>,
	groupBy: GroupBy,
	nested: boolean,
): SpikeGraph {
	const flow = graphTickets(report);
	const tickets = new Map(
		flow.map((ticket) => [projectNodeId(ticket.project, ticket.key), ticket]),
	);
	const idOfKey = new Map(
		flow
			.filter((ticket) => !ticket.outside)
			.map((ticket) => [
				ticket.key.toLowerCase(),
				projectNodeId(ticket.project, ticket.key),
			]),
	);
	const outside = flow
		.filter((ticket) => ticket.outside)
		.map((ticket) => projectNodeId(ticket.project, ticket.key));
	const edges = graphEdges(report)
		.filter(
			(edge) =>
				tickets.has(edge.from) && tickets.has(edge.to) && edge.from !== edge.to,
		)
		.map((edge, index) => ({ id: `e${index}`, from: edge.from, to: edge.to }));

	const parentOf = new Map<string, string>();
	const nodeOf = (key: string) => idOfKey.get(key) ?? `${outsideParent}${key}`;
	if (nested) {
		for (const key of idOfKey.keys()) {
			let child = key;
			let parent = parents.get(child);
			while (parent !== undefined && !parentOf.has(nodeOf(child))) {
				parentOf.set(nodeOf(child), nodeOf(parent));
				child = parent;
				parent = parents.get(child);
			}
		}
	}
	const topOf = (id: string): string => {
		let current = id;
		const seen = new Set<string>();
		while (parentOf.has(current) && !seen.has(current)) {
			seen.add(current);
			current = parentOf.get(current) ?? current;
		}
		return current;
	};
	const bandOf = (id: string): string => {
		const ticket = tickets.get(id);
		return ticket === undefined ? "" : graphBand(ticket, groupBy, []);
	};
	const treeBand = new Map<string, string>();
	const votes = new Map<string, Map<string, number>>();
	for (const id of idOfKey.values()) {
		const top = topOf(id);
		const tally = votes.get(top) ?? new Map<string, number>();
		tally.set(bandOf(id), (tally.get(bandOf(id)) ?? 0) + 1);
		votes.set(top, tally);
	}
	for (const [top, tally] of votes) {
		const best = [...tally].sort(
			(left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
		)[0];
		treeBand.set(top, best?.[0] ?? "");
	}

	const childrenOf = new Map<string, string[]>();
	for (const [child, parent] of parentOf) {
		childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
	}
	let depth = 0;
	const frameOf = (id: string, level: number): Frame => {
		depth = Math.max(depth, level);
		const cards: string[] = [];
		const frames: Frame[] = [];
		for (const child of childrenOf.get(id) ?? []) {
			if (childrenOf.has(child)) {
				frames.push(frameOf(child, level + 1));
			} else {
				cards.push(child);
			}
		}
		return { id: `frame\n${id}`, label: id, header: id, cards, frames };
	};
	const groups = new Map<string, Frame>();
	const groupFor = (band: string): Frame => {
		const known = groups.get(band);
		if (known !== undefined) {
			return known;
		}
		const group: Frame = {
			id: `group\n${band}`,
			label: band,
			header: null,
			cards: [],
			frames: [],
		};
		groups.set(band, group);
		return group;
	};
	for (const top of votes.keys()) {
		const group = groupFor(treeBand.get(top) ?? "");
		if (childrenOf.has(top)) {
			group.frames.push(frameOf(top, 1));
		} else {
			group.cards.push(top);
		}
	}
	return {
		tickets,
		edges,
		groups: [...groups.values()].sort((left, right) =>
			left.label.localeCompare(right.label),
		),
		outside,
		depth,
	};
}

/** Every card id inside a frame, its header included, at every depth. */
export function frameCards(frame: Frame): string[] {
	return [
		...(frame.header === null ? [] : [frame.header]),
		...frame.cards,
		...frame.frames.flatMap(frameCards),
	];
}

/** Every card id of the graph: the outside cards and the cards of each group. */
export function allCards(
	graph: Pick<SpikeGraph, "outside" | "groups">,
): string[] {
	return [...graph.outside, ...graph.groups.flatMap(frameCards)];
}

export type ElkSettings = Record<string, string>;

function cardNode(id: string): ElkNode {
	return { id, width: card.width, height: card.height };
}

function frameNode(frame: Frame, options: ElkSettings): ElkNode {
	return {
		id: frame.id,
		layoutOptions: {
			...options,
			"elk.padding": `[top=${framePad.head},left=${framePad.side},bottom=${framePad.side},right=${framePad.side}]`,
		},
		children: [
			...(frame.header === null ? [] : [cardNode(frame.header)]),
			...frame.cards.map(cardNode),
			...frame.frames.map((child) => frameNode(child, options)),
		],
	};
}

/**
 * The ELK JSON graph: groups hold parent ticket frames, frames hold cards.
 * With `lift`, each arrow moves up to the two frames that hold its ends below
 * their nearest shared frame, so a per-level algorithm such as `stress` sees it.
 */
export function elkGraph(
	graph: SpikeGraph,
	rootOptions: ElkSettings,
	frameOptions: ElkSettings,
	lift = false,
): ElkNode {
	const root: ElkNode = {
		id: "root",
		layoutOptions: rootOptions,
		children: [
			...graph.outside.map(cardNode),
			...graph.groups.map((group) => frameNode(group, frameOptions)),
		],
		edges: [],
	};
	const pathOf = new Map<string, ElkNode[]>();
	const walk = (node: ElkNode, path: ElkNode[]) => {
		for (const child of node.children ?? []) {
			pathOf.set(child.id, [...path, child]);
			walk(child, [...path, child]);
		}
	};
	walk(root, [root]);
	const lifted = new Set<string>();
	for (const edge of graph.edges) {
		const from = pathOf.get(edge.from);
		const to = pathOf.get(edge.to);
		if (from === undefined || to === undefined) {
			continue;
		}
		if (!lift) {
			root.edges?.push({
				id: edge.id,
				sources: [edge.from],
				targets: [edge.to],
			});
			continue;
		}
		let shared = 0;
		while (
			from[shared + 1] !== undefined &&
			from[shared + 1] === to[shared + 1]
		) {
			shared += 1;
		}
		const container = from[shared];
		const source = from[shared + 1];
		const target = to[shared + 1];
		const key = `${source?.id}->${target?.id}`;
		if (
			container === undefined ||
			source === undefined ||
			target === undefined ||
			lifted.has(key)
		) {
			continue;
		}
		lifted.add(key);
		container.edges = [
			...(container.edges ?? []),
			{ id: `lift${lifted.size}`, sources: [source.id], targets: [target.id] },
		];
	}
	return root;
}

/** The report with every ticket on the graph, done tickets included. */
export function everyTicket(report: ProjectReport): ProjectReport {
	const shown = new Set(
		report.graphTickets.map((ticket) => ticket.key?.toLowerCase()),
	);
	const rest = [...report.tickets, ...report.doneTickets].filter((ticket) => {
		const key = ticket.key?.toLowerCase();
		if (shown.has(key)) {
			return false;
		}
		shown.add(key);
		return true;
	});
	return { ...report, graphTickets: [...report.graphTickets, ...rest] };
}
