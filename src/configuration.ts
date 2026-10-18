import { readFile } from "node:fs/promises";
import { z } from "zod";

const githubPin = z.strictObject({
	tracker: z.literal("github"),
	repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
});

const linearPin = z.strictObject({
	tracker: z.literal("linear"),
	project: z.string().regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/),
});

const configurationSchema = z.strictObject({
	pinned: z.array(z.discriminatedUnion("tracker", [githubPin, linearPin])),
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
