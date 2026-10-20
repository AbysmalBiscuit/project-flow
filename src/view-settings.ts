export const defaultDoneAgeDays = 2;

export const openViews = ["board", "graph", "table"] as const;

export const graphDirections = ["left-to-right", "top-to-bottom"] as const;

export const emptyMaxAgeDays: Record<string, number> = {};

export const defaultOpenView = "board" as const;

export const defaultGraphDirection = "left-to-right" as const;

type ViewFields = {
	maxAgeDays: Record<string, number>;
	needsYouOnly: boolean;
	blockedOnly: boolean;
	assignees: string[];
	search: string;
	openView: (typeof openViews)[number];
	graphDirection: (typeof graphDirections)[number];
	shownLanes?: string[] | undefined;
};

export function projectViewKey(
	views: Record<string, unknown>,
	name: string,
): string | undefined {
	return Object.keys(views).find(
		(key) => key.toLowerCase() === name.toLowerCase(),
	);
}

export function savedProjectView<T extends ViewFields>(
	views: Record<string, T>,
	name: string,
): T {
	const key = projectViewKey(views, name);
	const saved = key === undefined ? undefined : views[key];
	return {
		maxAgeDays: emptyMaxAgeDays,
		needsYouOnly: false,
		blockedOnly: false,
		assignees: [],
		search: "",
		openView: defaultOpenView,
		graphDirection: defaultGraphDirection,
		...saved,
	} as T;
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
