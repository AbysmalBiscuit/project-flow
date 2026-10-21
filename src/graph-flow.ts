import {
	groupKeysOf,
	type ProjectCounts,
	type ProjectReport,
	type TicketState,
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
	done?: boolean;
};

export type FlowPlace = {
	x: number;
	y: number;
	band: string;
	row: number;
};

type Sweep = "back" | "forward";

type FlowAdjacency = {
	incoming: Map<string, string[]>;
	outgoing: Map<string, string[]>;
};

type FlowCursor = { row: number };

type ColumnClaim = { id: string; row: number; index: number };

/** Each connected set sits on its own band, and a straight chain keeps one row. */
export function flowPlaces(
	nodes: readonly FlowNode[],
	edges: readonly FlowEdge[],
	gaps: { along: number; across: number } = flowGap,
): Map<string, FlowPlace> {
	const ids = nodes.map((node) => node.id);
	const links = keptEdges(ids, edges);
	const depth = columnDepth(ids, links.incoming);
	const bandOf = new Map(nodes.map((node) => [node.id, node.band]));
	const { linked, loose } = splitSets(ids, links);
	const rank = (idsInSet: string[]): string => setRank(idsInSet, bandOf, depth);
	linked.sort((left, right) => rank(left).localeCompare(rank(right)));
	loose.sort((left, right) => rank(left).localeCompare(rank(right)));

	const across = new Map<string, number>();
	const bandRow = new Map<string, number>();
	const cursor: FlowCursor = { row: 0 };
	for (const idsInSet of linked) {
		assign(idsInSet, cursor, links, depth, bandOf, across, bandRow);
	}
	separateLoose(cursor, linked.length, loose.length);
	placeLoose(loose, bandOf, depth, across, bandRow, cursor);
	return placeMap(ids, depth, across, bandOf, bandRow, gaps);
}

function keptEdges(
	ids: readonly string[],
	edges: readonly FlowEdge[],
): FlowAdjacency {
	const known = new Set(ids);
	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();
	for (const edge of edges) {
		rememberEdge(edge, known, incoming, outgoing);
	}
	return { incoming, outgoing };
}

function rememberEdge(
	edge: FlowEdge,
	known: Set<string>,
	incoming: Map<string, string[]>,
	outgoing: Map<string, string[]>,
): void {
	if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) {
		return;
	}
	pushUnique(incoming, edge.to, edge.from);
	pushUnique(outgoing, edge.from, edge.to);
}

function pushUnique(
	links: Map<string, string[]>,
	key: string,
	value: string,
): void {
	const names = links.get(key) ?? [];
	if (!names.includes(value)) {
		names.push(value);
		links.set(key, names);
	}
}

function splitSets(
	ids: readonly string[],
	links: FlowAdjacency,
): { linked: string[][]; loose: string[][] } {
	const touched = touchedIds(links);
	const sets = connectedSets(ids, links.incoming, links.outgoing);
	return {
		linked: sets.filter((idsInSet) => setTouches(idsInSet, touched)),
		loose: sets.filter((idsInSet) => !setTouches(idsInSet, touched)),
	};
}

function touchedIds(links: FlowAdjacency): Set<string> {
	return new Set<string>([...links.incoming.keys(), ...links.outgoing.keys()]);
}

function setTouches(
	idsInSet: readonly string[],
	touched: Set<string>,
): boolean {
	return idsInSet.some((id) => touched.has(id));
}

function orderInSet(
	idsInSet: readonly string[],
	bandOf: Map<string, string>,
	depth: Map<string, number>,
): string[] {
	return [...idsInSet].sort((left, right) =>
		compareInSet(left, right, bandOf, depth),
	);
}

function compareInSet(
	left: string,
	right: string,
	bandOf: Map<string, string>,
	depth: Map<string, number>,
): number {
	const byBand = (bandOf.get(left) ?? "").localeCompare(
		bandOf.get(right) ?? "",
	);
	if (byBand !== 0) {
		return byBand;
	}
	const byDepth = (depth.get(left) ?? 0) - (depth.get(right) ?? 0);
	return byDepth !== 0 ? byDepth : left.localeCompare(right);
}

function setRank(
	idsInSet: readonly string[],
	bandOf: Map<string, string>,
	depth: Map<string, number>,
): string {
	const ordered = orderInSet(idsInSet, bandOf, depth);
	const lead = ordered[0] ?? "";
	return `${bandOf.get(lead) ?? ""}\n${lead}`;
}

function assign(
	idsInSet: readonly string[],
	cursor: FlowCursor,
	links: FlowAdjacency,
	depth: Map<string, number>,
	bandOf: Map<string, string>,
	across: Map<string, number>,
	bandRow: Map<string, number>,
): void {
	const rows = flowRows(idsInSet, links.incoming, depth);
	const columns = byColumn(orderInSet(idsInSet, bandOf, depth), depth);
	const columnsInOrder = [...columns.keys()].sort(
		(left, right) => left - right,
	);
	let span = 0;
	for (const band of bandsOf(idsInSet, bandOf)) {
		span = Math.max(
			span,
			assignBand(
				idsInSet,
				band,
				bandOf,
				columns,
				columnsInOrder,
				links,
				rows,
				bandRow,
			),
		);
	}
	offsetAcross(idsInSet, across, bandRow, cursor.row);
	cursor.row += Math.max(span, 1);
}

function bandsOf(
	idsInSet: readonly string[],
	bandOf: Map<string, string>,
): string[] {
	const bands = [...new Set(idsInSet.map((id) => bandOf.get(id) ?? ""))];
	bands.sort((left, right) => left.localeCompare(right));
	return bands;
}

function assignBand(
	idsInSet: readonly string[],
	band: string,
	bandOf: Map<string, string>,
	columns: Map<number, string[]>,
	columnsInOrder: readonly number[],
	links: FlowAdjacency,
	rows: Map<string, number>,
	bandRow: Map<string, number>,
): number {
	const inBand = idsInSet.filter((id) => (bandOf.get(id) ?? "") === band);
	const placed = sweepBand(inBand, columns, columnsInOrder, links);
	const packed = packRows(shiftRows(inBand, placed), rows);
	return writeBandRows(inBand, packed, bandRow);
}

function sweepBand(
	inBand: readonly string[],
	columns: Map<number, string[]>,
	columnsInOrder: readonly number[],
	links: FlowAdjacency,
): Map<string, number> {
	const placed = new Map<string, number>();
	for (let pass = 0; pass < 8; pass += 1) {
		sweepPass(inBand, columns, columnsInOrder, links, placed);
	}
	return placed;
}

function sweepPass(
	inBand: readonly string[],
	columns: Map<number, string[]>,
	columnsInOrder: readonly number[],
	links: FlowAdjacency,
	placed: Map<string, number>,
): void {
	for (const column of [...columnsInOrder].reverse()) {
		placeColumn(columnNames(columns, column, inBand), "back", links, placed);
	}
	for (const column of columnsInOrder) {
		placeColumn(columnNames(columns, column, inBand), "forward", links, placed);
	}
}

function columnNames(
	columns: Map<number, string[]>,
	column: number,
	inBand: readonly string[],
): string[] {
	return (columns.get(column) ?? []).filter((id) => inBand.includes(id));
}

function shiftRows(
	inBand: readonly string[],
	placed: Map<string, number>,
): Map<string, number> {
	const minRow = Math.min(...inBand.map((id) => placed.get(id) ?? 0));
	const local = new Map<string, number>();
	for (const id of inBand) {
		local.set(id, (placed.get(id) ?? 0) - minRow);
	}
	return local;
}

function writeBandRows(
	inBand: readonly string[],
	packed: Map<string, number>,
	bandRow: Map<string, number>,
): number {
	let bandSpan = 0;
	for (const id of inBand) {
		const row = packed.get(id) ?? 0;
		bandRow.set(id, row);
		bandSpan = Math.max(bandSpan, row + 1);
	}
	return bandSpan;
}

function offsetAcross(
	idsInSet: readonly string[],
	across: Map<string, number>,
	bandRow: Map<string, number>,
	start: number,
): void {
	for (const id of idsInSet) {
		across.set(id, (bandRow.get(id) ?? 0) + start);
	}
}

function separateLoose(
	cursor: FlowCursor,
	linkedCount: number,
	looseCount: number,
): void {
	if (linkedCount > 0 && looseCount > 0) {
		cursor.row += 1;
	}
}

function placeColumn(
	names: readonly string[],
	sweep: Sweep,
	links: FlowAdjacency,
	placed: Map<string, number>,
): void {
	const open = [...names].sort((left, right) => left.localeCompare(right));
	const taken = new Set<number>();
	while (open.length > 0) {
		claimNext(open, sweep, links, placed, taken);
	}
}

function claimNext(
	open: string[],
	sweep: Sweep,
	links: FlowAdjacency,
	placed: Map<string, number>,
	taken: Set<number>,
): void {
	const best = bestClaim(open, sweep, links, placed, taken);
	if (best !== null) {
		open.splice(best.index, 1);
		claim(placed, taken, best.id, best.row);
		return;
	}
	claimOpen(open, placed, taken);
}

function bestClaim(
	open: readonly string[],
	sweep: Sweep,
	links: FlowAdjacency,
	placed: Map<string, number>,
	taken: Set<number>,
): ColumnClaim | null {
	let best: ColumnClaim | null = null;
	for (const [index, id] of open.entries()) {
		best = betterClaim(best, index, id, sweep, links, placed, taken);
	}
	return best;
}

function betterClaim(
	best: ColumnClaim | null,
	index: number,
	id: string,
	sweep: Sweep,
	links: FlowAdjacency,
	placed: Map<string, number>,
	taken: Set<number>,
): ColumnClaim | null {
	for (const neighbour of neighboursOf(id, sweep, links)) {
		const row = freeRow(neighbour, placed, taken);
		if (row !== undefined && claimBeats(id, row, best)) {
			best = { id, row, index };
		}
	}
	return best;
}

function neighboursOf(
	id: string,
	sweep: Sweep,
	links: FlowAdjacency,
): string[] {
	return sweep === "back"
		? (links.outgoing.get(id) ?? [])
		: (links.incoming.get(id) ?? []);
}

function freeRow(
	neighbour: string,
	placed: Map<string, number>,
	taken: Set<number>,
): number | undefined {
	const row = placed.get(neighbour);
	if (row === undefined || taken.has(row)) {
		return undefined;
	}
	return row;
}

function claimBeats(
	id: string,
	row: number,
	best: ColumnClaim | null,
): boolean {
	if (best === null || row < best.row) {
		return true;
	}
	return row === best.row && id.localeCompare(best.id) < 0;
}

function claimOpen(
	open: string[],
	placed: Map<string, number>,
	taken: Set<number>,
): void {
	const id = open.shift();
	if (id === undefined) {
		return;
	}
	claim(placed, taken, id, firstFree(taken));
}

function firstFree(taken: Set<number>): number {
	let row = 0;
	while (taken.has(row)) {
		row += 1;
	}
	return row;
}

function claim(
	placed: Map<string, number>,
	taken: Set<number>,
	id: string,
	row: number,
): void {
	placed.set(id, row);
	taken.add(row);
}

function placeMap(
	ids: readonly string[],
	depth: Map<string, number>,
	across: Map<string, number>,
	bandOf: Map<string, string>,
	bandRow: Map<string, number>,
	gaps: { along: number; across: number },
): Map<string, FlowPlace> {
	const places = new Map<string, FlowPlace>();
	for (const id of ids) {
		places.set(id, flowPlace(id, depth, across, bandOf, bandRow, gaps));
	}
	return places;
}

function flowPlace(
	id: string,
	depth: Map<string, number>,
	across: Map<string, number>,
	bandOf: Map<string, string>,
	bandRow: Map<string, number>,
	gaps: { along: number; across: number },
): FlowPlace {
	return {
		x: (depth.get(id) ?? 0) * gaps.along,
		y: (across.get(id) ?? 0) * gaps.across,
		band: bandOf.get(id) ?? "",
		row: bandRow.get(id) ?? 0,
	};
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
	const neighbours = undirectedLinks(incoming, outgoing);
	const seen = new Set<string>();
	const sets: string[][] = [];
	for (const id of ids) {
		const set = walkSet(id, neighbours, seen);
		if (set.length > 0) {
			sets.push(set);
		}
	}
	return sets;
}

function undirectedLinks(
	incoming: Map<string, string[]>,
	outgoing: Map<string, string[]>,
): Map<string, string[]> {
	const neighbours = new Map<string, string[]>();
	linkBothWays(neighbours, incoming);
	linkBothWays(neighbours, outgoing);
	return neighbours;
}

function linkBothWays(
	neighbours: Map<string, string[]>,
	links: Map<string, string[]>,
): void {
	for (const [target, sources] of links) {
		for (const source of sources) {
			pushLink(neighbours, source, target);
			pushLink(neighbours, target, source);
		}
	}
}

function pushLink(
	neighbours: Map<string, string[]>,
	from: string,
	to: string,
): void {
	const names = neighbours.get(from) ?? [];
	names.push(to);
	neighbours.set(from, names);
}

function walkSet(
	id: string,
	neighbours: Map<string, string[]>,
	seen: Set<string>,
): string[] {
	if (seen.has(id)) {
		return [];
	}
	const set: string[] = [];
	const stack = [id];
	seen.add(id);
	while (stack.length > 0) {
		takeNext(stack, neighbours, seen, set);
	}
	return set;
}

function takeNext(
	stack: string[],
	neighbours: Map<string, string[]>,
	seen: Set<string>,
	set: string[],
): void {
	const current = stack.pop();
	if (current === undefined) {
		return;
	}
	set.push(current);
	pushUnseen(stack, neighbours.get(current) ?? [], seen);
}

function pushUnseen(
	stack: string[],
	nextIds: readonly string[],
	seen: Set<string>,
): void {
	for (const next of nextIds) {
		if (seen.has(next)) {
			continue;
		}
		seen.add(next);
		stack.push(next);
	}
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
	state?: TicketState;
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
	for (const link of report.graphLinks) {
		for (const end of [link.from, link.to]) {
			if (end.project.toLowerCase() === report.name.toLowerCase()) {
				continue;
			}
			const id = projectNodeId(end.project, end.key);
			if (seen.has(id)) {
				continue;
			}
			seen.add(id);
			outside.push({
				key: end.key,
				title: end.title,
				project: end.project,
				outside: true,
				...(end.state === undefined ? {} : { state: end.state }),
				tracker: end.tracker,
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
	const local = report.graphTickets.flatMap((ticket) => {
		if (ticket.key === null) {
			return [];
		}
		return [
			{
				key: ticket.key,
				title: ticket.title,
				project: report.name,
				outside: false,
				state: ticket.state,
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
	return report.graphLinks.map((link) => ({
		from: projectNodeId(link.from.project, link.from.key),
		to: projectNodeId(link.to.project, link.to.key),
		done: link.done,
	}));
}
