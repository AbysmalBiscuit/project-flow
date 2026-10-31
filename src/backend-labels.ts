import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import type {
	BackendView,
	BackendViews,
	ForgeKind,
	TrackerKind,
} from "./domain.ts";
import { pageQuery } from "./queries.ts";

/** One row per backend kind: each tracker, then each forge that no tracker row shows. */
export function backendRows({
	trackers,
	forges,
}: BackendViews): BackendView<TrackerKind | ForgeKind>[] {
	const shown = new Set<string>(trackers.map((tracker) => tracker.kind));
	return [...trackers, ...forges.filter((forge) => !shown.has(forge.kind))];
}

/** The label of a tracker kind. The kind stands in until the settings read answers. */
export function useTrackerLabel(): (kind: TrackerKind) => string {
	const trackers = useQuery(pageQuery.settings).data?.trackers;
	return useCallback(
		(kind) => trackers?.find((tracker) => tracker.kind === kind)?.label ?? kind,
		[trackers],
	);
}
