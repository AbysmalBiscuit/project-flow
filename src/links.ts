import { blockerProject } from "./blockers.ts";
import type {
	FocusLink,
	GraphEnd,
	GraphLink,
	ProjectReport,
	PullRequest,
	ShownGraphLink,
	Ticket,
	TicketRef,
	TicketRelation,
	TicketState,
	TicketView,
	Tracker,
} from "./domain.ts";
import {
	asRef,
	known,
	mergeBlockedBy,
	type ParsedBodies,
	parseKey,
	sameRef,
	stillOpen,
	type TicketIndex,
} from "./ticket-index.ts";
import {
	foldKey,
	githubKey,
	itemId,
	keyNumber,
	keyTracker,
	linearKey,
	linkId,
	sameTicketKey,
} from "./ticket-key.ts";

const closing =
	/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)|#(\d+)|([A-Za-z][A-Za-z0-9]*)-(\d+))\b/gi;

function closingKeys(body: string, repo: string): string[] {
	const keys: string[] = [];
	for (const match of body.matchAll(closing)) {
		const namedRepo = match[1];
		const namedNumber = match[2];
		const bareNumber = match[3];
		const team = match[4];
		const linearNumber = match[5];
		const key =
			namedRepo !== undefined && namedNumber !== undefined
				? githubKey(namedRepo, namedNumber)
				: bareNumber !== undefined
					? githubKey(repo, bareNumber)
					: team !== undefined && linearNumber !== undefined
						? linearKey(team, linearNumber)
						: null;
		if (key !== null && !keys.includes(key)) {
			keys.push(key);
		}
	}
	return keys;
}

export function branchLinksTicket(branch: string, key: string): boolean {
	const number = keyNumber(key);
	const leading = branch.match(/^(?:[^/]+\/)?(\d+)-/)?.[1];
	if (leading !== undefined) {
		return number !== null && leading === number;
	}
	return keyTracker(key) === "github" && foldKey(branch).includes(foldKey(key));
}

export function linked(ticket: Ticket, pulls: PullRequest[]): PullRequest[] {
	if (ticket.key === null) {
		return [];
	}
	const key = ticket.key;
	return pulls.filter((pull) => {
		const keys = [...pull.closingKeys, ...closingKeys(pull.body, pull.repo)];
		return (
			keys.some((item) => sameTicketKey(item, key)) ||
			branchLinksTicket(pull.branch, key)
		);
	});
}

function outsideOf(
	blocker: Ticket,
	ref: TicketRef | undefined,
	groups: { project: string; tickets: Ticket[] }[],
): TicketRelation | null {
	if (blocker.key === null) {
		return null;
	}
	const project = blockerProject(blocker, ref, groups);
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

function graphLinks(
	ticket: Ticket,
	index: TicketIndex,
	parsed: ParsedBodies,
	groups: { project: string; tickets: Ticket[] }[],
): GraphLink[] {
	const self = asRef(ticket);
	const home = groups.find((group) => group.tickets.includes(ticket))?.project;
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
			other === undefined ? "" : blockerProject(other, ref, groups);
		const outside =
			other === undefined ||
			project === "" ||
			home === undefined ||
			project.toLowerCase() === home.toLowerCase()
				? undefined
				: outsideOf(other, ref, groups);
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
		for (const [otherKey, lines] of parsed) {
			if (!lines.blocks.some((ref) => sameRef(ref, self))) {
				continue;
			}
			const other = index.get(otherKey);
			const ref = other === undefined ? null : asRef(other);
			if (ref !== null) {
				push(ref, other);
			}
		}
		for (const group of groups) {
			for (const other of group.tickets) {
				if (other === ticket) {
					continue;
				}
				const native = other.blocks ?? [];
				if (!native.some((ref) => sameRef(ref, self))) {
					continue;
				}
				const ref = asRef(other);
				if (ref !== null) {
					push(ref, other);
				}
			}
		}
	}
	return links;
}

export function ticketRelations(
	ticket: Ticket,
	blockers: Ticket[],
	index: TicketIndex,
	parsed: ParsedBodies,
	groups: { project: string; tickets: Ticket[] }[],
): {
	blockers: string[];
	blockedBy: TicketRelation[];
	links: GraphLink[];
	outsideBlockers: TicketRelation[];
	blocks: TicketRelation[];
} {
	const self = asRef(ticket);
	const home = groups.find((group) => group.tickets.includes(ticket))?.project;
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
		const project = blockerProject(blocker, source, groups) || home || "";
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
				other === undefined
					? undefined
					: groups.find((group) => group.tickets.includes(other))?.project;
			const project = otherHome ?? (ref.projectName?.trim() || ref.project);
			const title = other?.title.trim() || ref.title?.trim() || ref.key;
			pushBlock(ref, project, title);
		}
	}
	if (self !== null && ticket.state === "open") {
		for (const group of groups) {
			for (const other of group.tickets) {
				const otherRef = asRef(other);
				if (
					other.state !== "open" ||
					otherRef === null ||
					other === ticket ||
					blocks.some((item) => sameRef(item, otherRef))
				) {
					continue;
				}
				const refs = [
					...other.blockedBy,
					...(parsed.get(parseKey(other))?.blockedBy ?? []),
				];
				if (!refs.some((ref) => sameRef(ref, self) && stillOpen(self, index))) {
					continue;
				}
				pushBlock(otherRef, group.project, other.title.trim() || otherRef.key);
			}
		}
	}
	return {
		blockers: keys,
		blockedBy,
		links: graphLinks(ticket, index, parsed, groups),
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
	tracker: Tracker,
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
	const shown = withKey.filter((view) => {
		const key = foldKey(view.key);
		return view.state !== "done" || (!openKeys.has(key) && linked.has(key));
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
		tracker: Tracker,
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

export function closesTicket(pull: PullRequest, ticket: Ticket): boolean {
	const key = ticket.key;
	if (key === null || !pull.merged) {
		return false;
	}
	return closingKeys(pull.body, pull.repo).some((item) =>
		sameTicketKey(item, key),
	);
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
