import type { Configuration, ProjectViewSettings } from "./configuration.ts";
import type { ProjectReport, TicketView } from "./domain.ts";
import type { HidingFilter } from "./terms.ts";
import { foldKey } from "./ticket-key.ts";
import {
	laneAgeCap,
	savedProjectView,
	visibleLaneNames,
} from "./view-settings.ts";

/** The hidden parent tickets above the shown graph tickets, up to each top parent ticket. */
export function graphParentsOf(
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

/**
 * A ticket has a run when its card shows the run mark. With several runs,
 * the ticket matches when any of its runs matches every run filter. With
 * latest run only, just the run that its card shows can match.
 */
function matchesRunFilters(
	item: TicketView,
	view: ProjectViewSettings,
	factories: Set<string>,
): boolean {
	const filtering =
		view.withRunsOnly ||
		view.runStatuses.length > 0 ||
		view.runResults.length > 0 ||
		factories.size > 0;
	if (!filtering) {
		return true;
	}
	if (item.factoryRun?.coveredByFeed !== true) {
		return false;
	}
	const runs = view.latestRunOnly
		? [item.factoryRun]
		: [item.factoryRun, ...(item.earlierFactoryRuns ?? [])];
	return runs.some(
		(run) =>
			(view.runStatuses.length === 0 ||
				view.runStatuses.includes(run.statusKind)) &&
			(view.runResults.length === 0 ||
				(run.result !== undefined && view.runResults.includes(run.result))) &&
			(factories.size === 0 || factories.has(run.factory.toLowerCase())),
	);
}

function matchesProjectView(
	item: TicketView,
	view: ProjectViewSettings,
	shown: Set<string>,
	wanted: Set<string>,
	factories: Set<string>,
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
	if (!matchesRunFilters(item, view, factories)) {
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
	const factories = new Set(
		view.runFactories.map((name) => name.trim().toLowerCase()),
	);
	factories.delete("");
	const needle = view.search.trim().toLowerCase();
	const kept = report.tickets.filter((item) =>
		matchesProjectView(item, view, shown, wanted, factories, needle, now, true),
	);
	const done = report.doneTickets.filter((item) =>
		matchesProjectView(
			item,
			view,
			shown,
			wanted,
			factories,
			needle,
			now,
			false,
		),
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
	if (view.withRunsOnly) {
		open.push("withRunsOnly");
	}
	if (view.runStatuses.length > 0) {
		open.push("runStatuses");
	}
	if (view.runResults.length > 0) {
		open.push("runResults");
	}
	if (view.runFactories.some((name) => name.trim() !== "")) {
		open.push("runFactories");
	}
	return open;
}
