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

/** The label of the forge whose home host or declared host serves `url`, or undefined. */
export function useForgeLabel(url: string | undefined): string | undefined {
	const settings = useQuery(pageQuery.settings).data;
	const host = url === undefined ? undefined : URL.parse(url)?.hostname;
	if (host === undefined || settings === null || settings === undefined) {
		return undefined;
	}
	const forges = settings.forges ?? [];
	const kind =
		forges.find((forge) => forge.host === host)?.kind ??
		settings.hosts.find((declared) => declared.host === host)?.forge;
	return forges.find((forge) => forge.kind === kind)?.label;
}
