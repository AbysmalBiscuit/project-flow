import { z } from "zod";
import type { Configuration } from "./configuration.ts";
import {
	parseConfiguration,
	projectRef as projectRefSchema,
} from "./configuration.ts";
import {
	knownRepos,
	type SettingsProject,
	type SettingsSnapshot,
	samePin,
	settingsProjects,
} from "./domain.ts";
import type { FoundProject } from "./ports.ts";

export function settingsResponse(
	configuration: Configuration,
	credentials: { token: string | null; linearKey: string | null },
	catalogue: FoundProject[],
	snapshots: SettingsSnapshot[],
): Configuration & {
	trackers: { github: boolean; linear: boolean };
	projects: SettingsProject[];
} {
	return {
		...configuration,
		trackers: {
			github: credentials.token !== null,
			linear: credentials.linearKey !== null,
		},
		projects: settingsProjects(configuration, catalogue, snapshots),
	};
}

function withoutTrackers(text: string): string {
	const trimmed = text.trim();
	if (trimmed === "") {
		return text;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return text;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return text;
	}
	const {
		trackers: _trackers,
		projects: _projects,
		baselineTracked: _baselineTracked,
		...configuration
	} = parsed as Record<string, unknown>;
	return JSON.stringify(configuration);
}

function applyRefEdits(
	live: Configuration["tracked"],
	baseline: Configuration["tracked"],
	draft: Configuration["tracked"],
): Configuration["tracked"] {
	const removed = baseline.filter(
		(ref) => !draft.some((item) => samePin(item, ref)),
	);
	const added = draft.filter(
		(ref) => !baseline.some((item) => samePin(item, ref)),
	);
	const kept = live.filter(
		(ref) => !removed.some((item) => samePin(item, ref)),
	);
	return [
		...kept,
		...added.filter((ref) => !kept.some((item) => samePin(item, ref))),
	];
}

const refBaseline = z.object({
	baselineTracked: z.array(z.unknown()).optional(),
});

function refList(value: unknown): Configuration["tracked"] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const refs: Configuration["tracked"] = [];
	for (const item of value) {
		const parsed = projectRefSchema.safeParse(item);
		if (!parsed.success) {
			return undefined;
		}
		refs.push(parsed.data);
	}
	return refs;
}

export function rejectUnknownBotKeys(
	parsed: Configuration,
	live: Configuration,
	snapshots: {
		key: string;
		pulls: { repo: string }[];
	}[],
	catalogue: FoundProject[],
): string | null {
	const known = knownRepos(snapshots, catalogue);
	const previous = new Set(Object.keys(live.expectedBots ?? {}));
	for (const key of Object.keys(parsed.expectedBots ?? {})) {
		if (known.has(key) || previous.has(key)) {
			continue;
		}
		return `invalid configuration: expectedBots.${key}`;
	}
	return null;
}

export function mergedSettingsWrite(
	live: Configuration,
	parsed: Configuration,
	text: string,
): Configuration {
	let raw: unknown = null;
	try {
		raw = JSON.parse(text);
	} catch {
		raw = null;
	}
	const baseline = refBaseline.safeParse(raw);
	const sent = baseline.success ? baseline.data : {};
	const trackedBaseline = refList(sent.baselineTracked);
	return {
		...parsed,
		tracked:
			trackedBaseline === undefined
				? parsed.tracked
				: applyRefEdits(live.tracked, trackedBaseline, parsed.tracked),
	};
}

export function sameTracked(
	before: Configuration["tracked"],
	after: Configuration["tracked"],
): boolean {
	if (before.length !== after.length) {
		return false;
	}
	return before.every((pin, index) => {
		const next = after[index];
		return next !== undefined && samePin(pin, next);
	});
}

export function viewOnlyChange(
	before: Configuration,
	after: Configuration,
): boolean {
	const {
		projectViews: previousViews,
		overview: previousOverview,
		theme: previousTheme,
		...rest
	} = before;
	const {
		projectViews: nextViews,
		overview: nextOverview,
		theme: nextTheme,
		...kept
	} = after;
	const restSame = JSON.stringify(rest) === JSON.stringify(kept);
	const viewsChanged =
		JSON.stringify(previousViews) !== JSON.stringify(nextViews);
	const overviewChanged =
		JSON.stringify(previousOverview) !== JSON.stringify(nextOverview);
	const themeChanged = previousTheme !== nextTheme;
	return restSame && (viewsChanged || overviewChanged || themeChanged);
}

export function readSettingsWrite(text: string): Configuration {
	return parseConfiguration(withoutTrackers(text));
}
