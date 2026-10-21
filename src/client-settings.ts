import type { Configuration } from "./configuration.ts";
import type { SettingsProject } from "./domain.ts";

export type SettingsRead = Configuration & {
	trackers?: { github: boolean; linear: boolean } | undefined;
	projects?: SettingsProject[] | undefined;
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
