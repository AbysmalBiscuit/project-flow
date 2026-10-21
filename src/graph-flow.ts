import {
	groupKeysOf,
	type ProjectCounts,
	type ProjectReport,
} from "./domain.ts";
import type { GroupBy } from "./view-settings.ts";

export const flowGap = { along: 280, across: 148 };
const projectColumnGap = 360;
const projectRowGap = 168;

export type FlowNode = {
	id: string;
	band: string;
};

export type FlowEdge = {
	from: string;
	to: string;
};

export type FlowPlace = {
	x: number;
	y: number;
	band: string;
	row: number;
};

/** Each connected set sits on its own band, and a straight chain keeps one row. */
export function flowPlaces(
	nodes: readonly FlowNode[],
	edges: readonly FlowEdge[],
	gaps: { along: number; across: number } = flowGap,
): Map<string, FlowPlace> {
	const ids = nodes.map((node) => node.id);
	const known = new Set(ids);
	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();
	for (const edge of edges) {
		if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) {
			continue;
		}
		const sources = incoming.get(edge.to) ?? [];
		if (!sources.includes(edge.from)) {
			sources.push(edge.from);
			incoming.set(edge.to, sources);
		}
		const targets = outgoing.get(edge.from) ?? [];
		if (!targets.includes(edge.to)) {
			targets.push(edge.to);
			outgoing.set(edge.from, targets);
		}
	}
	const depth = columnDepth(ids, incoming);
	const touched = new Set<string>([...incoming.keys(), ...outgoing.keys()]);
	const sets = connectedSets(ids, incoming, outgoing);
	const linked = sets.filter((idsInSet) =>
		idsInSet.some((id) => touched.has(id)),
	);
	const loose = sets.filter((idsInSet) =>
		idsInSet.every((id) => !touched.has(id)),
	);
	const bandOf = new Map(nodes.map((node) => [node.id, node.band]));
	const orderInSet = (idsInSet: string[]): string[] =>
		[...idsInSet].sort((left, right) => {
			const byBand = (bandOf.get(left) ?? "").localeCompare(
				bandOf.get(right) ?? "",
			);
			if (byBand !== 0) {
				return byBand;
			}
			const byDepth = (depth.get(left) ?? 0) - (depth.get(right) ?? 0);
			return byDepth !== 0 ? byDepth : left.localeCompare(right);
		});
	const setRank = (idsInSet: string[]): string => {
		const ordered = orderInSet(idsInSet);
		const lead = ordered[0] ?? "";
		return `${bandOf.get(lead) ?? ""}\n${lead}`;
	};
	linked.sort((left, right) => setRank(left).localeCompare(setRank(right)));
	loose.sort((left, right) => setRank(left).localeCompare(setRank(right)));

	const across = new Map<string, number>();
	const bandRow = new Map<string, number>();
	const assign = (idsInSet: string[], cursor: { row: number }): void => {
		const rows = flowRows(idsInSet, incoming, depth);
		const columns = byColumn(orderInSet(idsInSet), depth);
		const columnsInOrder = [...columns.keys()].sort(
			(left, right) => left - right,
		);
		const neighboursOf = (id: string, sweep: "back" | "forward"): string[] =>
			sweep === "back" ? (outgoing.get(id) ?? []) : (incoming.get(id) ?? []);
		const placeColumn = (
			names: string[],
			sweep: "back" | "forward",
			placed: Map<string, number>,
		) => {
			const open = [...names].sort((left, right) => left.localeCompare(right));
			const taken = new Set<number>();
			const claim = (id: string, row: number) => {
				placed.set(id, row);
				taken.add(row);
			};
			while (open.length > 0) {
				let best: { id: string; row: number; index: number } | null = null;
				for (const [index, id] of open.entries()) {
					for (const neighbour of neighboursOf(id, sweep)) {
						const row = placed.get(neighbour);
						if (row === undefined || taken.has(row)) {
							continue;
						}
						if (
							best === null ||
							row < best.row ||
							(row === best.row && id.localeCompare(best.id) < 0)
						) {
							best = { id, row, index };
						}
					}
				}
				if (best !== null) {
					open.splice(best.index, 1);
					claim(best.id, best.row);
					continue;
				}
				const id = open.shift();
				if (id === undefined) {
					break;
				}
				let row = 0;
				while (taken.has(row)) {
					row += 1;
				}
				claim(id, row);
			}
		};
		const bandsInSet = [...new Set(idsInSet.map((id) => bandOf.get(id) ?? ""))];
		bandsInSet.sort((left, right) => left.localeCompare(right));
		let span = 0;
		for (const band of bandsInSet) {
			const inBand = idsInSet.filter((id) => (bandOf.get(id) ?? "") === band);
			const placed = new Map<string, number>();
			for (let pass = 0; pass < 8; pass += 1) {
				for (const column of [...columnsInOrder].reverse()) {
					placeColumn(
						(columns.get(column) ?? []).filter((id) => inBand.includes(id)),
						"back",
						placed,
					);
				}
				for (const column of columnsInOrder) {
					placeColumn(
						(columns.get(column) ?? []).filter((id) => inBand.includes(id)),
						"forward",
						placed,
					);
				}
			}
			const minRow = Math.min(...inBand.map((id) => placed.get(id) ?? 0));
			const local = new Map<string, number>();
			for (const id of inBand) {
				local.set(id, (placed.get(id) ?? 0) - minRow);
			}
			const packed = packRows(local, rows);
			let bandSpan = 0;
			for (const id of inBand) {
				const row = packed.get(id) ?? 0;
				bandRow.set(id, row);
				bandSpan = Math.max(bandSpan, row + 1);
			}
			span = Math.max(span, bandSpan);
		}
		for (const id of idsInSet) {
			across.set(id, (bandRow.get(id) ?? 0) + cursor.row);
		}
		cursor.row += Math.max(span, 1);
	};

	const cursor = { row: 0 };
	for (const idsInSet of linked) {
		assign(idsInSet, cursor);
	}
	if (linked.length > 0 && loose.length > 0) {
		cursor.row += 1;
	}
	placeLoose(loose, bandOf, depth, across, bandRow, cursor);

	const places = new Map<string, FlowPlace>();
	for (const id of ids) {
		places.set(id, {
			x: (depth.get(id) ?? 0) * gaps.along,
			y: (across.get(id) ?? 0) * gaps.across,
			band: bandOf.get(id) ?? "",
			row: bandRow.get(id) ?? 0,
		});
	}
	return places;
}

/** Loose tickets sit after the flows, wrapped in a square-root grid. */
function placeLoose(
	sets: readonly string[][],
	bandOf: Map<string, string>,
	depth: Map<string, number>,
	across: Map<string, number>,
	bandRow: Map<string, number>,
	cursor: { row: number },
): void {
	const byBand = new Map<string, string[]>();
	for (const idsInSet of sets) {
		for (const id of [...idsInSet].sort()) {
			const band = bandOf.get(id) ?? "";
			const ids = byBand.get(band) ?? [];
			ids.push(id);
			byBand.set(band, ids);
		}
	}
	const bands = [...byBand.keys()].sort((left, right) =>
		left.localeCompare(right),
	);
	let row = cursor.row;
	for (const band of bands) {
		const ids = byBand.get(band) ?? [];
		const columns = Math.ceil(Math.sqrt(ids.length));
		const afterFlows = looseStart(band, bandOf, bandRow);
		let span = 0;
		for (const [index, id] of ids.entries()) {
			const local = index % columns;
			depth.set(id, Math.floor(index / columns));
			bandRow.set(id, afterFlows + local);
			across.set(id, row + local);
			span = Math.max(span, local + 1);
		}
		row += span;
	}
	cursor.row = row;
}

function looseStart(
	band: string,
	bandOf: Map<string, string>,
	bandRow: Map<string, number>,
): number {
	let span = 0;
	for (const [id, placed] of bandRow) {
		if ((bandOf.get(id) ?? "") === band) {
			span = Math.max(span, placed + 1);
		}
	}
	return span === 0 ? 0 : span + 1;
}

function columnDepth(
	ids: readonly string[],
	incoming: Map<string, string[]>,
): Map<string, number> {
	const depth = new Map<string, number>();
	const visit = (name: string, seen: Set<string>): number => {
		const known = depth.get(name);
		if (known !== undefined) {
			return known;
		}
		if (seen.has(name)) {
			return 0;
		}
		seen.add(name);
		const sources = incoming.get(name) ?? [];
		const next =
			sources.length === 0
				? 0
				: Math.max(...sources.map((source) => visit(source, seen))) + 1;
		depth.set(name, next);
		return next;
	};
	for (const id of ids) {
		visit(id, new Set());
	}
	return depth;
}

function byColumn(
	ids: readonly string[],
	depth: Map<string, number>,
): Map<number, string[]> {
	const columns = new Map<number, string[]>();
	for (const id of ids) {
		const column = depth.get(id) ?? 0;
		const names = columns.get(column) ?? [];
		names.push(id);
		columns.set(column, names);
	}
	return columns;
}

function sourceRows(
	id: string,
	incoming: Map<string, string[]>,
	assigned: Map<string, number>,
): number[] {
	return (incoming.get(id) ?? []).flatMap((source) => {
		const row = assigned.get(source);
		return row === undefined ? [] : [row];
	});
}

/** Rows of one connected set. A straight chain keeps one row. */
function flowRows(
	ids: readonly string[],
	incoming: Map<string, string[]>,
	depth: Map<string, number>,
): Map<string, number> {
	const byDepth = byColumn(ids, depth);
	const assigned = new Map<string, number>();
	let next = 0;
	const columns = [...byDepth.keys()].sort((left, right) => left - right);
	for (const column of columns) {
		const names = [...(byDepth.get(column) ?? [])].sort((left, right) => {
			const leftRow = Math.min(
				...sourceRows(left, incoming, assigned),
				Number.POSITIVE_INFINITY,
			);
			const rightRow = Math.min(
				...sourceRows(right, incoming, assigned),
				Number.POSITIVE_INFINITY,
			);
			return leftRow === rightRow
				? left.localeCompare(right)
				: leftRow - rightRow;
		});
		const used = new Set<number>();
		for (const id of names) {
			const wanted = sourceRows(id, incoming, assigned);
			let row = wanted[0] ?? next;
			while (used.has(row)) {
				row += 1;
			}
			used.add(row);
			assigned.set(id, row);
			next = Math.max(next, row + 1);
		}
	}
	return assigned;
}

/** Distinct rows of one band become 0..n-1, in the order the band drew them. */
function packRows(
	placed: Map<string, number>,
	drawn: Map<string, number>,
): Map<string, number> {
	const byDrawn = new Map<number, number>();
	for (const [id, row] of placed) {
		const key = drawn.get(id) ?? row;
		const known = byDrawn.get(key);
		byDrawn.set(key, known === undefined ? row : Math.min(known, row));
	}
	const rank = new Map<number, number>();
	for (const [index, key] of [...byDrawn.keys()]
		.sort((left, right) => (byDrawn.get(left) ?? 0) - (byDrawn.get(right) ?? 0))
		.entries()) {
		rank.set(key, index);
	}
	const packed = new Map<string, number>();
	for (const [id, row] of placed) {
		packed.set(id, rank.get(drawn.get(id) ?? row) ?? 0);
	}
	return packed;
}

function connectedSets(
	ids: readonly string[],
	incoming: Map<string, string[]>,
	outgoing: Map<string, string[]>,
): string[][] {
	const neighbours = new Map<string, string[]>();
	const link = (from: string, to: string) => {
		const names = neighbours.get(from) ?? [];
		names.push(to);
		neighbours.set(from, names);
	};
	for (const [target, sources] of incoming) {
		for (const source of sources) {
			link(source, target);
			link(target, source);
		}
	}
	for (const [source, targets] of outgoing) {
		for (const target of targets) {
			link(source, target);
			link(target, source);
		}
	}
	const seen = new Set<string>();
	const sets: string[][] = [];
	for (const id of ids) {
		if (seen.has(id)) {
			continue;
		}
		const set: string[] = [];
		const stack = [id];
		seen.add(id);
		while (stack.length > 0) {
			const current = stack.pop();
			if (current === undefined) {
				continue;
			}
			set.push(current);
			for (const next of neighbours.get(current) ?? []) {
				if (seen.has(next)) {
					continue;
				}
				seen.add(next);
				stack.push(next);
			}
		}
		sets.push(set);
	}
	return sets;
}

export function projectNodeId(project: string, key: string): string {
	return `${project}\n${key.toLowerCase()}`;
}

export function projectFlowPlaces(
	report: ProjectReport,
	groupBy: GroupBy,
	assignees: readonly string[],
): Map<string, FlowPlace> {
	const tickets = graphTickets(report);
	const nodes = tickets.map((ticket) => ({
		id: projectNodeId(ticket.project, ticket.key),
		band: graphBand(ticket, groupBy, assignees),
	}));
	return flowPlaces(nodes, graphEdges(report));
}

export function overviewFlowPlaces(
	projects: ProjectCounts[],
): Map<string, FlowPlace> {
	const names = new Set(projects.map((project) => project.name));
	const nodes = projects.map((project) => ({
		id: project.name,
		band: "",
	}));
	const edges: FlowEdge[] = [];
	for (const project of projects) {
		for (const blocker of project.crossProjectBlockers) {
			if (!names.has(blocker.project) || blocker.project === project.name) {
				continue;
			}
			edges.push({ from: blocker.project, to: project.name });
		}
	}
	return flowPlaces(nodes, edges, {
		along: projectColumnGap,
		across: projectRowGap,
	});
}

export type FlowTicket = {
	key: string;
	title: string;
	project: string;
	outside: boolean;
	tracker?: "github" | "linear";
	workstream?: string;
	workstreamKey?: string;
	theme?: string;
	assignees?: string[];
	blockers: string[];
	outsideBlockers: { project: string; key: string }[];
	blocks: { project: string; key: string }[];
};

export function graphTickets(report: ProjectReport): FlowTicket[] {
	const seen = new Set<string>();
	const outside: FlowTicket[] = [];
	for (const ticket of report.tickets) {
		for (const blocker of [
			...(ticket.outsideBlockers ?? []),
			...(ticket.blocks ?? []),
		]) {
			if (blocker.project.toLowerCase() === report.name.toLowerCase()) {
				continue;
			}
			const id = projectNodeId(blocker.project, blocker.key);
			if (seen.has(id)) {
				continue;
			}
			seen.add(id);
			outside.push({
				key: blocker.key,
				title: blocker.title,
				project: blocker.project,
				outside: true,
				tracker: blocker.tracker,
				blockers: [],
				outsideBlockers: [],
				blocks: [],
			});
		}
	}
	outside.sort((left, right) =>
		`${left.project} ${left.key}`.localeCompare(
			`${right.project} ${right.key}`,
		),
	);
	const local = report.tickets.flatMap((ticket) => {
		if (ticket.key === null) {
			return [];
		}
		return [
			{
				key: ticket.key,
				title: ticket.title,
				project: report.name,
				outside: false,
				tracker: report.tracker,
				...(ticket.workstream === undefined
					? {}
					: { workstream: ticket.workstream }),
				...(ticket.workstreamKey === undefined
					? {}
					: { workstreamKey: ticket.workstreamKey }),
				...(ticket.theme === undefined ? {} : { theme: ticket.theme }),
				...(ticket.assignees === undefined
					? {}
					: { assignees: ticket.assignees }),
				blockers: ticket.blockers,
				outsideBlockers: (ticket.outsideBlockers ?? []).map((blocker) => ({
					project: blocker.project,
					key: blocker.key,
				})),
				blocks: (ticket.blocks ?? []).map((blocked) => ({
					project: blocked.project,
					key: blocked.key,
				})),
			},
		];
	});
	return [...outside, ...local];
}

export const outsideBand = "\u0000outside";

export function bandNames(ticket: FlowTicket, groupBy: GroupBy): string[] {
	if (ticket.outside) {
		return [outsideBand];
	}
	if (groupBy === "none") {
		return [""];
	}
	return groupKeysOf(ticket, groupBy);
}

export function graphBand(
	ticket: FlowTicket,
	groupBy: GroupBy,
	assignees: readonly string[],
): string {
	const names = bandNames(ticket, groupBy);
	if (groupBy !== "assignee" || names.length < 2) {
		return names[0] ?? "";
	}
	const wanted = new Set(
		assignees.flatMap((name) => {
			const trimmed = name.trim().toLowerCase();
			return trimmed === "" ? [] : [trimmed];
		}),
	);
	if (wanted.size === 0) {
		return names[0] ?? "";
	}
	return names.find((name) => wanted.has(name.toLowerCase())) ?? names[0] ?? "";
}

export function graphEdges(report: ProjectReport): FlowEdge[] {
	const local = new Map<string, string>();
	for (const ticket of report.tickets) {
		if (ticket.key !== null) {
			local.set(
				ticket.key.toLowerCase(),
				projectNodeId(report.name, ticket.key),
			);
		}
	}
	const edges: FlowEdge[] = [];
	for (const ticket of report.tickets) {
		if (ticket.key === null) {
			continue;
		}
		const target = projectNodeId(report.name, ticket.key);
		for (const key of ticket.blockers) {
			const source = local.get(key.toLowerCase());
			if (source !== undefined && source !== target) {
				edges.push({ from: source, to: target });
			}
		}
		for (const blocker of ticket.outsideBlockers ?? []) {
			edges.push({
				from: projectNodeId(blocker.project, blocker.key),
				to: target,
			});
		}
		for (const blocked of ticket.blocks ?? []) {
			if (blocked.project.toLowerCase() === report.name.toLowerCase()) {
				continue;
			}
			edges.push({
				from: target,
				to: projectNodeId(blocked.project, blocked.key),
			});
		}
	}
	return edges;
}
