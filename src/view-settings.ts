import type { ProjectViewSettings } from "./configuration.ts";

export const defaultDoneAgeDays = 2;

export const pageViews = ["board", "graph", "table"] as const;

export const openViews = ["board", "graph", "table", "last"] as const;

export const graphDirections = ["left-to-right", "top-to-bottom"] as const;

export type GraphDirection = (typeof graphDirections)[number];

export const graphLayouts = ["layered", "force"] as const;

export type GraphLayoutKind = (typeof graphLayouts)[number];

export const groupByKeys = ["workstream", "theme", "assignee", "none"] as const;

export type GroupBy = (typeof groupByKeys)[number];

export const emptyMaxAgeDays: Record<string, number> = {};

export const defaultOpenView = "last" as const;

export const defaultGraphDirection = "left-to-right" as const;

export const defaultGraphLayout = "layered" as const;

export const defaultGroupBy = "none" as const;

export const defaultGraphGroupBy = "workstream" as const;

export function projectViewKey(
	views: Record<string, unknown>,
	name: string,
): string | undefined {
	return Object.keys(views).find(
		(key) => key.toLowerCase() === name.toLowerCase(),
	);
}

export function viewDefaults(): ProjectViewSettings {
	return {
		maxAgeDays: {},
		needsYouOnly: false,
		blockedOnly: false,
		assignees: [],
		search: "",
		openView: defaultOpenView,
		graphDirection: defaultGraphDirection,
		graphLayout: defaultGraphLayout,
	};
}

export function openedView(
	settings: ProjectViewSettings,
): (typeof pageViews)[number] {
	if (settings.openView !== undefined && settings.openView !== "last") {
		return settings.openView;
	}
	return settings.lastView ?? "board";
}

export function savedProjectView(
	views: Record<string, ProjectViewSettings>,
	name: string,
): ProjectViewSettings {
	const starKey = projectViewKey(views, "*");
	const star = starKey === undefined ? undefined : views[starKey];
	const key = projectViewKey(views, name);
	const saved = key === undefined || key === starKey ? undefined : views[key];
	const {
		groupBy: starGroupBy,
		openView: starOpenView,
		lastView: starLastView,
		...starRest
	} = star ?? {};
	const {
		groupBy: savedGroupBy,
		openView: savedOpenView,
		lastView: savedLastView,
		...savedRest
	} = saved ?? {};
	const groupBy = savedGroupBy ?? starGroupBy;
	const openView = savedOpenView ?? starOpenView ?? defaultOpenView;
	const lastView = savedLastView ?? starLastView;
	return {
		...viewDefaults(),
		...starRest,
		...savedRest,
		openView,
		...(lastView === undefined ? {} : { lastView }),
		...(groupBy === undefined ? {} : { groupBy }),
	};
}

export function groupByWasSaved(
	views: Record<string, unknown>,
	name: string,
): boolean {
	const starKey = projectViewKey(views, "*");
	const key = projectViewKey(views, name);
	const chosen = key !== undefined && key !== starKey ? key : starKey;
	if (chosen === undefined) {
		return false;
	}
	const stored = views[chosen];
	return (
		stored !== null &&
		typeof stored === "object" &&
		Object.hasOwn(stored, "groupBy")
	);
}

type LaneRef = { name: string; statusType: string };

export function visibleLaneNames(
	lanes: readonly LaneRef[],
	shownLanes: readonly string[] | undefined,
): string[] {
	if (shownLanes !== undefined) {
		return lanes.flatMap((lane) =>
			shownLanes.some((name) => name.toLowerCase() === lane.name.toLowerCase())
				? [lane.name]
				: [],
		);
	}
	return lanes.flatMap((lane) =>
		lane.statusType === "dropped" ? [] : [lane.name],
	);
}

export function laneAgeCap(
	maxAgeDays: Record<string, number>,
	lane: string,
	statusType: string | undefined,
): number {
	if (Object.hasOwn(maxAgeDays, lane)) {
		return maxAgeDays[lane] ?? 0;
	}
	return statusType === "done" ? defaultDoneAgeDays : 0;
}
