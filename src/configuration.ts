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

import { knownBots } from "./known-bots.ts";
import {
	overviewDirections,
	overviewFilters,
	overviewSorts,
	overviewViews,
} from "./overview-view.ts";
import { ownerRepo } from "./project-ref.ts";
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

const githubRepoPin = z.strictObject({
	tracker: z.literal("github"),
	repo: z.string().regex(ownerRepo),
});

const githubProjectPin = z.strictObject({
	tracker: z.literal("github"),
	owner: z.string().regex(/^[^/\s]+$/),
	project: z.number().int().positive(),
});

const linearPin = z.strictObject({
	tracker: z.literal("linear"),
	project: z.string().regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/),
});

export const projectRef = z.union([githubRepoPin, githubProjectPin, linearPin]);

export type ProjectPin = z.infer<typeof projectRef>;

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
	})
	.transform(({ filter, sort, direction, view }) => ({
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

const stateColoursSchema = z
	.strictObject({
		backlog: hexColour.default(statusColours.backlog),
		inProgress: hexColour.default(statusColours.inProgress),
		inReview: hexColour.default(statusColours.inReview),
		awaitingMerge: hexColour.default(statusColours.awaitingMerge),
		done: hexColour.default(statusColours.done),
		dropped: hexColour.default(statusColours.dropped),
	})
	.default(statusColours);

const configurationSchema = z
	.strictObject({
		theme: z.enum(["light", "dark"]).default("light"),
		overview: overviewView.default({
			filter: "all",
			sort: "project",
			direction: "asc",
			view: "cards",
		}),
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
		projectViews: z.record(z.string(), projectViewSettings).default({}),
		stateColours: stateColoursSchema,
	})
	.transform(
		({
			tracked,
			pinned,
			hidden: _hidden,
			activityWindowDays: _days,
			factoryGithubTokenDir,
			...rest
		}) => ({
			...rest,
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

export type StateColours = Configuration["stateColours"];

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

const storedStateColours = z.object({
	stateColours: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Loads the configuration, and writes the default state colours into a file
 * that lacks any of them, so the file always shows every colour to edit.
 */
export async function loadFilledConfiguration(
	path: string,
): Promise<Configuration> {
	const configuration = await loadConfiguration(path);
	const stored = storedStateColours.safeParse(
		JSON.parse(await readFile(path, "utf8")),
	);
	const written = new Set(
		Object.keys(stored.success ? (stored.data.stateColours ?? {}) : {}),
	);
	if (
		Object.keys(configuration.stateColours).every((key) => written.has(key))
	) {
		return configuration;
	}
	return saveConfiguration(path, JSON.stringify(configuration));
}
