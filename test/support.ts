import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunIo } from "../src/main.ts";

export function urlOf(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

export async function tempConfig(
	body: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "project-flow-"));
	const path = join(dir, "config.json");
	await writeFile(path, body);
	return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function testIo(io: RunIo): RunIo {
	return { listTodos: async () => "", ...io };
}
