import type { useTrackerLabel } from "./backend-labels.ts";
import type { CrossProjectBlocker, Overview, ProjectCounts } from "./domain.ts";
import type { OverviewView } from "./overview-view.ts";
import { outsideKey } from "./ticket-key.ts";

export function blockerTicket(blocker: CrossProjectBlocker): string {
	return outsideKey(blocker.project, blocker.key);
}

type FilterKey = OverviewView["filter"];
export type SortKey = OverviewView["sort"];
export type SortDirection = OverviewView["direction"];

function matchesFilter(project: ProjectCounts, filter: FilterKey): boolean {
	if (filter === "needs-you") {
		return project.needsYou > 0;
	}
	if (filter === "blocked") {
		return project.blocked > 0 || project.crossProjectBlockers.length > 0;
	}
	return true;
}

function matchesSearch(project: ProjectCounts, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") {
		return true;
	}
	const haystack = [
		project.name,
		...project.tags,
		...project.unlinkedPrs.map((pull) => pull.title),
		...project.crossProjectBlockers.map(
			(blocker) => `${blocker.project} ${blocker.key} ${blocker.title}`,
		),
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle);
}

export type TrackerLabel = ReturnType<typeof useTrackerLabel>;

function sortValue(
	project: ProjectCounts,
	key: SortKey,
	trackerLabel: TrackerLabel,
): number | string {
	if (key === "project") {
		return project.name;
	}
	if (key === "tracker") {
		return trackerLabel(project.tracker);
	}
	if (key === "progress") {
		return project.progress;
	}
	if (key === "backlog") {
		return project.statusTypes.backlog;
	}
	if (key === "inProgress") {
		return project.statusTypes.inProgress;
	}
	if (key === "inReview") {
		return project.statusTypes.inReview;
	}
	if (key === "awaitingMerge") {
		return project.statusTypes.awaitingMerge;
	}
	if (key === "needsYou") {
		return project.needsYou;
	}
	return project.crossProjectBlockers.map(blockerTicket).join(" ");
}

export function sortDirectionFor(
	current: SortKey,
	next: SortKey,
	direction: SortDirection,
): SortDirection {
	if (current === next) {
		return direction;
	}
	if (next === "needsYou" || next === "blockedBy") {
		return "desc";
	}
	return "asc";
}

function sortProjects(
	projects: ProjectCounts[],
	key: SortKey,
	direction: SortDirection,
	trackerLabel: TrackerLabel,
): ProjectCounts[] {
	return [...projects].sort((left, right) => {
		const leftValue = sortValue(left, key, trackerLabel);
		const rightValue = sortValue(right, key, trackerLabel);
		const delta =
			typeof leftValue === "string" || typeof rightValue === "string"
				? String(leftValue).localeCompare(String(rightValue))
				: leftValue - rightValue;
		if (delta !== 0) {
			return direction === "asc" ? delta : -delta;
		}
		return left.name.localeCompare(right.name);
	});
}

export function shownProjects(
	overview: Overview,
	view: OverviewView,
	query: string,
	trackerLabel: TrackerLabel,
): ProjectCounts[] {
	return sortProjects(
		overview.projects.filter(
			(project) =>
				matchesFilter(project, view.filter) && matchesSearch(project, query),
		),
		view.sort,
		view.direction,
		trackerLabel,
	);
}
