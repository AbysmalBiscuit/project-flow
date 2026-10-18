#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { version } from "../package.json";
import { start } from "./app.ts";
import { loadConfiguration } from "./configuration.ts";
import type { Fetch } from "./fetch.ts";
import { checkToken } from "./github.ts";
import { checkLinearKey, missingLinearKey } from "./linear.ts";

export const missingToken =
	'GITHUB_TOKEN is missing: set GITHUB_TOKEN or run "gh auth login".';
export const rejectedToken =
	"GITHUB_TOKEN was rejected by GitHub (HTTP 401): set a valid token.";
export { missingLinearKey };
export const rejectedLinearKey =
	"LINEAR_API_KEY was rejected by Linear (HTTP 401): set a valid key.";

export type RunIo = {
	env: Record<string, string | undefined>;
	fetch: Fetch;
	readGhToken: (
		env?: Record<string, string | undefined>,
	) => Promise<string | null>;
	stdout?: (line: string) => void;
	stderr?: (line: string) => void;
	databasePath?: string;
	hostname?: string;
	port?: number;
	waitForStop?: Promise<void>;
};

export type RunResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
	listened: boolean;
};

export function defaultStorePath(
	env: Record<string, string | undefined>,
): string {
	const root = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(root, "project-flow", "project-flow.sqlite");
}

export async function readGhAuthToken(
	env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
	const gh = Bun.which("gh", { PATH: env.PATH ?? "" });
	if (gh === null) {
		return null;
	}
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([gh, "auth", "token"], {
			stdout: "pipe",
			stderr: "pipe",
			env,
		});
	} catch (error) {
		const code =
			error instanceof Error && "code" in error ? String(error.code) : "";
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
	const stdout = proc.stdout;
	if (typeof stdout === "number" || stdout === undefined) {
		proc.kill();
		return null;
	}
	const [out, code] = await Promise.all([
		new Response(stdout).text(),
		proc.exited,
	]);
	if (code !== 0) {
		return null;
	}
	const token = out.trim();
	return token === "" ? null : token;
}

function defaultConfigPath(env: Record<string, string | undefined>): string {
	const root = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(root, "project-flow", "config.json");
}

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) {
		return undefined;
	}
	return args[index + 1];
}

async function resolveToken(io: RunIo): Promise<string | null> {
	const fromEnv = io.env.GITHUB_TOKEN;
	if (fromEnv !== undefined && fromEnv.trim() !== "") {
		return fromEnv;
	}
	return io.readGhToken(io.env);
}

async function openStore(path: string): Promise<void> {
	if (path === ":memory:") {
		return;
	}
	await mkdir(dirname(path), { recursive: true });
}

export async function run(args: string[], io: RunIo): Promise<RunResult> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	const writeOut = io.stdout ?? ((line: string) => stdoutLines.push(line));
	const writeErr = io.stderr ?? ((line: string) => stderrLines.push(line));
	const result = (exitCode: number, listened: boolean): RunResult => ({
		exitCode,
		stderr: stderrLines.join("\n"),
		stdout: stdoutLines.join("\n"),
		listened,
	});

	if (args.includes("--version")) {
		writeOut(version);
		return result(0, false);
	}

	const configFlag = flagValue(args, "--config");
	if (
		args.includes("--config") &&
		(configFlag === undefined || configFlag.trim() === "")
	) {
		writeErr("invalid configuration: --config needs a file path");
		return result(1, false);
	}

	const portFlag = flagValue(args, "--port");
	const hostFlag = flagValue(args, "--host");
	if (
		args.includes("--port") &&
		(portFlag === undefined || !/^\d+$/.test(portFlag))
	) {
		writeErr("invalid port: --port needs a port number");
		return result(1, false);
	}

	try {
		const token = await resolveToken(io);
		if (token === null) {
			writeErr(missingToken);
			return result(1, false);
		}

		const user = await checkToken(token, io.fetch);
		if (user.status === 401) {
			writeErr(rejectedToken);
			return result(1, false);
		}
		if (!user.ok) {
			writeErr(`GitHub token check failed (HTTP ${user.status}).`);
			return result(1, false);
		}

		const configPath = (configFlag ?? defaultConfigPath(io.env)).trim();
		const configuration = await loadConfiguration(configPath);
		const linearKey = io.env.LINEAR_API_KEY?.trim() ?? "";
		const needsLinear = configuration.pinned.some(
			(pin) => pin.tracker === "linear",
		);
		if (needsLinear && linearKey === "") {
			writeErr(missingLinearKey);
			return result(1, false);
		}
		if (needsLinear) {
			const viewer = await checkLinearKey(linearKey, io.fetch);
			if (viewer.status === 401) {
				writeErr(rejectedLinearKey);
				return result(1, false);
			}
			if (!viewer.ok) {
				writeErr(`Linear key check failed (HTTP ${viewer.status}).`);
				return result(1, false);
			}
		}

		const databasePath = io.databasePath ?? defaultStorePath(io.env);
		await openStore(databasePath);
		const running = await start({
			configPath,
			token,
			linearKey: linearKey === "" ? null : linearKey,
			fetch: io.fetch,
			databasePath,
			hostname: hostFlag ?? io.hostname ?? "127.0.0.1",
			port: portFlag !== undefined ? Number(portFlag) : (io.port ?? 0),
		});
		writeOut(running.url.href);
		await (io.waitForStop ?? Promise.resolve());
		await running.stop();
		return result(0, true);
	} catch (error) {
		writeErr(error instanceof Error ? error.message : "startup failed");
		return result(1, false);
	}
}

if (import.meta.main) {
	const result = await run(process.argv.slice(2), {
		env: process.env,
		fetch: globalThis.fetch,
		readGhToken: readGhAuthToken,
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: new Promise<void>((resolve) => {
			const stop = () => resolve();
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		}),
	});
	process.exit(result.exitCode);
}
