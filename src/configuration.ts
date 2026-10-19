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

const projectRef = z.union([githubRepoPin, githubProjectPin, linearPin]);

const knownBot = z.enum(knownBots);

const configurationSchema = z.strictObject({
	pinned: z.array(projectRef).default([]),
	hidden: z.array(projectRef).default([]),
	activityWindowDays: z.number().int().positive().default(30),
	pollIntervalSeconds: z.number().int().positive().default(60),
	checkoutRoots: z.array(z.string()).default([join(homedir(), "Git")]),
	expectedBots: z.record(z.string(), z.array(knownBot)).optional(),
	noSenior: z.record(z.string(), z.boolean()).default({}),
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
});

export type Configuration = z.infer<typeof configurationSchema>;

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
