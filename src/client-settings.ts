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
		return null;
	}
	const body: unknown = await response.json();
	if (body === null || typeof body !== "object") {
		return null;
	}
	return body as SettingsRead;
}

export async function writeSettings(next: Configuration): Promise<boolean> {
	const response = await fetch("/api/settings", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(next),
	});
	return response.ok;
}
