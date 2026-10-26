import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { command } from "./command.ts";
import type { MintResult } from "./factory-tokens.ts";

export async function readGhAuthToken(
	env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
	const gh = Bun.which("gh", { PATH: env.PATH ?? "" });
	if (gh === null) {
		return null;
	}
	const token = await command([gh, "auth", "token"], env);
	return token === "" ? null : token;
}

/**
 * Runs the factory mint command under the lock and time limit of the factory
 * timer, so the two never overlap.
 */
export async function runFactoryMint(
	command: string[],
	dir: string,
): Promise<MintResult> {
	const [program, ...args] = command;
	const flock = Bun.which("flock");
	const timeout = Bun.which("timeout");
	const found = program === undefined ? null : Bun.which(program);
	if (flock === null || timeout === null || found === null) {
		return { status: "missing", stderr: "" };
	}
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const proc = Bun.spawn(
		[
			flock,
			"-w",
			"120",
			join(dir, ".refresh.lock"),
			timeout,
			"90",
			found,
			...args,
		],
		{ stdout: "ignore", stderr: "pipe" },
	);
	const [status, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stderr).text(),
	]);
	return { status, stderr };
}
