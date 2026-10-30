import { blockerProject, type TicketGraph } from "./blockers.ts";
import type {
	FocusLink,
	GraphEnd,
	GraphLink,
	ProjectReport,
	ShownGraphLink,
	Ticket,
	TicketRef,
	TicketRelation,
	TicketState,
	TicketView,
	TrackerKind,
} from "./domain.ts";
import {
	asRef,
	known,
	mergeBlockedBy,
	parseKey,
	sameRef,
	stillOpen,
} from "./ticket-index.ts";
import {
	foldKey,
	itemId,
	linkId,
	sameTicketKey,
	ticketId,
} from "./ticket-key.ts";

function outsideOf(
	blocker: Ticket,
	ref: TicketRef | undefined,
	graph: TicketGraph,
): TicketRelation | null {
	if (blocker.key === null) {
		return null;
	}
	const project = blockerProject(blocker, ref, graph);
	if (project === "") {
		return null;
	}
	return {
		tracker: blocker.tracker,
		project,
		key: blocker.key,
		title: blocker.title.trim() || blocker.key,
	};
}

function graphLinks(ticket: Ticket, graph: TicketGraph): GraphLink[] {
	const { index, parsed } = graph;
	const self = asRef(ticket);
	const home = graph.homes.get(ticket);
	const merged = self === null ? undefined : known(index, self);
	const incoming = mergeBlockedBy([
		merged?.blockedBy ?? ticket.blockedBy,
		parsed.get(parseKey(ticket))?.blockedBy ?? [],
	]);
	const links: GraphLink[] = [];
	const push = (ref: TicketRef, source: Ticket | undefined) => {
		if (
			links.some((item) => sameTicketKey(item.key, ref.key)) ||
			(self !== null && sameRef(self, ref))
		) {
			return;
		}
		const other = source ?? known(index, ref);
		const done =
			other?.state === "open"
				? false
				: ref.state === "closed" ||
					(other !== undefined
						? true
						: ref.state !== undefined && ref.state !== "open");
		const project =
			other === undefined ? "" : blockerProject(other, ref, graph);
		const outside =
			other === undefined ||
			project === "" ||
			home === undefined ||
			project.toLowerCase() === home.toLowerCase()
				? undefined
				: outsideOf(other, ref, graph);
		links.push({
			key: ref.key,
			done,
			...(outside === null || outside === undefined ? {} : { outside }),
		});
	};
	for (const ref of incoming) {
		push(ref, known(index, ref));
	}
	if (self !== null) {
		const selfId = ticketId(self.tracker, self.key);
		for (const other of graph.bodyBlocks.get(selfId) ?? []) {
			const ref = asRef(other);
			if (ref !== null) {
				push(ref, other);
			}
		}
		for (const { ticket: other } of graph.trackerBlocks.get(selfId) ?? []) {
			const ref = asRef(other);
			if (other !== ticket && ref !== null) {
				push(ref, other);
			}
		}
	}
	return links;
}

export function ticketRelations(
	ticket: Ticket,
	blockers: Ticket[],
	graph: TicketGraph,
): {
	blockers: string[];
	blockedBy: TicketRelation[];
	links: GraphLink[];
	outsideBlockers: TicketRelation[];
	blocks: TicketRelation[];
} {
	const { index, parsed } = graph;
	const self = asRef(ticket);
	const home = graph.homes.get(ticket);
	const merged = self === null ? undefined : known(index, self);
	const incoming = [
		...(merged?.blockedBy ?? ticket.blockedBy),
		...(parsed.get(parseKey(ticket))?.blockedBy ?? []),
	];
	const keys: string[] = [];
	const blockedBy: TicketRelation[] = [];
	const outsideBlockers: TicketRelation[] = [];
	for (const blocker of blockers) {
		if (blocker.key === null) {
			continue;
		}
		keys.push(blocker.key);
		const source = incoming.find(
			(ref) =>
				ref.tracker === blocker.tracker &&
				foldKey(ref.key) === foldKey(blocker.key),
		);
		const project = blockerProject(blocker, source, graph) || home || "";
		if (project === "") {
			continue;
		}
		const relation: TicketRelation = {
			tracker: blocker.tracker,
			project,
			key: blocker.key,
			title: blocker.title.trim() || blocker.key,
		};
		blockedBy.push(relation);
		if (home !== undefined && project.toLowerCase() !== home.toLowerCase()) {
			outsideBlockers.push(relation);
		}
	}
	const blocks: TicketRelation[] = [];
	const ownBlocks = mergeBlockedBy([
		parsed.get(parseKey(ticket))?.blocks ?? [],
		merged?.blocks ?? ticket.blocks ?? [],
	]);
	const pushBlock = (ref: TicketRef, project: string, title: string) => {
		if (
			project === "" ||
			home === undefined ||
			blocks.some((item) => sameRef(item, ref))
		) {
			return;
		}
		blocks.push({
			tracker: ref.tracker,
			project,
			key: ref.key,
			title,
		});
	};
	if (self !== null) {
		for (const ref of ownBlocks) {
			if (ticket.state === "open" && !stillOpen(ref, index)) {
				continue;
			}
			const other = known(index, ref);
			const otherHome =
				other === undefined ? undefined : graph.homes.get(other);
			const project = otherHome ?? (ref.projectName?.trim() || ref.project);
			const title = other?.title.trim() || ref.title?.trim() || ref.key;
			pushBlock(ref, project, title);
		}
	}
	if (self !== null && ticket.state === "open" && stillOpen(self, index)) {
		for (const { ticket: other, project } of graph.blockedBy.get(
			ticketId(self.tracker, self.key),
		) ?? []) {
			const otherRef = asRef(other);
			if (
				other.state !== "open" ||
				otherRef === null ||
				other === ticket ||
				blocks.some((item) => sameRef(item, otherRef))
			) {
				continue;
			}
			pushBlock(otherRef, project, other.title.trim() || otherRef.key);
		}
	}
	return {
		blockers: keys,
		blockedBy,
		links: graphLinks(ticket, graph),
		outsideBlockers,
		blocks,
	};
}

function linkedDoneKeys(
	name: string,
	relationsByKey: Map<string, ReturnType<typeof ticketRelations>>,
): Set<string> {
	const linked = new Set<string>();
	for (const [key, relations] of relationsByKey) {
		if (relations.blocks.length > 0) {
			linked.add(key);
		}
		for (const link of relations.links) {
			if (link.outside === undefined) {
				linked.add(foldKey(link.key));
			}
		}
		for (const blocked of relations.blocks) {
			if (blocked.project.toLowerCase() === name.toLowerCase()) {
				linked.add(foldKey(blocked.key));
			}
		}
	}
	return linked;
}

function stateByKey(reports: ProjectReport[]): Map<string, TicketState> {
	const states = new Map<string, TicketState>();
	for (const report of reports) {
		for (const ticket of report.tickets) {
			if (ticket.key === null) {
				continue;
			}
			states.set(itemId(report.name.toLowerCase(), ticket.key), ticket.state);
		}
	}
	return states;
}

function withEndStates(
	links: ShownGraphLink[],
	states: Map<string, TicketState>,
): ShownGraphLink[] {
	const end = (item: GraphEnd): GraphEnd => {
		if (item.state !== undefined) {
			return item;
		}
		const state = states.get(itemId(item.project.toLowerCase(), item.key));
		return state === undefined ? item : { ...item, state };
	};
	return links.map((link) => ({
		...link,
		from: end(link.from),
		to: end(link.to),
	}));
}

export function shownGraph(
	name: string,
	tracker: TrackerKind,
	views: TicketView[],
	relationsByKey: Map<string, ReturnType<typeof ticketRelations>>,
): { tickets: TicketView[]; links: ShownGraphLink[] } {
	const withKey = views.filter(
		(view): view is TicketView & { key: string } => view.key !== null,
	);
	const openKeys = new Set(
		withKey.flatMap((view) =>
			view.state === "done" ? [] : [foldKey(view.key)],
		),
	);
	const linked = linkedDoneKeys(name, relationsByKey);
	const doneOnly = (view: TicketView & { key: string }) =>
		view.state === "done" && !openKeys.has(foldKey(view.key));
	const linkedShown = new Set(
		withKey.filter((view) =>
			view.state === "done"
				? doneOnly(view) && linked.has(foldKey(view.key))
				: true,
		),
	);
	const parentOf = new Map(
		withKey.map((view) => [foldKey(view.key), foldKey(view.parent)] as const),
	);
	const framed = new Set<string>();
	for (const view of linkedShown) {
		let parent = foldKey(view.parent);
		while (parent !== undefined && !framed.has(parent)) {
			framed.add(parent);
			parent = parentOf.get(parent);
		}
	}
	const shown = withKey.filter((view) => {
		const parent = foldKey(view.parent);
		return (
			linkedShown.has(view) ||
			(doneOnly(view) && parent !== undefined && framed.has(parent))
		);
	});
	const local = new Map(
		shown.map((view) => [foldKey(view.key), view] as const),
	);
	const links: ShownGraphLink[] = [];
	const seen = new Set<string>();
	const endOf = (
		project: string,
		key: string,
		title: string,
		tracker: TrackerKind,
		state?: TicketState,
	): GraphEnd => ({
		project,
		key,
		tracker,
		title,
		...(state === undefined ? {} : { state }),
	});
	const push = (from: GraphEnd, to: GraphEnd, done: boolean) => {
		if (
			from.project.toLowerCase() === to.project.toLowerCase() &&
			sameTicketKey(from.key, to.key)
		) {
			return;
		}
		const id = linkId(
			itemId(from.project.toLowerCase(), from.key),
			itemId(to.project.toLowerCase(), to.key),
		);
		if (seen.has(id)) {
			return;
		}
		seen.add(id);
		links.push({ from, to, done });
	};
	for (const view of shown) {
		const relations = relationsByKey.get(foldKey(view.key));
		if (relations === undefined) {
			continue;
		}
		const target = endOf(name, view.key, view.title, tracker, view.state);
		for (const link of relations.links) {
			const outside = link.outside;
			const holder = local.get(foldKey(link.key));
			const source =
				outside === undefined
					? endOf(
							name,
							link.key,
							holder?.title ?? link.key,
							tracker,
							holder?.state,
						)
					: endOf(outside.project, outside.key, outside.title, outside.tracker);
			const onGraph = outside !== undefined || holder !== undefined;
			if (onGraph) {
				push(source, target, link.done);
			}
		}
		for (const blocked of relations.blocks) {
			if (blocked.project.toLowerCase() === name.toLowerCase()) {
				continue;
			}
			push(
				target,
				endOf(blocked.project, blocked.key, blocked.title, blocked.tracker),
				view.state === "done",
			);
		}
	}
	return { tickets: shown, links };
}

export function attachGraphStates(reports: ProjectReport[]): ProjectReport[] {
	const states = stateByKey(reports);
	return reports.map((report) => ({
		...report,
		graphLinks: withEndStates(report.graphLinks, states),
	}));
}

/** The focused ids plus every id upstream or downstream of them through the links. */
export function focusChain(
	seeds: ReadonlySet<string>,
	links: readonly FocusLink[],
): ReadonlySet<string> {
	const chain = new Set(seeds);
	const walk = (next: (id: string) => string[]) => {
		const queue = [...seeds];
		const seen = new Set(seeds);
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			for (const other of next(id)) {
				if (!seen.has(other)) {
					seen.add(other);
					chain.add(other);
					queue.push(other);
				}
			}
		}
	};
	walk((id) => links.filter((link) => link.to === id).map((link) => link.from));
	walk((id) => links.filter((link) => link.from === id).map((link) => link.to));
	return chain;
}
