import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { SettingsRead } from "./client-settings.ts";
import type { Configuration } from "./configuration.ts";
import { pageQueryClient } from "./queries-client.ts";
import { pageQuery } from "./queries-page.ts";
import {
	configurationOf,
	type SettingsPage,
	settingsPageOf,
} from "./queries-shapes.ts";

type SettingsWrite = Configuration & {
	baselineTracked?: Configuration["tracked"];
	baselinePinnedProjects?: Configuration["pinnedProjects"];
};

export type SettingsPatch = (current: Configuration) => SettingsWrite;

/** The configuration of a save, without the baselines that only the server reads. */
function savedFields({
	baselineTracked: _tracked,
	baselinePinnedProjects: _pins,
	...settings
}: SettingsWrite): Configuration {
	return settings;
}

function writeSettingsCache(patch: SettingsPatch): void {
	const key = pageQuery.settings.queryKey;
	const cached = pageQueryClient.getQueryData(key);
	const current = cached === undefined ? null : configurationOf(cached);
	if (cached === undefined || cached === null || current === null) {
		return;
	}
	// The write keeps the fetch time, so a seeded cache still refetches.
	const updatedAt = pageQueryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
	pageQueryClient.setQueryData(
		key,
		{ ...cached, ...savedFields(patch(current)) },
		{ updatedAt },
	);
}

export const saveSettingsKey = ["save-settings"];

// Optimistic patches whose saves have not settled, in click order.
const optimisticPatches = new Set<SettingsPatch>();

export function useSaveSettings({
	refetchProjects = true,
	optimistic = false,
} = {}) {
	const queries = useQueryClient();
	return useMutation({
		mutationKey: saveSettingsKey,
		// Each save sends the whole configuration, so saves run in click order.
		scope: { id: "save-settings" },
		onMutate: (patch) => {
			if (optimistic) {
				optimisticPatches.add(patch);
				writeSettingsCache(patch);
			}
		},
		// The patch reads the settings when its turn comes, so it keeps the
		// choices that earlier saves wrote to the cache.
		mutationFn: async (patch: SettingsPatch): Promise<SettingsPage> => {
			const loaded = await queries.ensureQueryData(pageQuery.settings);
			const base = settingsPageOf(loaded).settings;
			const next = {
				...patch(base),
				baselineShowNeedsYou: base.overview.showNeedsYou,
			};
			const response = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(next),
			});
			const body = (await response.json().catch(() => null)) as
				(SettingsRead & { error?: string }) | null;
			if (!response.ok) {
				throw new Error(body?.error ?? `save failed (HTTP ${response.status})`);
			}
			if (body === null) {
				throw new Error("save failed");
			}
			return settingsPageOf(body);
		},
		onSuccess: (saved, patch) => {
			// The saved configuration is the new base, and queued optimistic
			// choices stay on top of it until their own saves land.
			let settings = saved.settings;
			for (const queued of optimisticPatches) {
				if (queued !== patch) {
					settings = { ...settings, ...savedFields(queued(settings)) };
				}
			}
			const written: SettingsRead = {
				...settings,
				...saved.backends,
				projects: saved.projects,
				factoryTokenReports: saved.factoryTokenReports,
			};
			queries.setQueryData(pageQuery.settings.queryKey, written);
			if (refetchProjects) {
				void queries.invalidateQueries({ queryKey: ["project"] });
			}
		},
		onSettled: (_saved, _error, patch) => {
			optimisticPatches.delete(patch);
		},
	});
}
