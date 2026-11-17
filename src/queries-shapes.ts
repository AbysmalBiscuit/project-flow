import type { SettingsRead } from "./client-settings.ts";
import type { Configuration } from "./configuration.ts";
import type { BackendViews, SettingsProject } from "./domain.ts";
import type { FactoryEntry } from "./factories.ts";
import type { FactoryTokenReport } from "./factory-tokens.ts";
import type { StateSource } from "./settings-write.ts";

export type SettingsPage = {
	settings: Configuration;
	projects: SettingsProject[];
	discoveryErrors: string[];
	backends: BackendViews;
	factoryTokenReports: FactoryTokenReport[];
	factoryEntries: FactoryEntry[];
	stateSources: StateSource[];
};

export function memoriesPath(repo: string): string {
	return `/api/memories/${repo.split("/").map(encodeURIComponent).join("/")}`;
}

export function memoryPath(repo: string, memoryId: string): string {
	return `${memoriesPath(repo)}/${encodeURIComponent(memoryId)}`;
}

export function configurationOf(
	body: SettingsRead | null,
): Configuration | null {
	if (body === null) {
		return null;
	}
	const {
		trackers: _trackers,
		forges: _forges,
		switches: _switches,
		hints: _hints,
		projects: _projects,
		discoveryErrors: _discoveryErrors,
		factoryEntries: _factoryEntries,
		stateSources: _stateSources,
		error: _error,
		...configuration
	} = body;
	return configuration;
}

export function settingsPageOf(body: SettingsRead | null): SettingsPage {
	if (body === null) {
		throw new Error("settings failed");
	}
	return {
		backends: {
			trackers: body.trackers ?? [],
			forges: body.forges ?? [],
			switches: body.switches ?? [],
			hints: body.hints ?? { runStart: "", laneMappings: "" },
		},
		projects: body.projects ?? [],
		discoveryErrors: body.discoveryErrors ?? [],
		factoryTokenReports: body.factoryTokenReports ?? [],
		factoryEntries: body.factoryEntries ?? [],
		stateSources: body.stateSources ?? [],
		settings: configurationOf(body) ?? body,
	};
}
