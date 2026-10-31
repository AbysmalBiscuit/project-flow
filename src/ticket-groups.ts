import type { GroupKey, OutsideParent } from "./domain.ts";
import { outsideKey, sameTicketKey, shortKey } from "./ticket-key.ts";
import type { GroupBy } from "./view-settings.ts";

export const noScope = "no scope";

export const noWorkstream = "no workstream";

const noAssignee = "no assignee";

type GroupedTicket = {
	key: string | null;
	title: string;
	workstream?: string;
	workstreamKey?: string;
	themeGroup?: string;
	assignees?: string[];
};

export function themeGroupOf(workstream: string, theme: string): string {
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
