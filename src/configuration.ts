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
import { z } from "zod";
import { knownBots } from "./domain.ts";
import {
	defaultGraphDirection,
	defaultGroupBy,
	defaultOpenView,
	emptyMaxAgeDays,
	graphDirections,
	groupByKeys,
	openViews,
} from "./view-settings.ts";

const githubRepoPin = z.strictObject({
	tracker: z.literal("github"),
	repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
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

export function sameRef(left: ProjectPin, right: ProjectPin): boolean {
	if (left.tracker !== right.tracker) {
		return false;
	}
	if (left.tracker === "linear" && right.tracker === "linear") {
		return left.project === right.project;
	}
	if ("repo" in left && "repo" in right) {
		return left.repo === right.repo;
	}
	if ("owner" in left && "owner" in right) {
		return left.owner === right.owner && left.project === right.project;
	}
	return false;
}

const knownBot = z.enum(knownBots);

export const overviewFilters = ["all", "needs-you", "blocked"] as const;

export const overviewSorts = [
	"project",
	"tracker",
	"progress",
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"needsYou",
	"blockedBy",
] as const;

export const overviewDirections = ["asc", "desc"] as const;

export const overviewViews = ["cards", "graph", "table"] as const;

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
	openView: z.enum(openViews).default(defaultOpenView),
	graphDirection: z.enum(graphDirections).default(defaultGraphDirection),
	groupBy: z.enum(groupByKeys).default(defaultGroupBy),
});

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
		autoMerge: z.record(z.string(), z.enum(["yes", "ask", "no"])).default({}),
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
		projectViews: z.record(z.string(), projectViewSettings).default({}),
	})
	.transform(
		({
			tracked,
			pinned,
			hidden: _hidden,
			activityWindowDays: _days,
			...rest
		}) => ({
			...rest,
			tracked: tracked ?? pinned ?? [],
		}),
	);

export type ProjectViewSettings = z.infer<typeof projectViewSettings>;

export type Configuration = z.infer<typeof configurationSchema>;

export type OverviewView = Configuration["overview"];

export type AutoMerge = Configuration["autoMerge"][string];

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
