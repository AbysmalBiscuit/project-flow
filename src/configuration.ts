import {
	chmod,
	lstat,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const defaultFactoryGithubTokenDir = join(
	homedir(),
	".config",
	"factory-gh",
);

export const defaultFactoryMintCommand = [
	join(homedir(), "Git", "lev", "factory", "bin", "factory"),
	"github-auth",
];

import { z } from "zod";

import {
	forgeKinds,
	runResults,
	runStatusKinds,
	statusTypes,
} from "./domain.ts";
import { githubHost, githubPin } from "./github-pin.ts";
import { knownBots } from "./known-bots.ts";
import { defaultStates } from "./lanes.ts";
import { linearPin } from "./linear-pin.ts";
import {
	overviewDirections,
	overviewFilters,
	overviewSorts,
	overviewViews,
} from "./overview-view.ts";
import { statusColours } from "./token-palette.ts";
import {
	defaultGraphDirection,
	defaultGraphLayout,
	emptyMaxAgeDays,
	graphDirections,
	graphLayouts,
	groupByKeys,
	openViews,
	pageViews,
} from "./view-settings.ts";

export const projectRef = z.discriminatedUnion("tracker", [
	githubPin,
	linearPin,
]);

export type ProjectPin = z.infer<typeof projectRef>;

/** The public hosts that a configuration cannot declare. gitlab.com stays reserved until its adapter exists. */
const knownHosts: readonly string[] = [githubHost, "gitlab.com"];

const declaredHost = z.strictObject({
	host: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[a-z0-9.-]+(?::\d+)?$/),
	forge: z.enum(forgeKinds),
	tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
});

const knownBot = z.enum(knownBots);

export const autoMerge = z.enum(["yes", "ask", "no"]);

export type AutoMerge = z.infer<typeof autoMerge>;

const storedSorts = [
	...overviewSorts,
	"name",
	"needs-you",
	"blockers",
] as const;

const overviewView = z
	.strictObject({
		filter: z.enum([...overviewFilters, "pinned"]).default("all"),
		sort: z.enum(storedSorts).default("project"),
		direction: z.enum(overviewDirections).default("asc"),
		view: z.enum(overviewViews).default("cards"),
		showNeedsYou: z.boolean().default(true),
	})
	.transform(({ filter, sort, direction, view, showNeedsYou }) => ({
		filter: filter === "pinned" ? "all" : filter,
		sort:
			sort === "name"
				? "project"
				: sort === "needs-you"
					? "needsYou"
					: sort === "blockers"
						? "blockedBy"
						: sort,
		direction,
		view,
		showNeedsYou,
	}));

const projectViewSettings = z.strictObject({
	shownLanes: z.array(z.string()).optional(),
	maxAgeDays: z
		.record(z.string(), z.number().int().nonnegative())
		.default(emptyMaxAgeDays),
	needsYouOnly: z.boolean().default(false),
	blockedOnly: z.boolean().default(false),
	assignees: z.array(z.string()).default([]),
	search: z.string().default(""),
	withRunsOnly: z.boolean().default(false),
	latestRunOnly: z.boolean().default(false),
	runStatuses: z.array(z.enum(runStatusKinds)).default([]),
	runResults: z.array(z.enum(runResults)).default([]),
	runFactories: z.array(z.string()).default([]),
	openView: z.enum(openViews).optional(),
	lastView: z.enum(pageViews).optional(),
	graphDirection: z.enum(graphDirections).default(defaultGraphDirection),
	graphLayout: z.enum(graphLayouts).default(defaultGraphLayout),
	groupBy: z.enum(groupByKeys).optional(),
});

const hexColour = z
	.string()
	.regex(/^#[0-9A-Fa-f]{6}$/)
	.transform((value) => value.toLowerCase());

const legacyStateColours = z.strictObject({
	backlog: hexColour.default(statusColours.backlog),
	inProgress: hexColour.default(statusColours.inProgress),
	inReview: hexColour.default(statusColours.inReview),
	awaitingMerge: hexColour.default(statusColours.awaitingMerge),
	done: hexColour.default(statusColours.done),
	dropped: hexColour.default(statusColours.dropped),
});

const userState = z.strictObject({
	id: z.string().regex(/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/),
	label: z.string().trim().min(1),
	colour: hexColour,
	categories: z.array(z.enum(statusTypes)),
});

const userStates = z
	.array(userState)
	.min(1)
	.superRefine((states, context) => {
		const ids = new Set<string>();
		const labels = new Set<string>();
		for (const [index, state] of states.entries()) {
			if (ids.has(state.id)) {
				context.addIssue({ code: "custom", path: [index, "id"] });
			}
			const label = state.label.toLowerCase();
			if (labels.has(label)) {
				context.addIssue({ code: "custom", path: [index, "label"] });
			}
			ids.add(state.id);
			labels.add(label);
		}
		for (const category of statusTypes) {
			if (!states.some((state) => state.categories.includes(category))) {
				context.addIssue({ code: "custom", path: [] });
			}
		}
	});

export type UserState = z.infer<typeof userState>;

const factoryProtocols = new Set(["http:", "https:", "unix:"]);

export const factoryUrl = z
	.string()
	.trim()
	.refine((value) => {
		const url = URL.parse(value);
		return (
			url !== null &&
			factoryProtocols.has(url.protocol) &&
			(url.protocol === "unix:" ? url.pathname !== "" : url.host !== "")
		);
	});

const factory = z.strictObject({
	name: z.string().trim().min(1),
	url: factoryUrl,
	/** The label that a hub source rule of the factory starts a run on. */
	readyLabel: z.string().trim().min(1).optional(),
	/** The ticket status that a hub source rule of the factory starts a run on. */
	readyStatus: z.string().trim().min(1).optional(),
});

export type Factory = z.infer<typeof factory>;

const configurationSchema = z
	.strictObject({
		theme: z.enum(["light", "dark"]).default("light"),
		overview: overviewView.default({
			filter: "all",
			sort: "project",
			direction: "asc",
			view: "cards",
			showNeedsYou: true,
		}),
		hosts: z.array(declaredHost).default([]),
		tracked: z.array(projectRef).optional(),
		pinned: z.array(projectRef).optional(),
		hidden: z.unknown().optional(),
		activityWindowDays: z.unknown().optional(),
		pollIntervalSeconds: z.number().int().positive().default(300),
		checkoutRoots: z.array(z.string()).default([join(homedir(), "Git")]),
		expectedBots: z.record(z.string(), z.array(knownBot)).optional(),
		pmBot: z.record(z.string(), z.boolean()).default({}),
		autoMerge: z.record(z.string(), autoMerge).default({}),
		laneMappings: z
			.record(
				z.string(),
				z.strictObject({
					backlog: z.string().optional(),
					inProgress: z.string().optional(),
					inReview: z.string().optional(),
					awaitingMerge: z.string().optional(),
					done: z.string().optional(),
					dropped: z.string().optional(),
				}),
			)
			.default({}),
		needsYouLabels: z
			.array(z.string())
			.default(["needs-human", "needs-engineer"]),
		viewerLogins: z.array(z.string()).default([]),
		notificationTriggers: z
			.strictObject({
				needsYou: z.boolean().default(true),
				comment: z.boolean().default(true),
				blockerCleared: z.boolean().default(true),
			})
			.default({ needsYou: true, comment: true, blockerCleared: true }),
		factoryGithubTokens: z.boolean().default(false),
		factoryGithubTokenDir: z.string().default(defaultFactoryGithubTokenDir),
		factoryMintCommand: z
			.array(z.string())
			.min(1)
			.default(defaultFactoryMintCommand),
		factories: z.array(factory).default([]),
		projectViews: z.record(z.string(), projectViewSettings).default({}),
		states: userStates.optional(),
		stateMappings: z
			.record(z.string(), z.record(z.string(), z.string()))
			.default({}),
		stateColours: legacyStateColours.optional(),
	})
	.superRefine(({ hosts, tracked, pinned }, context) => {
		const declared = new Set<string>();
		for (const [index, { host }] of hosts.entries()) {
			if (knownHosts.includes(host) || declared.has(host)) {
				context.addIssue({ code: "custom", path: ["hosts", index, "host"] });
			}
			declared.add(host);
		}
		for (const [field, pins] of [
			["tracked", tracked],
			["pinned", pinned],
		] as const) {
			for (const [index, pin] of (pins ?? []).entries()) {
				if ("host" in pin && !declared.has(pin.host)) {
					context.addIssue({ code: "custom", path: [field, index, "host"] });
				}
			}
		}
	})
	.transform(
		({
			tracked,
			pinned,
			hidden: _hidden,
			activityWindowDays: _days,
			factoryGithubTokenDir,
			states,
			stateColours,
			...rest
		}) => ({
			...rest,
			states: states ?? defaultStates(stateColours ?? statusColours),
			tracked: tracked ?? pinned ?? [],
			factoryGithubTokenDir:
				factoryGithubTokenDir.trim() === ""
					? defaultFactoryGithubTokenDir
					: factoryGithubTokenDir,
		}),
	);

export type ProjectViewSettings = z.infer<typeof projectViewSettings>;

export type Configuration = z.infer<typeof configurationSchema>;

export type { OverviewView } from "./overview-view.ts";

function fieldPath(issue: z.core.$ZodIssue): string {
	const path = issue.path.map(String).join(".");
	if (issue.code === "unrecognized_keys") {
		const keys = issue.keys.map((key) =>
			path === "" ? key : `${path}.${key}`,
		);
		return keys.join(", ");
	}
	return path === "" ? "configuration" : path;
}

function configurationError(error: z.ZodError): string {
	const fields = [...new Set(error.issues.map(fieldPath))].join(", ");
	return `invalid configuration: ${fields}`;
}

export function parseConfiguration(text: string): Configuration {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("invalid configuration: configuration is not JSON");
	}
	const result = configurationSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(configurationError(result.error));
	}
	return result.data;
}

export async function loadConfiguration(path: string): Promise<Configuration> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		const code =
			error instanceof Error && "code" in error ? String(error.code) : "";
		throw new Error(
			code === "ENOENT"
				? `configuration file is missing: ${path}`
				: `configuration file cannot be read: ${path}`,
		);
	}
	return parseConfiguration(text);
}

export async function saveConfiguration(
	path: string,
	text: string,
): Promise<Configuration> {
	const configuration = parseConfiguration(text);
	const target = await realpath(path);
	const info = await lstat(target);
	const next = join(
		dirname(target),
		`.${basename(target)}.${process.pid}.${crypto.randomUUID()}`,
	);
	await writeFile(next, `${JSON.stringify(configuration, null, "\t")}\n`);
	try {
		await chmod(next, info.mode & 0o777);
		await rename(next, target);
	} catch (error) {
		await rm(next, { force: true });
		throw error;
	}
	return configuration;
}

const storedStates = z.object({ states: z.unknown().optional() });

/**
 * Loads the configuration, and writes the default states into a file that
 * lacks them, so the file always shows every state to edit.
 */
export async function loadFilledConfiguration(
	path: string,
): Promise<Configuration> {
	const configuration = await loadConfiguration(path);
	const stored = storedStates.safeParse(
		JSON.parse(await readFile(path, "utf8")),
	);
	if (stored.success && stored.data.states !== undefined) {
		return configuration;
	}
	return saveConfiguration(path, JSON.stringify(configuration));
}
