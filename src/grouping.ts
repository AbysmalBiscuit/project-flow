import type {
	GroupKey,
	OutsideParent,
	ProjectCounts,
	Ticket,
	TicketView,
} from "./domain.ts";
import { foldKey, outsideKey, sameTicketKey, shortKey } from "./ticket-key.ts";
import type { GroupBy } from "./view-settings.ts";

const noScope = "no scope";

const noWorkstream = "no workstream";

const noAssignee = "no assignee";

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

type GroupedTicket = {
	key: string | null;
	title: string;
	workstream?: string;
	workstreamKey?: string;
	themeGroup?: string;
	assignees?: string[];
};

function themeGroupOf(workstream: string, theme: string): string {
	return workstream === theme ? theme : `${workstream} / ${theme}`;
}

export function groupKeysOf(view: GroupedTicket, key: GroupKey): string[] {
	return groupBandsOf(view, key).map((band) => band.key);
}

export function groupLabelOf(
	view: GroupedTicket,
	key: GroupKey,
	band: string,
): string {
	return (
		groupBandsOf(view, key).find((item) => item.key === band)?.label ?? band
	);
}

function groupBandsOf(
	view: GroupedTicket,
	key: GroupKey,
): { key: string; label: string }[] {
	if (key === "assignee") {
		const names = [
			...new Set(
				(view.assignees ?? []).flatMap((name) => {
					const trimmed = name.trim();
					return trimmed === "" ? [] : [trimmed];
				}),
			),
		];
		const bands = names.length === 0 ? [noAssignee] : names;
		return bands.map((name) => ({ key: name, label: name }));
	}
	if (key === "workstream") {
		const label = view.workstream ?? noWorkstream;
		return [{ key: view.workstreamKey ?? label, label }];
	}
	const label = view.themeGroup ?? themeGroupOf(noWorkstream, noScope);
	return [{ key: label, label }];
}

export function ticketGroups<T extends GroupedTicket>(
	tickets: readonly T[],
	key: GroupBy,
): { name: string; label: string; tickets: T[] }[] {
	if (key === "none") {
		return [{ name: "", label: "", tickets: [...tickets] }];
	}
	const order: string[] = [];
	const labels = new Map<string, string>();
	const members = new Map<string, T[]>();
	for (const ticket of tickets) {
		for (const band of groupBandsOf(ticket, key)) {
			const known = members.get(band.key);
			if (known === undefined) {
				order.push(band.key);
				labels.set(band.key, band.label);
				members.set(band.key, [ticket]);
				continue;
			}
			known.push(ticket);
		}
	}
	return order
		.sort((left, right) =>
			(labels.get(left) ?? left).localeCompare(labels.get(right) ?? right),
		)
		.flatMap((name) => {
			const grouped = members.get(name);
			return grouped === undefined
				? []
				: [{ name, label: labels.get(name) ?? name, tickets: grouped }];
		});
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

/** The chip that names a parent ticket: an outside parent, else a ticket of the project. */
export function parentChip(
	outsideParents: OutsideParent[],
	key: string,
): { label: string; outside?: OutsideParent } {
	const outside = outsideParents.find((parent) =>
		sameTicketKey(parent.key, key),
	);
	if (outside !== undefined) {
		return { label: outsideKey(outside.project, outside.key), outside };
	}
	return { label: shortKey(key) };
}
