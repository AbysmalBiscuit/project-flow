import type { Configuration, ProjectViewSettings } from "./configuration.ts";
import type {
	Lane,
	LiveRun,
	NeedsYouItem,
	OutsideParent,
	ProjectBody,
	ProjectReport,
	PullRequest,
	ReportSection,
	Ticket,
	TicketView,
} from "./domain.ts";
import { placeTickets } from "./grouping.ts";
import { shownGraph, type ticketRelations } from "./links.ts";
import type { HidingFilter } from "./terms.ts";
import { foldKey, pullKey } from "./ticket-key.ts";
import {
	laneAgeCap,
	savedProjectView,
	visibleLaneNames,
} from "./view-settings.ts";

/** The hidden parent tickets above the shown graph tickets, up to each top parent ticket. */
function graphParentsOf(
	graphTickets: readonly TicketView[],
	tickets: readonly TicketView[],
): TicketView[] {
	const byKey = new Map(
		tickets.flatMap((ticket) =>
			ticket.key === null ? [] : [[foldKey(ticket.key), ticket] as const],
		),
	);
	const shown = new Set(
		graphTickets.flatMap((ticket) =>
			ticket.key === null ? [] : [foldKey(ticket.key)],
		),
	);
	const found = new Map<string, TicketView>();
	for (const ticket of graphTickets) {
		let parent = foldKey(ticket.parent);
		while (parent !== undefined && !shown.has(parent) && !found.has(parent)) {
			const view = byKey.get(parent);
			if (view === undefined) {
				break;
			}
			found.set(parent, view);
			parent = foldKey(view.parent);
		}
	}
	return [...found.values()];
}

function summaryLine(counts: ProjectBody): string {
	return `${counts.name}: ${counts.done} done, ${counts.dropped} dropped, ${counts.blocked} blocked, ${counts.inProgress} in progress, ${counts.backlog} backlog.`;
}

export function projectReport(
	counts: ProjectBody,
	tickets: Ticket[],
	lanes: Lane[],
	relationsByKey: Map<string, ReturnType<typeof ticketRelations>> = new Map(),
	pullByKey: Map<string, PullRequest> = new Map(),
	needs: NeedsYouItem[] = [],
	runByKey: Map<string, LiveRun> = new Map(),
	outsideParents: OutsideParent[] = [],
): ProjectReport {
	const placed = placeTickets(tickets, counts.tickets, counts.tracker);
	const ticketsByKey = new Map(
		tickets.flatMap((ticket) =>
			ticket.key === null ? [] : [[ticket.key, ticket]],
		),
	);
	const inFlight = [
		...counts.tickets.filter((ticket) => {
			if (
				ticket.state === "inProgress" ||
				ticket.state === "inReview" ||
				ticket.state === "awaitingMerge"
			) {
				return true;
			}
			const source =
				ticket.key === null ? undefined : ticketsByKey.get(ticket.key);
			return (
				source?.state === "open" &&
				(ticket.state === "done" || ticket.state === "dropped")
			);
		}),
		...counts.unlinkedPrs.map((pull) => ({
			key: pullKey(pull),
			title: pull.title,
			state: "inProgress" as const,
			blockers: [],
		})),
	];
	const backlog = counts.tickets.filter((ticket) => ticket.state === "backlog");
	const sections: ReportSection[] = [
		{ id: "summary", title: "Summary", text: summaryLine(counts) },
		{ id: "inFlight", title: "In flight", items: inFlight },
		{
			id: "needsYou",
			title: "Needs you",
			needsYou: needs,
		},
		{ id: "backlog", title: "Backlog", items: backlog },
	];
	const needsKeys = new Set(needs.map((item) => foldKey(item.key)));
	const placedByKey = new Map(
		placed.flatMap((item) =>
			item.ticket.key === null
				? []
				: [[foldKey(item.ticket.key), item] as const],
		),
	);
	const boardTickets = counts.tickets.map((view) => {
		const relations =
			view.key === null ? undefined : relationsByKey.get(foldKey(view.key));
		const pull =
			view.key === null ? undefined : pullByKey.get(foldKey(view.key));
		const commentRun =
			view.key === null ? undefined : runByKey.get(foldKey(view.key));
		const placedItem =
			view.key === null ? undefined : placedByKey.get(foldKey(view.key));
		return {
			...view,
			...(placedItem === undefined
				? {}
				: {
						workstream: placedItem.workstream,
						workstreamKey: placedItem.workstreamKey,
						theme: placedItem.theme,
						themeGroup: placedItem.themeGroup,
					}),
			...(commentRun === undefined ? {} : { run: commentRun }),
			...(relations === undefined
				? {}
				: { blockers: relations.blockers, blockedBy: relations.blockedBy }),
			...(relations === undefined || relations.links.length === 0
				? {}
				: { links: relations.links }),
			...(relations === undefined || relations.outsideBlockers.length === 0
				? {}
				: { outsideBlockers: relations.outsideBlockers }),
			...(relations === undefined || relations.blocks.length === 0
				? {}
				: { blocks: relations.blocks }),
			...(pull === undefined ? {} : { pull: pullKey(pull), pullUrl: pull.url }),
			...(view.key !== null && needsKeys.has(foldKey(view.key))
				? { needsYou: true as const }
				: {}),
		};
	});
	const doneTickets = boardTickets.filter(
		(ticket) => ticket.statusType === "done",
	);
	const graph = shownGraph(
		counts.name,
		counts.tracker,
		boardTickets,
		relationsByKey,
	);
	return {
		name: counts.name,
		tracker: counts.tracker,
		lanes,
		tickets: boardTickets,
		sections,
		done: counts.done,
		total: counts.tickets.length,
		doneTickets,
		graphTickets: graph.tickets,
		graphLinks: graph.links,
		graphParents: graphParentsOf(graph.tickets, boardTickets),
		outsideParents,
	};
}

const dayMs = 24 * 60 * 60 * 1000;

export function projectViewFor(
	configuration: Configuration,
	name: string,
): ProjectViewSettings {
	return savedProjectView(configuration.projectViews, name);
}

function ageDays(entered: string | undefined, now: Date): number {
	const at = Date.parse(entered ?? "");
	if (Number.isNaN(at)) {
		return 0;
	}
	return (now.getTime() - at) / dayMs;
}

function matchesProjectView(
	item: TicketView,
	view: ProjectViewSettings,
	shown: Set<string>,
	wanted: Set<string>,
	needle: string,
	now: Date,
	applyAge: boolean,
): boolean {
	const lane = (item.lane ?? "").toLowerCase();
	if (!shown.has(lane)) {
		return false;
	}
	const names = (item.assignees ?? []).map((name) => name.toLowerCase());
	if (wanted.size > 0 && !names.some((name) => wanted.has(name))) {
		return false;
	}
	if (view.needsYouOnly && item.needsYou !== true) {
		return false;
	}
	if (view.blockedOnly && item.blocked !== true) {
		return false;
	}
	if (applyAge) {
		const cap = laneAgeCap(view.maxAgeDays, item.lane ?? "", item.statusType);
		if (cap > 0 && ageDays(item.enteredStateAt, now) > cap) {
			return false;
		}
	}
	if (needle === "") {
		return true;
	}
	const key = foldKey(item.key) ?? "";
	return key.includes(needle) || item.title.toLowerCase().includes(needle);
}

export function filterProjectReport(
	report: ProjectReport,
	view: ProjectViewSettings,
	now: Date,
): ProjectReport {
	const shown = new Set(
		visibleLaneNames(report.lanes, view.shownLanes).map((name) =>
			name.toLowerCase(),
		),
	);
	const wanted = new Set(
		view.assignees.flatMap((name) => {
			const trimmed = name.trim().toLowerCase();
			return trimmed === "" ? [] : [trimmed];
		}),
	);
	const needle = view.search.trim().toLowerCase();
	const kept = report.tickets.filter((item) =>
		matchesProjectView(item, view, shown, wanted, needle, now, true),
	);
	const done = report.doneTickets.filter((item) =>
		matchesProjectView(item, view, shown, wanted, needle, now, false),
	);
	const keptKeys = new Set(
		kept.flatMap((item) => (item.key === null ? [] : [foldKey(item.key)])),
	);
	const localKey = (end: { project: string; key: string }): string | null =>
		end.project.toLowerCase() === report.name.toLowerCase()
			? foldKey(end.key)
			: null;
	const graphLinks = report.graphLinks.filter((link) => {
		const from = localKey(link.from);
		const to = localKey(link.to);
		const fromShown = from === null || keptKeys.has(from);
		const toShown = to === null || keptKeys.has(to);
		return fromShown && toShown;
	});
	const graphTickets = report.graphTickets.filter((ticket) => {
		const key = foldKey(ticket.key);
		return key !== undefined && keptKeys.has(key);
	});
	const hiddenBy = kept.length === 0 ? hidingFilters(report, view, shown) : [];
	return {
		...report,
		tickets: kept,
		doneTickets: done,
		graphTickets,
		graphLinks,
		graphParents: graphParentsOf(graphTickets, report.tickets),
		...(hiddenBy.length === 0 ? {} : { hiddenBy }),
	};
}

function hidingFilters(
	report: ProjectReport,
	view: ProjectViewSettings,
	shown: Set<string>,
): HidingFilter[] {
	if (report.tickets.length === 0) {
		return [];
	}
	const open: HidingFilter[] = [];
	if (view.shownLanes !== undefined && shown.size < report.lanes.length) {
		open.push("lanes");
	}
	const aged = report.tickets.some((item) => {
		const cap = laneAgeCap(view.maxAgeDays, item.lane ?? "", item.statusType);
		return cap > 0;
	});
	if (aged) {
		open.push("maxAge");
	}
	if (view.needsYouOnly) {
		open.push("needsYouOnly");
	}
	if (view.blockedOnly) {
		open.push("blockedOnly");
	}
	if (view.assignees.some((name) => name.trim() !== "")) {
		open.push("assignees");
	}
	if (view.search.trim() !== "") {
		open.push("search");
	}
	return open;
}
