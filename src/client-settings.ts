import type { Configuration } from "./configuration.ts";
import type { BackendViews, SettingsProject } from "./domain.ts";
import type { FactoryEntry } from "./factories.ts";
import type { FactoryTokenReport } from "./factory-tokens.ts";
import type { StateSource } from "./settings-write.ts";

export type SettingsRead = Configuration &
	Partial<BackendViews> & {
		projects?: SettingsProject[] | undefined;
		factoryTokenReports?: FactoryTokenReport[] | undefined;
		factoryEntries?: FactoryEntry[] | undefined;
		stateSources?: StateSource[] | undefined;
		error?: string | undefined;
	};

export async function readSettings(): Promise<SettingsRead | null> {
	const response = await fetch("/api/settings");
	if (!response.ok) {
		throw new Error(`settings unavailable (HTTP ${response.status})`);
	}
	const body: unknown = await response.json();
	if (body === null || typeof body !== "object") {
		return null;
	}
	return body as SettingsRead;
}
