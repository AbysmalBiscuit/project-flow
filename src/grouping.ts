import type {
	OutsideParent,
	ProjectCounts,
	Ticket,
	TicketView,
} from "./domain.ts";
import { noScope, noWorkstream, themeGroupOf } from "./ticket-groups.ts";
import { foldKey, sameTicketKey } from "./ticket-key.ts";

const scopeInTitle = /^(?:[a-z]+)\(([^)]+)\)!?\s*:|^\[([^\]]+)\]/i;

function scopeOf(title: string): string {
	const match = title.match(scopeInTitle);
	const scope = match?.[1] ?? match?.[2];
	if (scope === undefined || scope.trim() === "") {
		return noScope;
	}
	return scope.trim().toLowerCase();
}

type Placed = {
	ticket: Ticket;
	view: TicketView;
	workstream: string;
	workstreamKey: string;
	theme: string;
	themeGroup: string;
};

function parentOf(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): Ticket | undefined {
	const parentKey = ticket.parent;
	if (parentKey === null) {
		return undefined;
	}
	return byKey.get(foldKey(parentKey));
}

function* ancestors(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): Generator<Ticket> {
	const seen = new Set<string>();
	let current = ticket;
	for (;;) {
		const parent = parentOf(current, byKey);
		if (parent === undefined || parent.key === null) {
			return;
		}
		const key = foldKey(parent.key);
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		yield parent;
		current = parent;
	}
}

function rootOf(ticket: Ticket, byKey: Map<string, Ticket>): Ticket {
	let root = ticket;
	for (const parent of ancestors(ticket, byKey)) {
		root = parent;
	}
	return root;
}

function isEpic(ticket: Ticket): boolean {
	return ticket.labels.some((label) => label.toLowerCase() === "epic");
}

function themeOf(
	ticket: Ticket,
	root: Ticket,
	byKey: Map<string, Ticket>,
	parents: ReadonlyMap<string, Ticket[]>,
): string {
	if (isEpic(ticket)) {
		return ticket.title;
	}
	const parent = parentOf(ticket, byKey);
	if (parent !== undefined && isEpic(parent) && parent !== root) {
		return parent.title;
	}
	if (isEpic(root) && root === ticket) {
		return root.title;
	}
	const belowRoot = [...ancestors(ticket, byKey)].find(
		(ancestor) => ancestor !== root,
	);
	if (isEpic(root) && belowRoot !== undefined) {
		return belowRoot.title;
	}
	if (isEpic(root)) {
		return scopeOf(ticket.title);
	}
	if (root !== ticket && root.key !== null) {
		return root.title;
	}
	if (ticket.key !== null && parents.has(foldKey(ticket.key))) {
		return ticket.title;
	}
	return scopeOf(ticket.title);
}

function linearMilestone(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): string | null {
	if (ticket.milestone !== null) {
		return ticket.milestone;
	}
	for (const parent of ancestors(ticket, byKey)) {
		if (parent.milestone !== null) {
			return parent.milestone;
		}
	}
	return null;
}

type Workstream = { label: string; key: string };

const noWorkstreamGroup: Workstream = {
	label: noWorkstream,
	key: noWorkstream,
};

function ownWorkstream(
	ticket: Ticket,
	root: Ticket,
	tracker: ProjectCounts["tracker"],
	byKey: Map<string, Ticket>,
): Workstream | undefined {
	if (tracker === "linear") {
		const milestone = linearMilestone(ticket, byKey);
		return milestone === null
			? undefined
			: { label: milestone, key: milestone };
	}
	if (isEpic(root)) {
		const key = root.key ?? root.title;
		return { label: root.title, key };
	}
	if (ticket.milestone !== null) {
		return { label: ticket.milestone, key: ticket.milestone };
	}
	return undefined;
}

function mostCommon(workstreams: Workstream[]): Workstream | undefined {
	const counts = new Map<string, { workstream: Workstream; count: number }>();
	for (const workstream of workstreams) {
		const known = counts.get(workstream.key);
		counts.set(workstream.key, {
			workstream,
			count: (known?.count ?? 0) + 1,
		});
	}
	let best: { workstream: Workstream; count: number } | undefined;
	for (const entry of counts.values()) {
		if (best === undefined || entry.count > best.count) {
			best = entry;
		}
	}
	return best?.workstream;
}

export function placeTickets(
	tickets: Ticket[],
	views: TicketView[],
	tracker: ProjectCounts["tracker"],
	outsideParents: readonly OutsideParent[] = [],
): Placed[] {
	const byKey = new Map<string, Ticket>();
	for (const ticket of tickets) {
		if (ticket.key !== null) {
			byKey.set(foldKey(ticket.key), ticket);
		}
	}
	const parents = new Map<string, Ticket[]>();
	for (const ticket of tickets) {
		const parent = parentOf(ticket, byKey);
		if (parent?.key !== null && parent?.key !== undefined) {
			const key = foldKey(parent.key);
			const known = parents.get(key);
			if (known === undefined) {
				parents.set(key, [ticket]);
			} else {
				known.push(ticket);
			}
		}
	}
	const owned = new Map(
		tickets.map((ticket) => [
			ticket,
			ownWorkstream(ticket, rootOf(ticket, byKey), tracker, byKey),
		]),
	);
	const subTicketsOf = (ticket: Ticket): Ticket[] =>
		ticket.key === null ? [] : (parents.get(foldKey(ticket.key)) ?? []);
	const treeWorkstream = (root: Ticket): Workstream | undefined => {
		const seen = new Set<Ticket>([root]);
		const pending = [root];
		for (
			let ticket = pending.pop();
			ticket !== undefined;
			ticket = pending.pop()
		) {
			for (const sub of subTicketsOf(ticket)) {
				if (!seen.has(sub)) {
					seen.add(sub);
					pending.push(sub);
				}
			}
		}
		return mostCommon(
			tickets.flatMap((ticket) =>
				seen.has(ticket) ? (owned.get(ticket) ?? []) : [],
			),
		);
	};
	const outsideWorkstream = (root: Ticket): Workstream | undefined => {
		const key = root.parent;
		if (tracker !== "github" || key === null) {
			return undefined;
		}
		const outside = outsideParents.find((parent) =>
			sameTicketKey(parent.key, key),
		);
		return outside === undefined
			? undefined
			: { label: outside.title, key: outside.key };
	};
	const rootWorkstreams = new Map<Ticket, Workstream>();
	const rootWorkstream = (root: Ticket): Workstream => {
		const known = rootWorkstreams.get(root);
		if (known !== undefined) {
			return known;
		}
		const workstream =
			outsideWorkstream(root) ??
			treeWorkstream(root) ??
			(tracker === "github" &&
			root.key !== null &&
			subTicketsOf(root).length > 0
				? { label: root.title, key: root.key }
				: noWorkstreamGroup);
		rootWorkstreams.set(root, workstream);
		return workstream;
	};
	// A ticket with no workstream of its own shares the workstream of its top
	// parent, so one tree of tickets stays in one group.
	const workstreamOf = (ticket: Ticket): Workstream =>
		owned.get(ticket) ?? rootWorkstream(rootOf(ticket, byKey));
	return tickets.flatMap((ticket, index) => {
		const view = views[index];
		if (view === undefined) {
			return [];
		}
		const root = rootOf(ticket, byKey);
		const workstream = workstreamOf(ticket);
		const theme = themeOf(ticket, root, byKey, parents);
		return [
			{
				ticket,
				view,
				workstream: workstream.label,
				workstreamKey: workstream.key,
				theme,
				themeGroup: themeGroupOf(workstream.label, theme),
			},
		];
	});
}
