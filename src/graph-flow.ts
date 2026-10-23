import {
	groupKeysOf,
	type ProjectReport,
	type TicketState,
	type TicketView,
} from "./domain.ts";
import { foldKey, itemId } from "./ticket-key.ts";
import type { GroupBy } from "./view-settings.ts";

export const flowGap = { along: 280, across: 148 };

export type FlowGap = typeof flowGap;

export type FlowEdge = {
	from: string;
	to: string;
	done?: boolean;
};

export function projectNodeId(project: string, key: string): string {
	return itemId(project, key);
}

/** The server's ticket view, placed in its project on the graph. */
export type FlowTicket = Omit<TicketView, "key" | "state"> & {
	key: string;
	state?: TicketState;
	project: string;
	outside: boolean;
	tracker: "github" | "linear";
};

function homeTicket(
	homes: readonly ProjectReport[],
	project: string,
	key: string,
): TicketView | undefined {
	return homes
		.find((home) => home.name.toLowerCase() === project.toLowerCase())
		?.tickets.find((ticket) => foldKey(ticket.key) === foldKey(key));
}

/**
 * The tickets the project graph shows. With `withParents`, the hidden parent
 * tickets and the outside parent tickets that head the frames of shown
 * sub-tickets come last. An outside ticket carries its view from the report
 * of its own project in `homes`, when that report holds it.
 */
export function graphTickets(
	report: ProjectReport,
	withParents = false,
	homes: readonly ProjectReport[] = [],
): FlowTicket[] {
	const parents = new Map(
		report.outsideParents.map((parent) => [
			projectNodeId(parent.project, parent.key),
			parent,
		]),
	);
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
			const parent = parents.get(id);
			const home = homeTicket(homes, end.project, end.key);
			const state = end.state ?? parent?.state ?? home?.state;
			outside.push({
				blockers: [],
				...home,
				key: end.key,
				title: parent?.title ?? end.title,
				project: end.project,
				outside: true,
				...(state === undefined ? {} : { state }),
				tracker: end.tracker,
			});
		}
	}
	outside.sort((left, right) =>
		itemId(left.project, left.key).localeCompare(
			itemId(right.project, right.key),
		),
	);
	const outsideParents = (withParents ? [...parents] : []).flatMap(
		([id, parent]): FlowTicket[] => {
			if (seen.has(id)) {
				return [];
			}
			const home = homeTicket(homes, parent.project, parent.key);
			const state = parent.state ?? home?.state;
			return [
				{
					blockers: [],
					...home,
					key: parent.key,
					title: parent.title,
					project: parent.project,
					outside: true,
					...(state === undefined ? {} : { state }),
					tracker: parent.tracker,
				},
			];
		},
	);
	const local = [
		...report.graphTickets,
		...(withParents ? report.graphParents : []),
	].flatMap((ticket) =>
		ticket.key === null
			? []
			: [
					{
						...ticket,
						key: ticket.key,
						project: report.name,
						outside: false,
						tracker: report.tracker,
					},
				],
	);
	return [...outside, ...local, ...outsideParents];
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
